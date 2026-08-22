import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	constants,
	closeSync,
	fstatSync,
	mkdtempSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";

export type Rfc3161TimestampEvidence = {
	schemaVersion: "naia-memory-rfc3161-timestamp-evidence-v1";
	collectionPlanSha256: string;
	tokenSha256: string;
	tokenPath: string;
};

export type Rfc3161DigestTimestampEvidence = {
	schemaVersion: "naia-memory-rfc3161-digest-timestamp-evidence-v1";
	artifactSha256: string;
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

export type Rfc3161CommandRunner = (
	args: string[],
	token: Buffer,
	trustedCa: Buffer,
) => CommandResult;

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_TIMESTAMP_INPUT_BYTES = 16 * 1024 * 1024;
const GEN_TIME = /^Time stamp:\s*(.+)$/m;
const POLICY_OID = /^Policy OID:\s*(\S+)$/m;
const OPENSSL_GMT_TIME =
	/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})\s+GMT$/;
const UTC_RFC3339_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
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
	const emptyConfigPath = join(directory, "empty-openssl.cnf");
	try {
		writeFileSync(tokenPath, token, { mode: 0o600, flag: "wx" });
		writeFileSync(trustedCaPath, trustedCa, { mode: 0o600, flag: "wx" });
		writeFileSync(emptyConfigPath, "", { mode: 0o600, flag: "wx" });
		const resolvedArgs = args.map((arg) => {
			if (arg === "__TRUSTED_CA_FILE__") return trustedCaPath;
			if (arg === "__EMPTY_CONFIG_FILE__") return emptyConfigPath;
			return arg;
		});
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

export function isRfc3161DigestTimestampEvidence(
	value: unknown,
): value is Rfc3161DigestTimestampEvidence {
	const candidate = value as Rfc3161DigestTimestampEvidence;
	return Boolean(
		candidate &&
			typeof candidate === "object" &&
			candidate.schemaVersion ===
				"naia-memory-rfc3161-digest-timestamp-evidence-v1" &&
			SHA256.test(candidate.artifactSha256) &&
			SHA256.test(candidate.tokenSha256) &&
			typeof candidate.tokenPath === "string" &&
			candidate.tokenPath.trim().length > 0,
	);
}

function assertDigestEvidenceShape(
	value: unknown,
): asserts value is Rfc3161DigestTimestampEvidence {
	if (!isRfc3161DigestTimestampEvidence(value))
		throw new Error("RFC 3161 digest timestamp evidence shape is invalid");
}

export function isRfc3161TimestampTrustPolicy(
	value: unknown,
): value is Rfc3161TimestampTrustPolicy {
	const candidate = value as Rfc3161TimestampTrustPolicy;
	return Boolean(
		candidate &&
			typeof candidate === "object" &&
			candidate.schemaVersion ===
				"naia-memory-rfc3161-timestamp-trust-policy-v1" &&
			SHA256.test(candidate.trustedCaFileSha256) &&
			typeof candidate.trustedCaFilePath === "string" &&
			candidate.trustedCaFilePath.trim().length > 0 &&
			typeof candidate.requiredPolicyOid === "string" &&
			/^\d+(?:\.\d+)+$/.test(candidate.requiredPolicyOid),
	);
}

export function rfc3161TrustPolicyIdentity(
	policy: Rfc3161TimestampTrustPolicy,
): {
	schemaVersion: 1;
	trustedCaFileSha256: string;
	requiredPolicyOid: string;
} {
	assertTrustPolicyShape(policy);
	return {
		schemaVersion: 1,
		trustedCaFileSha256: policy.trustedCaFileSha256,
		requiredPolicyOid: policy.requiredPolicyOid,
	};
}

function assertTrustPolicyShape(
	value: unknown,
): asserts value is Rfc3161TimestampTrustPolicy {
	if (!isRfc3161TimestampTrustPolicy(value))
		throw new Error("RFC 3161 timestamp trust policy shape is invalid");
}

export function validateRfc3161PriorExistence(input: {
	collectionPlan: unknown;
	evidence: Rfc3161TimestampEvidence;
	trustPolicy: Rfc3161TimestampTrustPolicy;
	earliestAuthoredAt: string;
	commandRunner?: Rfc3161CommandRunner;
}): {
	trustedTimestampVerified: true;
	priorAssignmentTimingVerified: true;
	timestampedAt: string;
} {
	const timestamp = validateRfc3161TimestampBinding(input);
	const timestampedAt = Date.parse(timestamp.timestampedAt);
	const earliestAuthoredAt = UTC_RFC3339_TIME.test(input.earliestAuthoredAt)
		? Date.parse(input.earliestAuthoredAt)
		: Number.NaN;
	const normalizedAuthoredAt = Number.isFinite(earliestAuthoredAt)
		? new Date(earliestAuthoredAt).toISOString()
		: "";
	const expectedAuthoredAt = input.earliestAuthoredAt.includes(".")
		? input.earliestAuthoredAt
		: input.earliestAuthoredAt.replace("Z", ".000Z");
	if (!Number.isFinite(earliestAuthoredAt))
		throw new Error("RFC 3161 timestamp chronology is invalid");
	if (normalizedAuthoredAt !== expectedAuthoredAt)
		throw new Error("RFC 3161 timestamp chronology is invalid");
	if (timestampedAt + 1000 > earliestAuthoredAt)
		throw new Error(
			"RFC 3161 collection plan was not timestamped before authorship",
		);
	return {
		...timestamp,
		priorAssignmentTimingVerified: true,
	};
}

export function validateRfc3161TimestampBinding(input: {
	collectionPlan: unknown;
	evidence: Rfc3161TimestampEvidence;
	trustPolicy: Rfc3161TimestampTrustPolicy;
	commandRunner?: Rfc3161CommandRunner;
}): {
	trustedTimestampVerified: true;
	timestampedAt: string;
} {
	assertEvidenceShape(input.evidence);
	assertTrustPolicyShape(input.trustPolicy);
	const planSha256 = evidenceObjectSha256(input.collectionPlan);
	if (input.evidence.collectionPlanSha256 !== planSha256)
		throw new Error("RFC 3161 timestamp collection plan hash mismatch");
	return validateDigestTimestampCore({
		artifactSha256: planSha256,
		tokenSha256: input.evidence.tokenSha256,
		tokenPath: input.evidence.tokenPath,
		trustPolicy: input.trustPolicy,
		commandRunner: input.commandRunner,
	});
}

function readBoundedTimestampInput(path: string): Buffer {
	const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const metadata = fstatSync(descriptor);
		if (!metadata.isFile() || metadata.size > MAX_TIMESTAMP_INPUT_BYTES)
			throw new Error("RFC 3161 input is not a bounded regular file");
		const bytes = readFileSync(descriptor);
		if (bytes.length > MAX_TIMESTAMP_INPUT_BYTES)
			throw new Error("RFC 3161 input exceeds the intake limit");
		return bytes;
	} finally {
		closeSync(descriptor);
	}
}

