import { createPublicKey } from "node:crypto";

export type PublicEvidenceEngine = {
	engine: string;
	kind: "naia" | "external";
	implementationFamily: string;
	executed: boolean;
	receiptPath: string;
	receiptSha256: string;
	challengePath: string;
	challengeSha256: string;
	attestationPath: string;
	attestationSha256: string;
	executionEvidencePath: string;
	executionEvidenceSha256: string;
	datasetSha256: string;
	implementationRevision: string;
	implementationArtifactPath: string;
	implementationArtifactSha256: string;
	configurationPath: string;
	configurationSha256: string;
	providerModels: string[];
	elapsedMs: number;
	estimatedCostUsd: number;
	failureCount: number;
	primaryMetric: {
		name: string;
		value: number;
		ci95Low: number;
		ci95High: number;
	};
};

export type PublicEvidenceManifest = {
	schemaVersion: "naia-memory-public-evidence-v5";
	publisher: string;
	signatureBase64: string;
	claim: string;
	dataset: {
		path: string;
		benchmarkTier: string;
		construction: string;
		nativeReviewStatus: string;
		sealedBeforeRun: boolean;
		sha256: string;
		provenancePath: string;
		provenanceSha256: string;
		caseCount: number;
		languageCaseCounts: Record<string, number>;
		authorIds: string[];
		reviewerIdsByLanguage: Record<string, string[]>;
	};
	protocol: {
		sameInputSha256: string;
		topK: number;
		repetitions: number;
		answerModel: string;
		judgeModel: string;
		primaryMetricName: string;
		scoringPolicyId: string;
		scorerArtifactPath: string;
		scorerArtifactSha256: string;
		frozenBeforeRun: boolean;
	};
	engines: PublicEvidenceEngine[];
	adversarialReview: {
		independent: boolean;
		reviewer: string;
		evidenceScopeSha256: string;
		artifactPath: string;
		artifactSha256: string;
		verdict: string;
	};
};

export type PublicEvidenceDecision = {
	promotable: boolean;
	failures: string[];
};

/** Trusted keys are supplied by the publisher/verifier, never by submitted evidence. */
export type PublicEvidenceTrustPolicy = {
	publisherPublicKeys: Record<string, string>;
	enginePublicKeys: Record<string, string>;
	reviewerPublicKeys: Record<string, string>;
	datasetAuthorPublicKeys: Record<string, string>;
	nativeReviewerPublicKeysByLanguage: Record<string, Record<string, string>>;
	challengeIssuerPublicKeys: Record<string, string>;
	runnerPublicKeys: Record<string, string>;
	approvedScoringPolicies: Record<string, string>;
};

function isStringRecord(value: unknown): value is Record<string, string> {
	return (
		isPublicEvidenceRecord(value) &&
		Object.values(value).every((item) => typeof item === "string")
	);
}

function isEd25519PublicKey(value: unknown): value is string {
	if (typeof value !== "string") return false;
	try {
		return createPublicKey(value).asymmetricKeyType === "ed25519";
	} catch {
		return false;
	}
}

function isPublicKeyRecord(value: unknown): value is Record<string, string> {
	return (
		isPublicEvidenceRecord(value) &&
		Object.values(value).every(isEd25519PublicKey)
	);
}

export function isPublicEvidenceTrustPolicy(
	value: unknown,
): value is PublicEvidenceTrustPolicy {
	if (!isPublicEvidenceRecord(value)) return false;
	const nativeReviewers = value.nativeReviewerPublicKeysByLanguage;
	return (
		isPublicKeyRecord(value.publisherPublicKeys) &&
		isPublicKeyRecord(value.enginePublicKeys) &&
		isPublicKeyRecord(value.reviewerPublicKeys) &&
		isPublicKeyRecord(value.datasetAuthorPublicKeys) &&
		isPublicEvidenceRecord(nativeReviewers) &&
		Object.values(nativeReviewers).every(isPublicKeyRecord) &&
		isPublicKeyRecord(value.challengeIssuerPublicKeys) &&
		isPublicKeyRecord(value.runnerPublicKeys) &&
		isStringRecord(value.approvedScoringPolicies)
	);
}

export type PublicDatasetAuthorAttestation = {
	schemaVersion: "naia-memory-public-dataset-author-attestation-v1";
	author: string;
	datasetSha256: string;
	statement: "AUTHORED_INDEPENDENTLY";
	signatureBase64: string;
};

export type PublicDatasetNativeReviewAttestation = {
	schemaVersion: "naia-memory-public-dataset-native-review-v1";
	reviewer: string;
	language: string;
	datasetSha256: string;
	verdict: "PASS";
	signatureBase64: string;
};

export type PublicDatasetProvenance = {
	schemaVersion: "naia-memory-public-dataset-provenance-v1";
	datasetSha256: string;
	authors: PublicDatasetAuthorAttestation[];
	nativeReviews: PublicDatasetNativeReviewAttestation[];
};

export const PUBLIC_EVIDENCE_SHA256 = /^[a-f0-9]{64}$/;

export function isPublicEvidenceRecord(
	value: unknown,
): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type PublicEvidenceReceipt = Omit<
	PublicEvidenceEngine,
	| "executed"
	| "receiptPath"
	| "receiptSha256"
	| "challengePath"
	| "challengeSha256"
	| "attestationPath"
	| "attestationSha256"
	| "executionEvidencePath"
	| "executionEvidenceSha256"
> & {
	schemaVersion: "naia-memory-public-engine-receipt-v3";
	protocol: PublicEvidenceManifest["protocol"];
	caseRecords: PublicCaseRecord[];
	signatureBase64: string;
};

export type PublicDatasetCase = {
	id: string;
	language: string;
	input: string;
	expected: string[];
	forbidden?: string[];
	inputSha256: string;
};

export type PublicEvidenceDataset = {
	schemaVersion: "naia-memory-public-dataset-v2";
	cases: PublicDatasetCase[];
};

export type PublicCaseRecord = {
	caseId: string;
	inputSha256: string;
	repetition: number;
	output: string;
	outputSha256: string;
	score: number;
	failed: boolean;
	judgment: string;
	judgmentSha256: string;
};

export type PublicAdversarialReview = {
	schemaVersion: "naia-memory-public-adversarial-review-v2";
	reviewer: string;
	evidenceScopeSha256: string;
	verdict: string;
	signatureBase64: string;
};
