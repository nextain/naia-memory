import { createPublicKey } from "node:crypto";
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
import { isCanonicalTrustDomain } from "./public-evidence-types.js";
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
	PublicDatasetProvenance,
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
	const runnerIdentities = Object.keys(trustPolicy.runnerPublicKeys);
	if (!isCanonicalTrustDomain(trustPolicy.benchmarkOperatorTrustDomain))
		failures.push("benchmark operator trust domain is not canonical");
	for (const runner of runnerIdentities) {
		const trustDomain = trustPolicy.runnerTrustDomains[runner];
		if (!trustDomain)
			failures.push(`trusted runner trust domain is missing: ${runner}`);
		else if (!isCanonicalTrustDomain(trustDomain))
			failures.push(`trusted runner trust domain is not canonical: ${runner}`);
	}
	for (const runner of Object.keys(trustPolicy.runnerTrustDomains)) {
		if (!(runner in trustPolicy.runnerPublicKeys))
			failures.push(`runner trust domain has no trusted key: ${runner}`);
	}
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
		["dataset author", trustPolicy.datasetAuthorPublicKeys],
		["dataset custodian", trustPolicy.datasetCustodianPublicKeys],
		["challenge issuer", trustPolicy.challengeIssuerPublicKeys],
		["runner", trustPolicy.runnerPublicKeys],
	] as const;
	const custodianDomain =
		trustPolicy.datasetCustodianTrustDomains[manifest.dataset.custodianId];
	if (!custodianDomain)
		failures.push("dataset custodian trust domain is missing");
	else if (!isCanonicalTrustDomain(custodianDomain))
		failures.push("dataset custodian trust domain is not canonical");
	else if (custodianDomain === trustPolicy.benchmarkOperatorTrustDomain)
		failures.push(
			"dataset custodian is inside the benchmark operator trust boundary",
		);
	for (const custodian of Object.keys(trustPolicy.datasetCustodianTrustDomains))
		if (!(custodian in trustPolicy.datasetCustodianPublicKeys))
			failures.push(
				`dataset custodian trust domain has no trusted key: ${custodian}`,
			);
	const roleKeys: { identity: string; key: string; role: string }[] =
		roleGroups.flatMap(([role, keys]) =>
			Object.entries(keys).map(([identity, key]) => ({ identity, key, role })),
		);
	roleKeys.push(
		...Object.values(trustPolicy.nativeReviewerPublicKeysByLanguage).flatMap(
			(keys) =>
				Object.entries(keys).map(([identity, key]) => ({
					identity,
					key,
					role: "native reviewer",
				})),
		),
	);
	const keyOwners = new Map<string, string>();
	const identityKeys = new Map<string, string>();
	const identityRoles = new Map<string, string>();
	for (const { identity, key, role } of roleKeys) {
		let normalizedKey: string;
		try {
			normalizedKey = createPublicKey(key)
				.export({ type: "spki", format: "der" })
				.toString("base64");
		} catch {
			failures.push(`trusted ${role} key is invalid: ${identity}`);
			continue;
		}
		const owner = keyOwners.get(normalizedKey);
		if (owner && owner !== identity)
			failures.push(`trusted role keys overlap: ${owner} and ${identity}`);
		else keyOwners.set(normalizedKey, identity);
		const priorKey = identityKeys.get(identity);
		if (priorKey && priorKey !== normalizedKey)
			failures.push(`trusted identity has multiple keys: ${identity}`);
		else identityKeys.set(identity, normalizedKey);
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
			trustPolicy.benchmarkOperatorTrustDomain,
			trustPolicy.runnerTrustDomains,
		),
	);
	decision.promotable = decision.failures.length === 0;
	return decision;
}
