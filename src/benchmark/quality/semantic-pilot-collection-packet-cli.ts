import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { MemoryUpdateContract } from "./memory-update-contract.js";
import { validateSemanticPublicEvidenceCoverage } from "./memory-update-contract.js";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import {
	PublicEvidenceFileTooLargeError,
	readBoundedEvidenceFile,
} from "./public-evidence-file-io.js";
import {
	type SemanticPilotCollectionPlan,
	buildSemanticPilotCollectionManifest,
} from "./semantic-pilot-collection-packet.js";

const MAX_PLAN_BYTES = 4 * 1024 * 1024;

export async function runSemanticPilotCollectionPacketCli(
	args: string[],
): Promise<number> {
	if (args.length !== 2) {
		process.stderr.write(
			"Usage: pnpm benchmark:semantic-pilot-packet <collection-plan.json> <public-contract.json>\n",
		);
		return 2;
	}
	try {
		let bytes: Buffer;
		let contractBytes: Buffer;
		try {
			bytes = await readBoundedEvidenceFile(resolve(args[0]), MAX_PLAN_BYTES);
		} catch (error) {
			if (error instanceof PublicEvidenceFileTooLargeError)
				throw new Error("pilot collection plan exceeds the 4 MiB intake limit");
			throw new Error("pilot collection plan is unreadable");
		}
		try {
			contractBytes = await readBoundedEvidenceFile(
				resolve(args[1]),
				16 * 1024 * 1024,
			);
		} catch (error) {
			if (error instanceof PublicEvidenceFileTooLargeError)
				throw new Error("public contract exceeds the 16 MiB intake limit");
			throw new Error("public contract is unreadable");
		}
		let parsed: unknown;
		let contract: unknown;
		try {
			parsed = JSON.parse(bytes.toString("utf8"));
		} catch {
			throw new Error("pilot collection plan is not valid JSON");
		}
		try {
			contract = JSON.parse(contractBytes.toString("utf8"));
		} catch {
			throw new Error("public contract is not valid JSON");
		}
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
			throw new Error("pilot collection plan root must be an object");
		if (
			contract === null ||
			typeof contract !== "object" ||
			Array.isArray(contract)
		)
			throw new Error("public contract root must be an object");
		validateSemanticPublicEvidenceCoverage(contract as MemoryUpdateContract);
		if (
			(parsed as SemanticPilotCollectionPlan).publicContractSha256 !==
			evidenceObjectSha256(contract)
		)
			throw new Error("pilot collection plan public contract hash mismatch");
		process.stdout.write(
			`${JSON.stringify(buildSemanticPilotCollectionManifest(parsed as SemanticPilotCollectionPlan))}\n`,
		);
		return 0;
	} catch (error) {
		process.stdout.write(
			`${JSON.stringify({ failure: error instanceof Error ? error.message : "pilot packet failed" })}\n`,
		);
		return 1;
	}
}

const invokedPath =
	process.argv[1] && pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url)
	process.exitCode = await runSemanticPilotCollectionPacketCli(
		process.argv.slice(2),
	);
