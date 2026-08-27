import { createPublicKey } from "node:crypto";
import {
	evidenceObjectSha256,
	hasValidEvidenceSignature,
} from "./public-evidence-crypto.js";

const SHA256 = /^[a-f0-9]{64}$/u;

export type BenchmarkSelectionCandidate = {
	id: string;
	policySha256: string;
	declaredAt: string;
};

export type BenchmarkDevelopmentObservation = {
	id: string;
	candidateId: string;
	datasetSha256: string;
	receiptSha256: string;
	primaryMetricValue: number;
	startedAt: string;
	finishedAt: string;
	previousObservationSha256: string | null;
};

export type BenchmarkSelectionDisclosure = {
	schemaVersion: "naia-memory-benchmark-selection-disclosure-v1";
	auditor: string;
	contractSha256: string;
	analysisPlanSha256: string;
	confirmatoryDatasetSha256: string;
	candidates: BenchmarkSelectionCandidate[];
	developmentObservations: BenchmarkDevelopmentObservation[];
	selectedCandidateId: string;
	selectionRule: "frozen-rule-applied-to-development-only";
	selectionAggregation: "unweighted-mean-over-identical-development-datasets";
	selectionObjective: "maximize" | "minimize";
	selectionRuleSha256: string;
	selectedAt: string;
	signedAt: string;
	statement: "ALL_KNOWN_SELECTION_TRIALS_DISCLOSED_BEFORE_CONFIRMATORY_RUN";
	signatureBase64: string;
};

export type BenchmarkSelectionDisclosureTrustPolicy = {
	auditorPublicKeys: Record<string, string>;
};

function validTime(value: string): number {
	const parsed = Date.parse(value);
	if (!Number.isFinite(parsed))
		throw new Error("selection disclosure timestamp is invalid");
	return parsed;
}

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

export function isBenchmarkSelectionDisclosure(
	value: unknown,
): value is BenchmarkSelectionDisclosure {
	return (
		isRecord(value) &&
		value.schemaVersion === "naia-memory-benchmark-selection-disclosure-v1" &&
		Array.isArray(value.candidates) &&
		Array.isArray(value.developmentObservations) &&
		typeof value.signatureBase64 === "string"
	);
}

export function isBenchmarkSelectionDisclosureTrustPolicy(
	value: unknown,
): value is BenchmarkSelectionDisclosureTrustPolicy {
	return (
		isRecord(value) &&
		isRecord(value.auditorPublicKeys) &&
		Object.keys(value.auditorPublicKeys).length > 0 &&
		Object.entries(value.auditorPublicKeys).every(
			([identity, key]) => identity.trim().length > 0 && isEd25519Key(key),
		)
	);
}

export function benchmarkObservationSha256(
	observation: BenchmarkDevelopmentObservation,
): string {
	return evidenceObjectSha256(observation);
}

