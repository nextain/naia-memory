import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	publicDatasetCustodySealSigningPacket,
	verifyPublicDatasetCustodySeal,
} from "./public-dataset-custody-seal.js";
import { readBoundedEvidenceFile } from "./public-evidence-file-io.js";

const MAX_BYTES = 16 * 1024 * 1024;

async function readJson(path: string): Promise<unknown> {
	return JSON.parse(
		(await readBoundedEvidenceFile(resolve(path), MAX_BYTES)).toString("utf8"),
	);
}

export async function runPublicDatasetCustodySealCli(
	args: string[],
): Promise<number> {
	try {
		if (args[0] === "packet" && args.length === 4) {
			const dataset = await readBoundedEvidenceFile(
				resolve(args[1]),
				MAX_BYTES,
			);
			process.stdout.write(
				`${JSON.stringify(
					publicDatasetCustodySealSigningPacket({
						custodian: args[2],
						datasetSha256: createHash("sha256").update(dataset).digest("hex"),
						sealedAt: args[3],
					}),
				)}\n`,
			);
			return 0;
		}
		if (args[0] === "verify" && args.length === 9) {
			const dataset = await readBoundedEvidenceFile(
				resolve(args[2]),
				MAX_BYTES,
			);
			const publicKey = (
				await readBoundedEvidenceFile(resolve(args[6]), MAX_BYTES)
			).toString("utf8");
			const result = verifyPublicDatasetCustodySeal({
				seal: (await readJson(args[1])) as never,
				expectedDatasetSha256: createHash("sha256")
					.update(dataset)
					.digest("hex"),
				timestampEvidence: (await readJson(args[3])) as never,
				timestampTrustPolicy: (await readJson(args[4])) as never,
				challengeIssuedAt: args[5],
				custodianPublicKey: publicKey,
				tokenBytes: await readBoundedEvidenceFile(resolve(args[7]), MAX_BYTES),
				trustedCaBytes: await readBoundedEvidenceFile(
					resolve(args[8]),
					MAX_BYTES,
				),
			});
			process.stdout.write(`${JSON.stringify(result)}\n`);
			return 0;
		}
		process.stderr.write(
			"Usage: custody-seal packet <dataset> <custodian> <sealed-at> | custody-seal verify <seal> <dataset> <timestamp-evidence> <timestamp-policy> <challenge-issued-at> <custodian-public-key> <timestamp-token> <trusted-ca>\n",
		);
		return 2;
	} catch (error) {
		process.stdout.write(
			`${JSON.stringify({ failure: error instanceof Error ? error.message : "custody seal operation failed" })}\n`,
		);
		return 1;
	}
}

const invokedPath =
	process.argv[1] && pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url)
	process.exitCode = await runPublicDatasetCustodySealCli(
		process.argv.slice(2),
	);