function validateDigestTimestampCore(input: {
	artifactSha256: string;
	tokenSha256: string;
	tokenPath: string;
	trustPolicy: Rfc3161TimestampTrustPolicy;
	commandRunner?: Rfc3161CommandRunner;
	tokenBytes?: Buffer;
	trustedCaBytes?: Buffer;
}): { trustedTimestampVerified: true; timestampedAt: string } {
	let token: Buffer;
	try {
		token = input.tokenBytes ?? readBoundedTimestampInput(input.tokenPath);
	} catch {
		throw new Error("RFC 3161 timestamp token is unreadable");
	}
	if (createHash("sha256").update(token).digest("hex") !== input.tokenSha256)
		throw new Error("RFC 3161 timestamp token hash mismatch");
	let trustedCa: Buffer;
	try {
		trustedCa =
			input.trustedCaBytes ??
			readBoundedTimestampInput(input.trustPolicy.trustedCaFilePath);
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
			input.artifactSha256,
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
	const inspection = run(
		["ts", "-reply", "-text", "-config", "__EMPTY_CONFIG_FILE__"],
		token,
		trustedCa,
	);
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
	if (!Number.isFinite(timestampedAt))
		throw new Error("RFC 3161 timestamp chronology is invalid");
	return {
		trustedTimestampVerified: true,
		timestampedAt: new Date(timestampedAt).toISOString(),
	};
}

export function validateRfc3161DigestTimestampBinding(input: {
	expectedArtifactSha256: string;
	evidence: Rfc3161DigestTimestampEvidence;
	trustPolicy: Rfc3161TimestampTrustPolicy;
	commandRunner?: Rfc3161CommandRunner;
	tokenBytes?: Buffer;
	trustedCaBytes?: Buffer;
}): {
	trustedTimestampVerified: true;
	timestampedAt: string;
} {
	assertDigestEvidenceShape(input.evidence);
	assertTrustPolicyShape(input.trustPolicy);
	if (
		!SHA256.test(input.expectedArtifactSha256) ||
		input.evidence.artifactSha256 !== input.expectedArtifactSha256
	)
		throw new Error("RFC 3161 timestamp artifact hash mismatch");
	return validateDigestTimestampCore({
		artifactSha256: input.expectedArtifactSha256,
		tokenSha256: input.evidence.tokenSha256,
		tokenPath: input.evidence.tokenPath,
		trustPolicy: input.trustPolicy,
		commandRunner: input.commandRunner,
		tokenBytes: input.tokenBytes,
		trustedCaBytes: input.trustedCaBytes,
	});
}
