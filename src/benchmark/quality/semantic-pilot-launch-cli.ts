import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { MemoryUpdateContract } from "./memory-update-contract.js";
import { validateSemanticPublicEvidenceCoverage } from "./memory-update-contract.js";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import {
	PublicEvidenceFileTooLargeError,
	readBoundedEvidenceFile,
} from "./public-evidence-file-io.js";
import type {
	Rfc3161TimestampEvidence,
	Rfc3161TimestampTrustPolicy,
} from "./rfc3161-timestamp.js";
import type { SemanticPilotCollectionPlan } from "./semantic-pilot-collection-packet.js";
import { buildSemanticPilotLaunch } from "./semantic-pilot-launch.js";

async function readJson(path: string, label: string, limit: number) {
	let bytes: Buffer;
	try {
		bytes = await readBoundedEvidenceFile(resolve(path), limit);
	} catch (error) {
		if (error instanceof PublicEvidenceFileTooLargeError)
			throw new Error(`${label} exceeds the intake limit`);
		throw new Error(`${label} is unreadable`);
	}
	try {
		return JSON.parse(bytes.toString("utf8")) as unknown;
	} catch {
		throw new Error(`${label} is not valid JSON`);
	}
}

export async function runSemanticPilotLaunchCli(
	args: string[],
): Promise<number> {
	if (args.length !== 4) {
		process.stderr.write(
			"Usage: pnpm benchmark:semantic-pilot-launch <collection-plan.json> <public-contract.json> <timestamp-evidence.json> <timestamp-trust-policy.json>\n",
		);
		return 2;
	}
	try {
		const plan = (await readJson(
			args[0],
			"pilot collection plan",
			4 * 1024 * 1024,
		)) as SemanticPilotCollectionPlan;
		const contract = (await readJson(
			args[1],
			"public contract",
			16 * 1024 * 1024,
		)) as MemoryUpdateContract;
		const evidence = (await readJson(
			args[2],
			"timestamp evidence",
			1024 * 1024,
		)) as Rfc3161TimestampEvidence;
		const trustPolicy = (await readJson(
			args[3],
			"timestamp trust policy",
			1024 * 1024,
		)) as Rfc3161TimestampTrustPolicy;
		validateSemanticPublicEvidenceCoverage(contract);
		if (plan.publicContractSha256 !== evidenceObjectSha256(contract))
			throw new Error("pilot collection plan public contract hash mismatch");
		process.stdout.write(
			`${JSON.stringify(buildSemanticPilotLaunch({ collectionPlan: plan, timestampEvidence: evidence, timestampTrustPolicy: trustPolicy }))}\n`,
		);
		return 0;
	} catch (error) {
		process.stdout.write(
			`${JSON.stringify({ failure: error instanceof Error ? error.message : "pilot launch failed" })}\n`,
		);
		return 1;
	}
}

const invokedPath =
	process.argv[1] && pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url)
	process.exitCode = await runSemanticPilotLaunchCli(process.argv.slice(2));
