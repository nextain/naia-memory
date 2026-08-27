import { createPublicKey } from "node:crypto";
import type { BenchmarkDevelopmentObservation } from "./benchmark-selection-disclosure.js";
import {
	evidenceObjectSha256,
	hasValidEvidenceSignature,
} from "./public-evidence-crypto.js";

const SHA256 = /^[a-f0-9]{64}$/u;

export type BenchmarkDevelopmentExecutionPlan = {
	schemaVersion: "naia-memory-benchmark-development-execution-plan-v1";
	administrator: string;
	selectionRuleSha256: string;
	confirmatoryDatasetSha256: string;
	candidates: Array<{ id: string; policySha256: string }>;
	datasetSha256s: string[];
	createdAt: string;
	signedAt: string;
	statement: "COMPLETE_DEVELOPMENT_MATRIX_FROZEN_BEFORE_EXECUTION";
	signatureBase64: string;
};

export type BenchmarkDevelopmentExecutionReceipt = {
	schemaVersion: "naia-memory-benchmark-development-execution-receipt-v1";
	executor: string;
	planSha256: string;
	candidateId: string;
	policySha256: string;
	datasetSha256: string;
	primaryMetricValue: number;
	startedAt: string;
	finishedAt: string;
	signedAt: string;
	statement: "DEVELOPMENT_EXECUTION_CONFIRMED";
	signatureBase64: string;
};

export type BenchmarkDevelopmentExecutionEvidence = {
	schemaVersion: "naia-memory-benchmark-development-execution-evidence-v1";
	plan: BenchmarkDevelopmentExecutionPlan;
	receipts: BenchmarkDevelopmentExecutionReceipt[];
};

export type BenchmarkDevelopmentExecutionTrustPolicy = {
	administratorPublicKeys: Record<string, string>;
	executorPublicKeys: Record<string, string>;
};

function validId(value: unknown): value is string {
	return (
		typeof value === "string" && value.trim() === value && value.length > 0
	);
}

