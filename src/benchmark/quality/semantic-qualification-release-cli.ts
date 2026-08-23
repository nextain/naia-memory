import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { readBoundedEvidenceFile } from "./public-evidence-file-io.js";
import { SEMANTIC_COMPETITIVE_QUALIFICATION_TRUST_ANCHOR } from "./semantic-competitive-qualification-trust-anchor.js";
import { semanticQualificationTrustAnchorFromPublicPolicy } from "./semantic-competitive-qualification-trust-store.js";
import type { SemanticQualificationTrustAnchor } from "./semantic-competitive-qualification.js";
import { runSemanticPublicGateSealedManifestCli } from "./semantic-public-gate-sealed-manifest-cli.js";

const MAX_POLICY_BYTES = 1024 * 1024;

async function loadExpectedAnchor(
	path: string,
): Promise<SemanticQualificationTrustAnchor> {
	let bytes: Buffer;
	try {
		bytes = await readBoundedEvidenceFile(resolve(path), MAX_POLICY_BYTES);
	} catch {
		throw new Error("qualification deployment policy is unreadable");
	}
	let policy: unknown;
	try {
		policy = JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new Error("qualification deployment policy is not valid JSON");
	}
	return semanticQualificationTrustAnchorFromPublicPolicy(policy);
}

export function validateSemanticQualificationReleaseAnchor(
	expectedAnchor: SemanticQualificationTrustAnchor,
	provisionedAnchor: SemanticQualificationTrustAnchor | null,
): void {
	if (!provisionedAnchor)
		throw new Error(
			"qualification trust anchor is not provisioned in this checkout",
		);
	if (!isDeepStrictEqual(provisionedAnchor, expectedAnchor))
		throw new Error(
			"qualification trust anchor does not match deployment policy",
		);
}

export async function runSemanticQualificationReleaseCli(
	args: string[],
): Promise<number> {
	if (args.length !== 6) {
		process.stderr.write(
			"Usage: pnpm benchmark:semantic-qualification-release <public-deployment-policy.json> <manifest.json> <signed-receipt.json> <signer-trust-policy.json> <timestamp-evidence.json> <timestamp-trust-policy.json>\n",
		);
		return 2;
	}
	try {
		const expectedAnchor = await loadExpectedAnchor(args[0]);
		validateSemanticQualificationReleaseAnchor(
			expectedAnchor,
			SEMANTIC_COMPETITIVE_QUALIFICATION_TRUST_ANCHOR,
		);
		return runSemanticPublicGateSealedManifestCli(args.slice(1));
	} catch (error) {
		process.stdout.write(
			`${JSON.stringify({
				promotable: false,
				failure:
					error instanceof Error
						? error.message
						: "qualification release intake failed",
			})}\n`,
		);
		return 1;
	}
}

const invokedPath =
	process.argv[1] && pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url)
	process.exitCode = await runSemanticQualificationReleaseCli(
		process.argv.slice(2),
	);
