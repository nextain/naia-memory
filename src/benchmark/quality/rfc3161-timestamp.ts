import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";

export type Rfc3161TimestampEvidence = {
	schemaVersion: "naia-memory-rfc3161-timestamp-evidence-v1";
	collectionPlanSha256: string;
	tokenSha256: string;
	tokenPath: string;
};

export type Rfc3161TimestampTrustPolicy = {
	schemaVersion: "naia-memory-rfc3161-timestamp-trust-policy-v1";
	trustedCaFilePath: string;
	trustedCaFileSha256: string;
	requiredPolicyOid: string;
};

type CommandResult = {
	status: number | null;
	stdout: string;
	stderr: string;
	error?: Error;
};

type CommandRunner = (
	args: string[],
	token: Buffer,
	trustedCa: Buffer,
) => CommandResult;

const SHA256 = /^[a-f0-9]{64}$/;
const GEN_TIME = /^Time stamp:\s*(.+)$/m;
const POLICY_OID = /^Policy OID:\s*(\S+)$/m;
const OPENSSL_GMT_TIME =
	/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})\s+GMT$/;
const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;

function defaultCommandRunner(
	args: string[],
	token: Buffer,
	trustedCa: Buffer,
): CommandResult {
	const directory = mkdtempSync(join(tmpdir(), "naia-rfc3161-"));
	const tokenPath = join(directory, "timestamp-response.tsr");
	const trustedCaPath = join(directory, "trusted-ca.pem");
	try {
		writeFileSync(tokenPath, token, { mode: 0o600, flag: "wx" });
		writeFileSync(trustedCaPath, trustedCa, { mode: 0o600, flag: "wx" });
		const resolvedArgs = args.map((arg) =>
			arg === "__TRUSTED_CA_FILE__" ? trustedCaPath : arg,
		);
		const result = spawnSync("openssl", [...resolvedArgs, "-in", tokenPath], {
			encoding: "utf8",
			maxBuffer: 1024 * 1024,
			timeout: 10_000,
		});
		return {
			status: result.status,
			stdout: result.stdout ?? "",
			stderr: result.stderr ?? "",
			error: result.error,
		};
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

function assertEvidenceShape(value: Rfc3161TimestampEvidence): void {
	if (
		!value ||
		typeof value !== "object" ||
		value.schemaVersion !== "naia-memory-rfc3161-timestamp-evidence-v1" ||
		!SHA256.test(value.collectionPlanSha256) ||
		!SHA256.test(value.tokenSha256) ||
		typeof value.tokenPath !== "string" ||
		value.tokenPath.trim().length === 0
	)
		throw new Error("RFC 3161 timestamp evidence shape is invalid");
}

function assertTrustPolicyShape(value: Rfc3161TimestampTrustPolicy): void {
	if (
		!value ||
		typeof value !== "object" ||
		value.schemaVersion !== "naia-memory-rfc3161-timestamp-trust-policy-v1" ||
		!SHA256.test(value.trustedCaFileSha256) ||
		typeof value.trustedCaFilePath !== "string" ||
		value.trustedCaFilePath.trim().length === 0 ||
		typeof value.requiredPolicyOid !== "string" ||
		!/^\d+(?:\.\d+)+$/.test(value.requiredPolicyOid)
	)
		throw new Error("RFC 3161 timestamp trust policy shape is invalid");
}

export function validateRfc3161PriorExistence(input: {
	collectionPlan: unknown;
	evidence: Rfc3161TimestampEvidence;
	trustPolicy: Rfc3161TimestampTrustPolicy;
	earliestAuthoredAt: string;
	commandRunner?: CommandRunner;
}): {
	trustedTimestampVerified: true;
	priorAssignmentTimingVerified: true;
	timestampedAt: string;
} {
	assertEvidenceShape(input.evidence);
	assertTrustPolicyShape(input.trustPolicy);
	const planSha256 = evidenceObjectSha256(input.collectionPlan);
	if (input.evidence.collectionPlanSha256 !== planSha256)
		throw new Error("RFC 3161 timestamp collection plan hash mismatch");
	let token: Buffer;
	try {
		token = readFileSync(input.evidence.tokenPath);
	} catch {
		throw new Error("RFC 3161 timestamp token is unreadable");
	}
	if (
		createHash("sha256").update(token).digest("hex") !==
		input.evidence.tokenSha256
	)
		throw new Error("RFC 3161 timestamp token hash mismatch");
	let trustedCa: Buffer;
	try {
		trustedCa = readFileSync(input.trustPolicy.trustedCaFilePath);
	} catch {
		throw new Error("RFC 3161 trusted CA file is unreadable");
	}
	if (
		createHash("sha256").update(trustedCa).digest("hex") !==
		input.trustPolicy.trustedCaFileSha256
	)
		throw new Error("RFC 3161 trusted CA file hash mismatch");
	const run = input.commandRunner ?? defaultCommandRunner;
	const verification = run(
		[
			"ts",
			"-verify",
			"-digest",
			planSha256,
			"-CAfile",
			"__TRUSTED_CA_FILE__",
			"-purpose",
			"timestampsign",
		],
		token,
		trustedCa,
	);
	if (verification.error || verification.status !== 0)
		throw new Error(
			"RFC 3161 timestamp signature or message imprint is invalid",
		);
	const inspection = run(["ts", "-reply", "-text"], token, trustedCa);
	if (inspection.error || inspection.status !== 0)
		throw new Error("RFC 3161 timestamp token cannot be inspected");
	const policyOid = POLICY_OID.exec(inspection.stdout)?.[1];
	if (policyOid !== input.trustPolicy.requiredPolicyOid)
		throw new Error("RFC 3161 timestamp policy is not authorized");
	const timestampText = GEN_TIME.exec(inspection.stdout)?.[1]?.trim() ?? "";
	const parts = OPENSSL_GMT_TIME.exec(timestampText);
	const month = parts
		? MONTHS.indexOf(parts[1] as (typeof MONTHS)[number])
		: -1;
	const timestampedAt = parts
		? Date.UTC(
				Number(parts[6]),
				month,
				Number(parts[2]),
				Number(parts[3]),
				Number(parts[4]),
				Number(parts[5]),
			)
		: Number.NaN;
	const earliestAuthoredAt = Date.parse(input.earliestAuthoredAt);
	if (!Number.isFinite(timestampedAt) || !Number.isFinite(earliestAuthoredAt))
		throw new Error("RFC 3161 timestamp chronology is invalid");
	if (timestampedAt + 1000 > earliestAuthoredAt)
		throw new Error(
			"RFC 3161 collection plan was not timestamped before authorship",
		);
	return {
		trustedTimestampVerified: true,
		priorAssignmentTimingVerified: true,
		timestampedAt: new Date(timestampedAt).toISOString(),
	};
}
