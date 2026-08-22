import { createHash } from "node:crypto";
import {
	type CrossedWarmPair,
	type FullCorpusThroughputMeasurement,
	analyzeThroughputAb,
} from "./throughput-ab-analysis.js";

interface PolicyIdentity {
	label: "baseline" | "candidate";
	policySha256: string;
	inferenceMode: "per-item-v1" | "padded-array-batch-v1";
	embeddingBatchSize: number;
	inputOrder: "corpus-ordinal-stable-v1";
	transformersVersion: string;
}

interface ExecutionObservation {
	label: string;
	policySha256: string;
	hostBootId: string;
	commandSha256: string;
	stdoutSha256: string;
	startedAt: string;
	completedAt: string;
	milliseconds: number;
	peakRssBytes: number;
	failures: number;
}

interface WarmPairEvidence {
	pairIndex: number;
	order: "AB" | "BA";
	baseline: ExecutionObservation;
	candidate: ExecutionObservation;
}

interface FullCorpusEvidence extends ExecutionObservation {
	embeddedDocuments: number;
	cachedDocuments: number;
}

export interface ThroughputAbEvidence {
	schemaVersion: 1;
	benchmark: "miracl-ko-per-item-vs-true-batch-throughput-ab-v1";
	hostBootId: string;
	policies: {
		baseline: PolicyIdentity;
		candidate: PolicyIdentity;
	};
	warmPairs: WarmPairEvidence[];
	fullCorpus: {
		baseline: FullCorpusEvidence;
		candidate: FullCorpusEvidence;
	};
}

const SHA256 = /^[a-f0-9]{64}$/;
const BOOT_ID = /^[a-f0-9-]{36}$/;

function assertIso(value: string, label: string): number {
	const timestamp = Date.parse(value);
	if (
		!Number.isFinite(timestamp) ||
		new Date(timestamp).toISOString() !== value
	)
		throw new Error(`${label}: timestamp must be canonical ISO-8601 UTC`);
	return timestamp;
}

function assertPolicy(
	policy: PolicyIdentity,
	expectedLabel: PolicyIdentity["label"],
): void {
	if (policy.label !== expectedLabel)
		throw new Error(`${expectedLabel} policy label mismatch`);
	if (!SHA256.test(policy.policySha256))
		throw new Error(`${expectedLabel} policy hash is invalid`);
	if (
		!Number.isSafeInteger(policy.embeddingBatchSize) ||
		policy.embeddingBatchSize !== 8
	)
		throw new Error(`${expectedLabel} embedding batch size must be 8`);
	if (!policy.transformersVersion.trim())
		throw new Error(`${expectedLabel} Transformers version is missing`);
	if (policy.inputOrder !== "corpus-ordinal-stable-v1")
		throw new Error(`${expectedLabel} input order mismatch`);
}

function validateObservation(
	observation: ExecutionObservation,
	label: string,
	hostBootId: string,
	policySha256: string,
): { startedAt: number; completedAt: number } {
	if (observation.label !== label)
		throw new Error(`${label}: observation label mismatch`);
	if (observation.hostBootId !== hostBootId)
		throw new Error(`${label}: host boot identity mismatch`);
	if (observation.policySha256 !== policySha256)
		throw new Error(`${label}: policy identity mismatch`);
	for (const [name, digest] of [
		["command", observation.commandSha256],
		["stdout", observation.stdoutSha256],
	] as const)
		if (!SHA256.test(digest))
			throw new Error(`${label}: ${name} hash is invalid`);
	const startedAt = assertIso(observation.startedAt, `${label} start`);
	const completedAt = assertIso(observation.completedAt, `${label} completion`);
	if (completedAt <= startedAt)
		throw new Error(`${label}: completion must follow start`);
	if (
		!Number.isFinite(observation.milliseconds) ||
		observation.milliseconds <= 0
	)
		throw new Error(`${label}: elapsed time must be positive and finite`);
	const wallMilliseconds = completedAt - startedAt;
	if (
		Math.abs(wallMilliseconds - observation.milliseconds) >
		Math.max(1_000, wallMilliseconds * 0.02)
	)
		throw new Error(
			`${label}: elapsed time disagrees with observation chronology`,
		);
	return { startedAt, completedAt };
}