export function validateBenchmarkSelectionDisclosure(input: {
	disclosure: BenchmarkSelectionDisclosure;
	trustPolicy: BenchmarkSelectionDisclosureTrustPolicy;
	expectedContractSha256: string;
	expectedAnalysisPlanSha256: string;
	firstConfirmatoryExecutionStartedAt: string;
	forbiddenTrustIdentities?: Iterable<string>;
	forbiddenTrustPublicKeys?: Iterable<string>;
}): {
	selectionHistoryQualified: true;
	selectionDisclosureInternallyConsistent: true;
	developmentObservationReceiptsExternallyVerified: false;
	selectionHistoryCompletenessExternallyVerified: false;
	candidateCount: number;
	developmentObservationCount: number;
	selectedPolicySha256: string;
} {
	const { disclosure } = input;
	if (
		disclosure.schemaVersion !==
			"naia-memory-benchmark-selection-disclosure-v1" ||
		!validId(disclosure.auditor) ||
		!validHash(disclosure.contractSha256) ||
		!validHash(disclosure.analysisPlanSha256) ||
		!validHash(disclosure.confirmatoryDatasetSha256) ||
		!validHash(disclosure.selectionRuleSha256) ||
		disclosure.selectionRule !== "frozen-rule-applied-to-development-only" ||
		disclosure.selectionAggregation !==
			"unweighted-mean-over-identical-development-datasets" ||
		!["maximize", "minimize"].includes(disclosure.selectionObjective) ||
		disclosure.statement !==
			"ALL_KNOWN_SELECTION_TRIALS_DISCLOSED_BEFORE_CONFIRMATORY_RUN" ||
		!Array.isArray(disclosure.candidates) ||
		disclosure.candidates.length === 0 ||
		!Array.isArray(disclosure.developmentObservations) ||
		disclosure.developmentObservations.length === 0 ||
		!validId(disclosure.selectedCandidateId)
	)
		throw new Error("selection disclosure shape is invalid");
	if (
		disclosure.contractSha256 !== input.expectedContractSha256 ||
		disclosure.analysisPlanSha256 !== input.expectedAnalysisPlanSha256
	)
		throw new Error("selection disclosure benchmark binding is invalid");

	const candidateIds = new Set<string>();
	const policyHashes = new Set<string>();
	const candidates = new Map<string, BenchmarkSelectionCandidate>();
	for (const candidate of disclosure.candidates) {
		if (
			!validId(candidate.id) ||
			!validHash(candidate.policySha256) ||
			candidateIds.has(candidate.id) ||
			policyHashes.has(candidate.policySha256)
		)
			throw new Error("selection disclosure candidate registry is invalid");
		validTime(candidate.declaredAt);
		candidateIds.add(candidate.id);
		policyHashes.add(candidate.policySha256);
		candidates.set(candidate.id, candidate);
	}
	const selected = candidates.get(disclosure.selectedCandidateId);
	if (!selected)
		throw new Error("selected benchmark candidate is not declared");

	let previousHash: string | null = null;
	let previousFinishedAt = Number.NEGATIVE_INFINITY;
	const observationIds = new Set<string>();
	const observedCandidates = new Set<string>();
	const datasetsByCandidate = new Map<string, Set<string>>();
	const metricSums = new Map<string, { sum: number; count: number }>();
	const replayKeys = new Set<string>();
	const receiptHashes = new Set<string>();
	for (const observation of disclosure.developmentObservations) {
		if (
			!validId(observation.id) ||
			observationIds.has(observation.id) ||
			!candidates.has(observation.candidateId) ||
			!validHash(observation.datasetSha256) ||
			!validHash(observation.receiptSha256) ||
			!Number.isFinite(observation.primaryMetricValue) ||
			observation.datasetSha256 === disclosure.confirmatoryDatasetSha256 ||
			observation.previousObservationSha256 !== previousHash
		)
			throw new Error("selection disclosure observation chain is invalid");
		const startedAt = validTime(observation.startedAt);
		const finishedAt = validTime(observation.finishedAt);
		const candidate = candidates.get(
			observation.candidateId,
		) as BenchmarkSelectionCandidate;
		if (
			finishedAt < startedAt ||
			startedAt < validTime(candidate.declaredAt) ||
			startedAt < previousFinishedAt
		)
			throw new Error("selection disclosure observation chronology is invalid");
		const replayKey = `${observation.candidateId}\0${observation.datasetSha256}`;
		if (replayKeys.has(replayKey))
			throw new Error(
				"selection disclosure contains a repeated candidate/dataset trial",
			);
		if (receiptHashes.has(observation.receiptSha256))
			throw new Error("selection disclosure reuses an observation receipt");
		replayKeys.add(replayKey);
		receiptHashes.add(observation.receiptSha256);
		observationIds.add(observation.id);
		observedCandidates.add(observation.candidateId);
		const datasets =
			datasetsByCandidate.get(observation.candidateId) ?? new Set<string>();
		datasets.add(observation.datasetSha256);
		datasetsByCandidate.set(observation.candidateId, datasets);
		const metric = metricSums.get(observation.candidateId) ?? {
			sum: 0,
			count: 0,
		};
		metric.sum += observation.primaryMetricValue;
		metric.count += 1;
		metricSums.set(observation.candidateId, metric);
		previousFinishedAt = finishedAt;
		previousHash = benchmarkObservationSha256(observation);
	}
	if (!observedCandidates.has(disclosure.selectedCandidateId))
		throw new Error("selected benchmark candidate lacks development evidence");
	const canonicalCoverage = [
		...(datasetsByCandidate.values().next().value ?? []),
	]
		.sort()
		.join("\0");
	if (
		observedCandidates.size !== candidates.size ||
		[...datasetsByCandidate.values()].some(
			(datasets) => [...datasets].sort().join("\0") !== canonicalCoverage,
		)
	)
		throw new Error("selection disclosure candidate coverage is asymmetric");
	const ranked = [...metricSums.entries()].sort((left, right) => {
		const leftMean = left[1].sum / left[1].count;
		const rightMean = right[1].sum / right[1].count;
		const metricOrder =
			disclosure.selectionObjective === "maximize"
				? rightMean - leftMean
				: leftMean - rightMean;
		return (
			metricOrder || (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0)
		);
	});
	if (ranked[0]?.[0] !== disclosure.selectedCandidateId)
		throw new Error("selected benchmark candidate violates the frozen rule");

	const selectedAt = validTime(disclosure.selectedAt);
	const signedAt = validTime(disclosure.signedAt);
	const confirmatoryStartedAt = validTime(
		input.firstConfirmatoryExecutionStartedAt,
	);
	if (
		selectedAt < previousFinishedAt ||
		signedAt < selectedAt ||
		signedAt >= confirmatoryStartedAt
	)
		throw new Error("selection disclosure was not frozen before confirmation");

	const publicKey = input.trustPolicy.auditorPublicKeys[disclosure.auditor];
	if (!publicKey || !hasValidEvidenceSignature(disclosure, publicKey))
		throw new Error("selection disclosure signature is invalid");
	const forbiddenIdentities = new Set(input.forbiddenTrustIdentities ?? []);
	const normalizedKey = createPublicKey(publicKey)
		.export({ type: "spki", format: "der" })
		.toString("base64");
	const forbiddenKeys = new Set(
		[...(input.forbiddenTrustPublicKeys ?? [])].map((key) =>
			createPublicKey(key)
				.export({ type: "spki", format: "der" })
				.toString("base64"),
		),
	);
	if (
		forbiddenIdentities.has(disclosure.auditor) ||
		forbiddenKeys.has(normalizedKey)
	)
		throw new Error("selection disclosure auditor overlaps another role");

	return {
		selectionHistoryQualified: true,
		selectionDisclosureInternallyConsistent: true,
		developmentObservationReceiptsExternallyVerified: false,
		selectionHistoryCompletenessExternallyVerified: false,
		candidateCount: candidates.size,
		developmentObservationCount: disclosure.developmentObservations.length,
		selectedPolicySha256: selected.policySha256,
	};
}
