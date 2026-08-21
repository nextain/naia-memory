import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	PublicEvidenceFileTooLargeError,
	readBoundedEvidenceFile,
} from "./public-evidence-file-io.js";
import { assembleSemanticAttestationBundle } from "./semantic-attestation-collector.js";

const MAX_BYTES = 16 * 1024 * 1024;

export async function runSemanticAttestationCollectorCli(
	args: string[],
): Promise<number> {
	if (args.length !== 3) {
		process.stderr.write(
			"Usage: pnpm benchmark:semantic-collect-signatures <packet.json> <detached-signatures.json> <trust-policy.json>\n",
		);
		return 2;
	}
	try {
		const values: unknown[] = [];
		for (const [index, label] of [
			"packet",
			"detached signatures",
			"trust policy",
		].entries()) {
			let bytes: Buffer;
			try {
				bytes = await readBoundedEvidenceFile(resolve(args[index]), MAX_BYTES);
			} catch (error) {
				if (error instanceof PublicEvidenceFileTooLargeError)
					throw new Error(`${label} exceeds the 16 MiB intake limit`);
				throw new Error(`${label} is unreadable`);
			}
			try {
				values.push(JSON.parse(bytes.toString("utf8")));
			} catch {
				throw new Error(`${label} is not valid JSON`);
			}
		}
		process.stdout.write(
			`${JSON.stringify(assembleSemanticAttestationBundle(values[0], values[1], values[2]))}\n`,
		);
		return 0;
	} catch (error) {
		process.stdout.write(
			`${JSON.stringify({ failure: error instanceof Error ? error.message : "signature collection failed" })}\n`,
		);
		return 1;
	}
}

const invokedPath =
	process.argv[1] && pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url)
	process.exitCode = await runSemanticAttestationCollectorCli(
		process.argv.slice(2),
	);