function validHash(value: unknown): value is string {
	return typeof value === "string" && SHA256.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEd25519Key(value: unknown): value is string {
	if (typeof value !== "string") return false;
	try {
		return createPublicKey(value).asymmetricKeyType === "ed25519";
	} catch {
		return false;
	}
}

export function isBenchmarkDevelopmentExecutionEvidence(
	value: unknown,
): value is BenchmarkDevelopmentExecutionEvidence {
	return (
		isRecord(value) &&
		value.schemaVersion ===
			"naia-memory-benchmark-development-execution-evidence-v1" &&
		isRecord(value.plan) &&
		Array.isArray(value.receipts)
	);
}

export function isBenchmarkDevelopmentExecutionTrustPolicy(
	value: unknown,
): value is BenchmarkDevelopmentExecutionTrustPolicy {
	return (
		isRecord(value) &&
		isRecord(value.administratorPublicKeys) &&
		isRecord(value.executorPublicKeys) &&
		Object.keys(value.administratorPublicKeys).length > 0 &&
		Object.keys(value.executorPublicKeys).length > 0 &&
		[
			...Object.entries(value.administratorPublicKeys),
			...Object.entries(value.executorPublicKeys),
		].every(
			([identity, key]) => identity.trim().length > 0 && isEd25519Key(key),
		)
	);
}

function validTime(value: string): number {
	const parsed = Date.parse(value);
	if (!Number.isFinite(parsed))
		throw new Error("development execution evidence timestamp is invalid");
	return parsed;
}

function normalizedKey(value: string): string {
	return createPublicKey(value)
		.export({ type: "spki", format: "der" })
		.toString("base64");
}

export function benchmarkDevelopmentReceiptSha256(
	receipt: BenchmarkDevelopmentExecutionReceipt,
): string {
	return evidenceObjectSha256(receipt);
}

export function validateBenchmarkDevelopmentExecutionEvidence(input: {
	evidence: BenchmarkDevelopmentExecutionEvidence;
	trustPolicy: BenchmarkDevelopmentExecutionTrustPolicy;
	expectedSelectionRuleSha256: string;
	expectedConfirmatoryDatasetSha256: string;
	trustedPlanTimestampedAt: string;
	expectedObservations?: BenchmarkDevelopmentObservation[];
	forbiddenTrustIdentities?: Iterable<string>;
	forbiddenTrustPublicKeys?: Iterable<string>;
}): {
	developmentObservationReceiptsExternallyVerified: true;
	timestampedDevelopmentMatrixCoverageVerified: true;
	selectionHistoryCompletenessExternallyVerified: false;
	developmentExecutionPlanTrustedTimestampVerified: true;
	receiptCount: number;
	planSha256: string;
} {
	const { evidence, trustPolicy } = input;
	const { plan } = evidence;
	if (
		evidence.schemaVersion !==
			"naia-memory-benchmark-development-execution-evidence-v1" ||
		plan.schemaVersion !==
			"naia-memory-benchmark-development-execution-plan-v1" ||
		!validId(plan.administrator) ||
		!validHash(plan.selectionRuleSha256) ||
		!validHash(plan.confirmatoryDatasetSha256) ||
		plan.statement !== "COMPLETE_DEVELOPMENT_MATRIX_FROZEN_BEFORE_EXECUTION" ||
		!Array.isArray(plan.candidates) ||
		plan.candidates.length === 0 ||
		!Array.isArray(plan.datasetSha256s) ||
		plan.datasetSha256s.length === 0 ||
		!Array.isArray(evidence.receipts)
	)
		throw new Error("development execution evidence shape is invalid");
	if (
		plan.selectionRuleSha256 !== input.expectedSelectionRuleSha256 ||
		plan.confirmatoryDatasetSha256 !== input.expectedConfirmatoryDatasetSha256
	)
		throw new Error("development execution plan binding is invalid");

	const candidateIds = new Set<string>();
	const policyHashes = new Set<string>();
	const policyByCandidate = new Map<string, string>();
	for (const candidate of plan.candidates) {
		if (
			!validId(candidate.id) ||
			!validHash(candidate.policySha256) ||
			candidateIds.has(candidate.id) ||
			policyHashes.has(candidate.policySha256)
		)
			throw new Error("development execution candidate registry is invalid");
		candidateIds.add(candidate.id);
		policyHashes.add(candidate.policySha256);
		policyByCandidate.set(candidate.id, candidate.policySha256);
	}
	const datasets = new Set(plan.datasetSha256s);
	if (
		datasets.size !== plan.datasetSha256s.length ||
		plan.datasetSha256s.some(
			(hash) => !validHash(hash) || hash === plan.confirmatoryDatasetSha256,
		)
	)
		throw new Error("development execution dataset registry is invalid");

	const createdAt = validTime(plan.createdAt);
	const signedAt = validTime(plan.signedAt);
	const timestampedAt = validTime(input.trustedPlanTimestampedAt);
	if (signedAt < createdAt || timestampedAt < signedAt)
		throw new Error("development execution plan chronology is invalid");
	const administratorKey =
		trustPolicy.administratorPublicKeys[plan.administrator];
	if (!administratorKey || !hasValidEvidenceSignature(plan, administratorKey))
		throw new Error("development execution plan signature is invalid");

	const forbiddenIdentities = new Set(input.forbiddenTrustIdentities ?? []);
	const forbiddenKeys = new Set(
		[...(input.forbiddenTrustPublicKeys ?? [])].map(normalizedKey),
	);
	const trustKeys = [
		...Object.values(trustPolicy.administratorPublicKeys),
		...Object.values(trustPolicy.executorPublicKeys),
	].map(normalizedKey);
	if (new Set(trustKeys).size !== trustKeys.length)
		throw new Error("development execution trust keys must be globally unique");
	const administratorKeyId = normalizedKey(administratorKey);
	if (
		forbiddenIdentities.has(plan.administrator) ||
		forbiddenKeys.has(administratorKeyId)
	)
		throw new Error(
			"development execution administrator overlaps another role",
		);

	const expectedPairs = new Set<string>();
	for (const candidateId of candidateIds)
		for (const datasetSha256 of datasets)
			expectedPairs.add(`${candidateId}\0${datasetSha256}`);
	if (evidence.receipts.length !== expectedPairs.size)
		throw new Error("development execution receipt coverage is incomplete");
	const planSha256 = evidenceObjectSha256(plan);
	const seenPairs = new Set<string>();
	const seenReceiptHashes = new Set<string>();
	const receiptsByHash = new Map<
		string,
		BenchmarkDevelopmentExecutionReceipt
	>();
	for (const receipt of evidence.receipts) {
		const pair = `${receipt.candidateId}\0${receipt.datasetSha256}`;
		const executorKey = trustPolicy.executorPublicKeys[receipt.executor];
		const startedAt = validTime(receipt.startedAt);
		const finishedAt = validTime(receipt.finishedAt);
		const receiptSignedAt = validTime(receipt.signedAt);
		if (
			receipt.schemaVersion !==
				"naia-memory-benchmark-development-execution-receipt-v1" ||
			!validId(receipt.executor) ||
			receipt.planSha256 !== planSha256 ||
			!expectedPairs.has(pair) ||
			seenPairs.has(pair) ||
			receipt.policySha256 !== policyByCandidate.get(receipt.candidateId) ||
			!Number.isFinite(receipt.primaryMetricValue) ||
			startedAt <= timestampedAt ||
			finishedAt < startedAt ||
			receiptSignedAt < finishedAt ||
			receipt.statement !== "DEVELOPMENT_EXECUTION_CONFIRMED" ||
			!executorKey ||
			!hasValidEvidenceSignature(receipt, executorKey)
		)
			throw new Error("development execution receipt is invalid");
		const receiptHash = benchmarkDevelopmentReceiptSha256(receipt);
		if (seenReceiptHashes.has(receiptHash))
			throw new Error("development execution receipt is reused");
		if (
			forbiddenIdentities.has(receipt.executor) ||
			forbiddenKeys.has(normalizedKey(executorKey)) ||
			receipt.executor === plan.administrator ||
			normalizedKey(executorKey) === administratorKeyId
		)
			throw new Error("development execution role independence is invalid");
		seenPairs.add(pair);
		seenReceiptHashes.add(receiptHash);
		receiptsByHash.set(receiptHash, receipt);
	}
	if (seenPairs.size !== expectedPairs.size)
		throw new Error("development execution receipt coverage is incomplete");
	if (input.expectedObservations) {
		if (input.expectedObservations.length !== evidence.receipts.length)
			throw new Error("development disclosure receipt coverage is incomplete");
		for (const observation of input.expectedObservations) {
			const receipt = receiptsByHash.get(observation.receiptSha256);
			if (
				!receipt ||
				receipt.candidateId !== observation.candidateId ||
				receipt.datasetSha256 !== observation.datasetSha256 ||
				receipt.primaryMetricValue !== observation.primaryMetricValue ||
				receipt.startedAt !== observation.startedAt ||
				receipt.finishedAt !== observation.finishedAt
			)
				throw new Error(
					"development disclosure observation binding is invalid",
				);
		}
	}
	return {
		developmentObservationReceiptsExternallyVerified: true,
		timestampedDevelopmentMatrixCoverageVerified: true,
		selectionHistoryCompletenessExternallyVerified: false,
		developmentExecutionPlanTrustedTimestampVerified: true,
		receiptCount: evidence.receipts.length,
		planSha256,
	};
}
