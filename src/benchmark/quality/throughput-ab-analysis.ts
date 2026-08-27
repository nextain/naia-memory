export interface ThroughputMeasurement {
	milliseconds: number;
	peakRssBytes: number;
	failures: number;
}

export interface CrossedWarmPair {
	pairIndex: number;
	order: "AB" | "BA";
	baseline: ThroughputMeasurement;
	candidate: ThroughputMeasurement;
}

export interface FullCorpusThroughputMeasurement extends ThroughputMeasurement {
	embeddedDocuments: number;
	cachedDocuments: number;
}

export interface ThroughputAbAnalysisOptions {
	warmPairs: CrossedWarmPair[];
	baselineFullCorpus: FullCorpusThroughputMeasurement;
	candidateFullCorpus: FullCorpusThroughputMeasurement;
}

const EXPECTED_WARM_PAIRS = 6;
const EXPECTED_DOCUMENTS = 1_486_752;
const MIN_SPEEDUP = 1.5;

function assertMeasurement(
	measurement: ThroughputMeasurement,
	label: string,
): void {
	if (
		!Number.isFinite(measurement.milliseconds) ||
		measurement.milliseconds <= 0
	)
		throw new Error(`${label}: milliseconds must be positive and finite`);
	if (
		!Number.isSafeInteger(measurement.peakRssBytes) ||
		measurement.peakRssBytes <= 0
	)
		throw new Error(`${label}: peak RSS must be a positive safe integer`);
	if (!Number.isSafeInteger(measurement.failures) || measurement.failures < 0)
		throw new Error(`${label}: failures must be a non-negative safe integer`);
}

function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = sorted.length / 2;
	const left = sorted[middle - 1];
	const right = sorted[middle];
	if (left === undefined || right === undefined)
		throw new Error("median requires a non-empty even-sized sample");
	return (left + right) / 2;
}

function fullCorpusSeconds(
	measurement: FullCorpusThroughputMeasurement,
): number {
	return measurement.milliseconds / 1_000;
}

export function analyzeThroughputAb(options: ThroughputAbAnalysisOptions) {
	if (options.warmPairs.length !== EXPECTED_WARM_PAIRS)
		throw new Error(
			`throughput A/B requires exactly ${EXPECTED_WARM_PAIRS} pairs`,
		);
	const seenPairs = new Set<number>();
	let abCount = 0;
	let baCount = 0;
	for (const [offset, pair] of options.warmPairs.entries()) {
		if (pair.pairIndex !== offset + 1 || seenPairs.has(pair.pairIndex))
			throw new Error("warm pair indices must be unique and contiguous from 1");
		seenPairs.add(pair.pairIndex);
		if (pair.order === "AB") abCount += 1;
		else baCount += 1;
		if (offset > 0 && pair.order === options.warmPairs[offset - 1]?.order)
			throw new Error("warm pair execution order must alternate");
		assertMeasurement(pair.baseline, `warm pair ${pair.pairIndex} baseline`);
		assertMeasurement(pair.candidate, `warm pair ${pair.pairIndex} candidate`);
	}
	if (abCount !== 3 || baCount !== 3)
		throw new Error("warm pair execution order must be balanced 3 AB / 3 BA");

	for (const [label, measurement] of [
		["baseline full corpus", options.baselineFullCorpus],
		["candidate full corpus", options.candidateFullCorpus],
	] as const) {
		assertMeasurement(measurement, label);
		if (
			measurement.embeddedDocuments !== EXPECTED_DOCUMENTS ||
			measurement.cachedDocuments !== 0
		)
			throw new Error(`${label}: must freshly embed the complete corpus`);
	}

	const baselineWarmMedianMilliseconds = median(
		options.warmPairs.map((pair) => pair.baseline.milliseconds),
	);
	const candidateWarmMedianMilliseconds = median(
		options.warmPairs.map((pair) => pair.candidate.milliseconds),
	);
	const warmSpeedup =
		baselineWarmMedianMilliseconds / candidateWarmMedianMilliseconds;
	const fullCorpusSpeedup =
		options.baselineFullCorpus.milliseconds /
		options.candidateFullCorpus.milliseconds;
	const warmFailures = options.warmPairs.reduce(
		(sum, pair) => sum + pair.baseline.failures + pair.candidate.failures,
		0,
	);
	const fullCorpusFailures =
		options.baselineFullCorpus.failures + options.candidateFullCorpus.failures;
	const checks = {
		balancedCrossedOrder: true,
		warmSpeedup: warmSpeedup >= MIN_SPEEDUP,
		fullCorpusSpeedup: fullCorpusSpeedup >= MIN_SPEEDUP,
		zeroWarmFailures: warmFailures === 0,
		zeroFullCorpusFailures: fullCorpusFailures === 0,
	};

	return {
		schemaVersion: 1,
		claimBoundary:
			"same-host execution throughput only; excludes retrieval quality and cross-engine speed",
		thresholds: { minimumSpeedup: MIN_SPEEDUP, warmPairs: EXPECTED_WARM_PAIRS },
		warm: {
			baselineMedianMilliseconds: baselineWarmMedianMilliseconds,
			candidateMedianMilliseconds: candidateWarmMedianMilliseconds,
			speedup: warmSpeedup,
			failures: warmFailures,
			peakRssBytes: {
				baseline: Math.max(
					...options.warmPairs.map((pair) => pair.baseline.peakRssBytes),
				),
				candidate: Math.max(
					...options.warmPairs.map((pair) => pair.candidate.peakRssBytes),
				),
			},
		},
		fullCorpus: {
			baselineSeconds: fullCorpusSeconds(options.baselineFullCorpus),
			candidateSeconds: fullCorpusSeconds(options.candidateFullCorpus),
			speedup: fullCorpusSpeedup,
			failures: fullCorpusFailures,
			peakRssBytes: {
				baseline: options.baselineFullCorpus.peakRssBytes,
				candidate: options.candidateFullCorpus.peakRssBytes,
			},
		},
		checks,
		passed: Object.values(checks).every(Boolean),
	};
}
