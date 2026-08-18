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
	schemaVersion: "naia-memory-public-evidence-v4";
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
	challengeIssuerPublicKeys: Record<string, string>;
	runnerPublicKeys: Record<string, string>;
	approvedScoringPolicies: Record<string, string>;
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
