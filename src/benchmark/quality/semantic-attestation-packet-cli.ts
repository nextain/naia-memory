import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	type MemoryUpdateContract,
	validateSemanticPublicEvidenceCoverage,
} from "./memory-update-contract.js";
import {
	PublicEvidenceFileTooLargeError,
	readBoundedEvidenceFile,
} from "./public-evidence-file-io.js";
import { buildSemanticAttestationSigningPacket } from "./semantic-attestation-packet.js";

const MAX_CONTRACT_BYTES = 16 * 1024 * 1024;

export async function runSemanticAttestationPacketCli(
	args: string[],
): Promise<number> {
	if (args.length !== 2) {
		process.stderr.write(
			"Usage: pnpm benchmark:semantic-signing-packet <contract.json> <signed-at-iso>\n",
		);
		return 2;
	}
	try {
		let bytes: Buffer;
		try {
			bytes = await readBoundedEvidenceFile(
				resolve(args[0]),
				MAX_CONTRACT_BYTES,
			);
		} catch (error) {
			if (error instanceof PublicEvidenceFileTooLargeError)
				throw new Error("contract exceeds the 16 MiB intake limit");
			throw new Error("contract is unreadable");
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(bytes.toString("utf8"));
		} catch {
			throw new Error("contract is not valid JSON");
		}
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
			throw new Error("contract root must be an object");
		const contract = parsed as MemoryUpdateContract;
		validateSemanticPublicEvidenceCoverage(contract);
		process.stdout.write(
			`${JSON.stringify(buildSemanticAttestationSigningPacket(contract, args[1]))}\n`,
		);
		return 0;
	} catch (error) {
		process.stdout.write(
			`${JSON.stringify({ failure: error instanceof Error ? error.message : "signing packet failed" })}\n`,
		);
		return 1;
	}
}

const invokedPath =
	process.argv[1] && pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url)
	process.exitCode = await runSemanticAttestationPacketCli(
		process.argv.slice(2),
	);
