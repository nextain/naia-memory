import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import {
	PublicEvidenceFileTooLargeError,
	readBoundedEvidenceFile,
} from "./public-evidence-file-io.js";
import type {
	Rfc3161DigestTimestampEvidence,
	Rfc3161TimestampEvidence,
} from "./rfc3161-timestamp.js";
import {
	type SemanticPilotCollectionPlan,
	validateSemanticPilotCollectionPlan,
} from "./semantic-pilot-collection-packet.js";

type OpenSslResult = {
	status: number | null;
	stdout: Buffer;
	stderr: string;
	error?: Error;
};

type OpenSslRunner = (args: string[]) => OpenSslResult;

const MAX_PLAN_BYTES = 4 * 1024 * 1024;
const MAX_TOKEN_BYTES = 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;

function defaultOpenSslRunner(args: string[]): OpenSslResult {
	const result = spawnSync("openssl", args, {
		encoding: null,
		maxBuffer: MAX_TOKEN_BYTES,
		timeout: 10_000,
	});
	return {
		status: result.status,
		stdout: result.stdout ?? Buffer.alloc(0),
		stderr: result.stderr?.toString("utf8") ?? "",
		error: result.error,
	};
}

async function readPlan(path: string): Promise<SemanticPilotCollectionPlan> {
	let bytes: Buffer;
	try {
		bytes = await readBoundedEvidenceFile(resolve(path), MAX_PLAN_BYTES);
	} catch (error) {
		if (error instanceof PublicEvidenceFileTooLargeError)
			throw new Error("pilot collection plan exceeds the 4 MiB intake limit");
		throw new Error("pilot collection plan is unreadable");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new Error("pilot collection plan is not valid JSON");
	}
	validateSemanticPilotCollectionPlan(parsed as SemanticPilotCollectionPlan);
	return parsed as SemanticPilotCollectionPlan;
}

export async function runRfc3161TimestampCli(
	args: string[],
	openSslRunner: OpenSslRunner = defaultOpenSslRunner,
): Promise<number> {
	if (
		args.length !== 3 ||
		!["request", "seal", "request-digest", "seal-digest"].includes(args[0])
	) {
		process.stderr.write(
			"Usage: pnpm benchmark:semantic-pilot-timestamp <request|seal> <collection-plan.json> <query.tsq|response.tsr>\n       pnpm benchmark:semantic-pilot-timestamp <request-digest|seal-digest> <sha256> <query.tsq|response.tsr>\n",
		);
		return 2;
	}
	try {
		const digestMode = args[0].endsWith("-digest");
		if (digestMode && !SHA256.test(args[1]))
			throw new Error("RFC 3161 artifact SHA-256 is invalid");
		const collectionPlanSha256 = digestMode
			? args[1]
			: evidenceObjectSha256(await readPlan(args[1]));
		const artifactPath = resolve(args[2]);
		if (args[0].startsWith("request")) {
			const result = openSslRunner([
				"ts",
				"-query",
				"-digest",
				collectionPlanSha256,
				"-sha256",
				"-cert",
			]);
			if (result.error || result.status !== 0 || result.stdout.length === 0)
				throw new Error("RFC 3161 timestamp request generation failed");
			writeFileSync(artifactPath, result.stdout, { mode: 0o600, flag: "wx" });
			process.stdout.write(
				`${JSON.stringify({ collectionPlanSha256, queryPath: artifactPath })}\n`,
			);
			return 0;
		}
		let token: Buffer;
		try {
			token = await readBoundedEvidenceFile(artifactPath, MAX_TOKEN_BYTES);
		} catch (error) {
			if (error instanceof PublicEvidenceFileTooLargeError)
				throw new Error("RFC 3161 timestamp response exceeds the 1 MiB limit");
			throw new Error("RFC 3161 timestamp response is unreadable");
		}
		const tokenSha256 = createHash("sha256").update(token).digest("hex");
		const evidence: Rfc3161TimestampEvidence | Rfc3161DigestTimestampEvidence =
			digestMode
				? {
						schemaVersion: "naia-memory-rfc3161-digest-timestamp-evidence-v1",
						artifactSha256: collectionPlanSha256,
						tokenSha256,
						tokenPath: artifactPath,
					}
				: {
						schemaVersion: "naia-memory-rfc3161-timestamp-evidence-v1",
						collectionPlanSha256,
						tokenSha256,
						tokenPath: artifactPath,
					};
		process.stdout.write(`${JSON.stringify(evidence)}\n`);
		return 0;
	} catch (error) {
		process.stdout.write(
			`${JSON.stringify({ failure: error instanceof Error ? error.message : "RFC 3161 timestamp operation failed" })}\n`,
		);
		return 1;
	}
}

const invokedPath =
	process.argv[1] && pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url)
	process.exitCode = await runRfc3161TimestampCli(process.argv.slice(2));
