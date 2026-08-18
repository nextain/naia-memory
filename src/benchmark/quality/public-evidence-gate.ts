import {
	evidenceObjectSha256,
	hasValidEvidenceSignature,
} from "./public-evidence-crypto.js";
import { loadPublicEvidenceFiles } from "./public-evidence-file-loader.js";
import type {
	PublicEvidenceDecision,
	PublicEvidenceManifest,
	PublicEvidenceTrustPolicy,
} from "./public-evidence-types.js";
import { evaluateExecutionAttestations } from "./public-execution-attestation.js";
import {
	isPublicEvidenceManifest,
	validatePublicEvidenceManifest,
} from "./public-manifest-validator.js";

export type {
	PublicAdversarialReview,
	PublicCaseRecord,
	PublicDatasetCase,
	PublicEvidenceDataset,
	PublicEvidenceDecision,
	PublicEvidenceEngine,
	PublicEvidenceManifest,
	PublicEvidenceReceipt,
	PublicEvidenceTrustPolicy,
} from "./public-evidence-types.js";
export {
	publicCaseJudgmentSha256,
	publicCaseOutputSha256,
	summarizePublicCaseRecords,
} from "./public-receipt-verifier.js";
export { evidenceSignaturePayload as publicEvidenceSignaturePayload } from "./public-evidence-crypto.js";
export {
	PUBLIC_EVIDENCE_CLAIM,
	isPublicEvidenceManifest,
	publicEvidenceScopeSha256,
	validatePublicEvidenceManifest,
} from "./public-manifest-validator.js";

function validateTrustPolicy(
	manifest: PublicEvidenceManifest,
	trustPolicy: PublicEvidenceTrustPolicy,
): string[] {
	const failures: string[] = [];
	if (
		!hasValidEvidenceSignature(
			manifest,
			trustPolicy.publisherPublicKeys[manifest.publisher],
		)
	)
		failures.push("manifest signature is untrusted or invalid");
	const roleGroups = [
		["publisher", trustPolicy.publisherPublicKeys],
		["engine", trustPolicy.enginePublicKeys],
		["reviewer", trustPolicy.reviewerPublicKeys],
		["challenge issuer", trustPolicy.challengeIssuerPublicKeys],
		["runner", trustPolicy.runnerPublicKeys],
	] as const;
	const roleKeys = roleGroups.flatMap(([role, keys]) =>
		Object.entries(keys).map(([identity, key]) => ({ identity, key, role })),
	);
	const keyOwners = new Map<string, string>();
	const identityRoles = new Map<string, string>();
	for (const { identity, key, role } of roleKeys) {
		const owner = keyOwners.get(key.trim());
		if (owner && owner !== identity)
			failures.push(`trusted role keys overlap: ${owner} and ${identity}`);
		else keyOwners.set(key.trim(), identity);
		const priorRole = identityRoles.get(identity);
		if (priorRole && priorRole !== role)
			failures.push(
				`trusted role identities overlap: ${identity} is ${priorRole} and ${role}`,
			);
		else identityRoles.set(identity, role);
	}
	if (
		trustPolicy.approvedScoringPolicies[manifest.protocol.scoringPolicyId] !==
		manifest.protocol.scorerArtifactSha256
	)
		failures.push("scoring policy is not approved by the verifier");
	return failures;
}

export async function evaluatePublicEvidenceFiles(
	manifest: PublicEvidenceManifest,
	evidenceRoot: string,
	trustPolicy: PublicEvidenceTrustPolicy,
): Promise<PublicEvidenceDecision> {
	if (!isPublicEvidenceManifest(manifest))
		return { promotable: false, failures: ["manifest shape is invalid"] };
	const decision = validatePublicEvidenceManifest(manifest);
	decision.failures.push(...validateTrustPolicy(manifest, trustPolicy));
	const loaded = await loadPublicEvidenceFiles(
		manifest,
		evidenceRoot,
		trustPolicy,
	);
	decision.failures.push(...loaded.failures);
	const protocolSha256 = evidenceObjectSha256(manifest.protocol);
	decision.failures.push(
		...evaluateExecutionAttestations(
			manifest.engines
				.filter((item) => item.executed)
				.map((engine) => ({
					engine: engine.engine,
					datasetSha256: engine.datasetSha256,
					protocolSha256,
					receiptSha256: engine.receiptSha256,
					implementationArtifactSha256: engine.implementationArtifactSha256,
					configurationSha256: engine.configurationSha256,
					executionEvidenceSha256: engine.executionEvidenceSha256,
				})),
			loaded.challenges,
			loaded.attestations,
			trustPolicy.challengeIssuerPublicKeys,
			trustPolicy.runnerPublicKeys,
		),
	);
	decision.promotable = decision.failures.length === 0;
	return decision;
}
