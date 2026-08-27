import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedEvidenceFile } from "./public-evidence-file-io.js";
import type {
	Rfc3161DigestTimestampEvidence,
	Rfc3161TimestampTrustPolicy,
} from "./rfc3161-timestamp.js";
import { runSemanticPublicGateCli } from "./semantic-public-gate-cli.js";
import {
	type SemanticPublicGateManifestSignerTrustPolicy,
	validateSemanticPublicGateManifestReceipt,
} from "./semantic-public-gate-manifest-receipt.js";
import { loadSemanticPublicGateManifest } from "./semantic-public-gate-manifest.js";

const MAX_POLICY_BYTES = 1024 * 1024;

async function json(path: string, label: string): Promise<unknown> {
	try {
		return JSON.parse(
			(await readBoundedEvidenceFile(path, MAX_POLICY_BYTES)).toString("utf8"),
		);
	} catch {
		throw new Error(`${label} is unreadable or invalid JSON`);
	}
}

export async function runSemanticPublicGateSealedManifestCli(
	args: string[],
): Promise<number> {
	if (args.length !== 5) {
		process.stderr.write(
			"Usage: pnpm benchmark:semantic-public-gate-sealed-manifest <manifest.json> <signed-receipt.json> <signer-trust-policy.json> <timestamp-evidence.json> <timestamp-trust-policy.json>\n",
		);
		return 2;
	}
	try {
		const loaded = await loadSemanticPublicGateManifest(args[0]);
		const [signerTrustPolicy, timestampEvidence, timestampTrustPolicy] =
			await Promise.all([
				json(args[2], "manifest signer trust policy"),
				json(args[3], "manifest receipt timestamp evidence"),
				json(args[4], "manifest receipt timestamp trust policy"),
			]);
		await validateSemanticPublicGateManifestReceipt({
			expectedManifestSha256: loaded.manifestSha256,
			receiptPath: args[1],
			signerTrustPolicy:
				signerTrustPolicy as SemanticPublicGateManifestSignerTrustPolicy,
			timestampEvidence: timestampEvidence as Rfc3161DigestTimestampEvidence,
			timestampTrustPolicy: timestampTrustPolicy as Rfc3161TimestampTrustPolicy,
		});
		return runSemanticPublicGateCli(loaded.args);
	} catch (error) {
		process.stdout.write(
			`${JSON.stringify({
				promotable: false,
				failure:
					error instanceof Error
						? error.message
						: "sealed manifest intake failed",
			})}\n`,
		);
		return 1;
	}
}

const invokedPath =
	process.argv[1] && pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url)
	process.exitCode = await runSemanticPublicGateSealedManifestCli(
		process.argv.slice(2),
	);