function measurement(observation: ExecutionObservation) {
	return {
		milliseconds: observation.milliseconds,
		peakRssBytes: observation.peakRssBytes,
		failures: observation.failures,
	};
}

export function verifyAndAnalyzeThroughputAbEvidence(
	evidence: ThroughputAbEvidence,
) {
	if (evidence.schemaVersion !== 1)
		throw new Error("unsupported throughput evidence schema");
	if (
		evidence.benchmark !== "miracl-ko-per-item-vs-true-batch-throughput-ab-v1"
	)
		throw new Error("throughput benchmark identity mismatch");
	if (!BOOT_ID.test(evidence.hostBootId))
		throw new Error("host boot identity is invalid");
	assertPolicy(evidence.policies.baseline, "baseline");
	assertPolicy(evidence.policies.candidate, "candidate");
	if (evidence.policies.baseline.inferenceMode !== "per-item-v1")
		throw new Error("baseline inference mode mismatch");
	if (evidence.policies.candidate.inferenceMode !== "padded-array-batch-v1")
		throw new Error("candidate inference mode mismatch");
	if (
		evidence.policies.baseline.policySha256 ===
		evidence.policies.candidate.policySha256
	)
		throw new Error("A/B policy identities must differ");

	let previousPairCompletedAt = Number.NEGATIVE_INFINITY;
	const warmPairs: CrossedWarmPair[] = evidence.warmPairs.map((pair) => {
		const prefix = `warm-${pair.pairIndex}`;
		const baselineTime = validateObservation(
			pair.baseline,
			`${prefix}-baseline`,
			evidence.hostBootId,
			evidence.policies.baseline.policySha256,
		);
		const candidateTime = validateObservation(
			pair.candidate,
			`${prefix}-candidate`,
			evidence.hostBootId,
			evidence.policies.candidate.policySha256,
		);
		const first = pair.order === "AB" ? baselineTime : candidateTime;
		const second = pair.order === "AB" ? candidateTime : baselineTime;
		if (first.completedAt > second.startedAt)
			throw new Error(
				`${prefix}: timestamps contradict declared ${pair.order} order`,
			);
		if (first.startedAt < previousPairCompletedAt)
			throw new Error(`${prefix}: warm pairs overlap or are out of sequence`);
		previousPairCompletedAt = second.completedAt;
		return {
			pairIndex: pair.pairIndex,
			order: pair.order,
			baseline: measurement(pair.baseline),
			candidate: measurement(pair.candidate),
		};
	});
	validateObservation(
		evidence.fullCorpus.baseline,
		"full-corpus-baseline",
		evidence.hostBootId,
		evidence.policies.baseline.policySha256,
	);
	validateObservation(
		evidence.fullCorpus.candidate,
		"full-corpus-candidate",
		evidence.hostBootId,
		evidence.policies.candidate.policySha256,
	);
	const baselineFullCorpus: FullCorpusThroughputMeasurement = {
		...measurement(evidence.fullCorpus.baseline),
		embeddedDocuments: evidence.fullCorpus.baseline.embeddedDocuments,
		cachedDocuments: evidence.fullCorpus.baseline.cachedDocuments,
	};
	const candidateFullCorpus: FullCorpusThroughputMeasurement = {
		...measurement(evidence.fullCorpus.candidate),
		embeddedDocuments: evidence.fullCorpus.candidate.embeddedDocuments,
		cachedDocuments: evidence.fullCorpus.candidate.cachedDocuments,
	};
	const serializedEvidence = `${JSON.stringify(evidence, null, 2)}\n`;
	return {
		schemaVersion: 1,
		claimBoundary:
			"structurally bound same-host A/B observations; authenticity still requires the controlled execution runner",
		evidenceSha256: createHash("sha256")
			.update(serializedEvidence)
			.digest("hex"),
		analysis: analyzeThroughputAb({
			warmPairs,
			baselineFullCorpus,
			candidateFullCorpus,
		}),
	};
}
