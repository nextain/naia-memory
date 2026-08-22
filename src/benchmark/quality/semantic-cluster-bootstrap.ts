import { createHash } from "node:crypto";

export const SEMANTIC_BOOTSTRAP_ITERATIONS = 10_000;

const METRICS = [
	"currentAt1",
	"currentAtK",
	"staleExposureAtK",
	"deletionLeakageAtK",
] as const;

type Metric = (typeof METRICS)[number];

export type SemanticBootstrapSample = {
	engine: string;
	language: string;
	familyId: string;
	currentAt1: number | null;
	currentAtK: number | null;
	staleExposureAtK: number | null;
	deletionLeakageAtK: number | null;
};

type Interval = {
	estimate: number;
	lower: number;
	upper: number;
	independentClusters: number;
};

// Mulberry32: a compact deterministic generator suitable for reproducible resampling.
function mulberry32(seed: string): () => number {
	const bytes = createHash("sha256").update(seed).digest();
	let state = bytes.readUInt32LE(0);
	return () => {
		state += 0x6d2b79f5;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
}

function mean(
	samples: SemanticBootstrapSample[],
	metric: Metric,
): number | null {
	const eligible = samples.flatMap((sample) => {
		const value = sample[metric];
		return value === null ? [] : [value];
	});
	return eligible.length === 0
		? null
		: eligible.reduce((sum, value) => sum + value, 0) / eligible.length;
}

function percentile(sorted: number[], probability: number): number {
	const position = (sorted.length - 1) * probability;
	const lower = Math.floor(position);
	const upper = Math.ceil(position);
	if (lower === upper) return sorted[lower];
	const fraction = position - lower;
	return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
}

function enginePairs(engines: string[]): Array<[string, string]> {
	return engines.flatMap((left, index) =>
		engines.slice(index + 1).map((right) => [left, right] as [string, string]),
	);
}

export function calculateSemanticClusterBootstrap(
	samples: SemanticBootstrapSample[],
	seedMaterial: string,
) {
	if (samples.length === 0) throw new Error("bootstrap requires samples");
	if (
		samples.some(
			(sample) =>
				!sample.engine.trim() ||
				!sample.language.trim() ||
				!sample.familyId.trim() ||
				METRICS.some(
					(metric) =>
						sample[metric] !== null &&
						sample[metric] !== 0 &&
						sample[metric] !== 1,
				),
		)
	)
		throw new Error(
			"bootstrap samples must have identities and binary or null metrics",
		);

	const seedSha256 = createHash("sha256").update(seedMaterial).digest("hex");
	const random = mulberry32(seedSha256);
	const intervals: Record<string, Record<Metric, Interval | null>> = {};
	const pairedDifferences: Array<{
		leftEngine: string;
		rightEngine: string;
		language: string;
		metric: Metric;
		preferredDirection: "higher" | "lower";
		estimate: number;
		lower: number;
		upper: number;
		independentClusters: number;
	}> = [];

	for (const language of [
		...new Set(samples.map((sample) => sample.language)),
	].sort()) {
		const languageSamples = samples.filter(
			(sample) => sample.language === language,
		);
		const engines = [
			...new Set(languageSamples.map((sample) => sample.engine)),
		].sort();
		const families = [
			...new Set(languageSamples.map((sample) => sample.familyId)),
		].sort();
		const byEngineFamily = new Map<string, SemanticBootstrapSample[]>();
		for (const sample of languageSamples) {
			const key = `${sample.engine}\0${sample.familyId}`;
			const current = byEngineFamily.get(key) ?? [];
			current.push(sample);
			byEngineFamily.set(key, current);
		}
		for (const engine of engines)
			for (const family of families)
				if (!byEngineFamily.has(`${engine}\0${family}`))
					throw new Error(
						`paired bootstrap coverage mismatch: ${engine}/${language}/${family}`,
					);
		for (const family of families) {
			const repetitionCounts = engines.map(
				(engine) => byEngineFamily.get(`${engine}\0${family}`)?.length ?? 0,
			);
			if (new Set(repetitionCounts).size !== 1)
				throw new Error(
					`paired bootstrap repetition mismatch: ${language}/${family}`,
				);
		}
		const familySizes = families.map(
			(family) => byEngineFamily.get(`${engines[0]}\0${family}`)?.length ?? 0,
		);
		if (new Set(familySizes).size !== 1)
			throw new Error(
				`cluster bootstrap requires equal family sizes: ${language}`,
			);

		const distributions = new Map<string, number[]>();
		const eligibleFamilies = new Map<Metric, string[]>();
		for (const engine of engines)
			for (const metric of METRICS)
				distributions.set(`${engine}\0${metric}`, []);
		for (const metric of METRICS) {
			const metricFamilies = families.filter((family) => {
				const engineEligibility = engines.map((engine) => {
					const observations = byEngineFamily.get(`${engine}\0${family}`) ?? [];
					const flags = observations.map((sample) => sample[metric] !== null);
					if (new Set(flags).size !== 1)
						throw new Error(
							`metric eligibility varies within family: ${engine}/${language}/${family}/${metric}`,
						);
					return flags[0];
				});
				if (new Set(engineEligibility).size !== 1)
					throw new Error(
						`paired metric eligibility mismatch: ${language}/${family}/${metric}`,
					);
				return engineEligibility[0];
			});
			eligibleFamilies.set(metric, metricFamilies);
			if (metricFamilies.length === 0) continue;
			for (
				let iteration = 0;
				iteration < SEMANTIC_BOOTSTRAP_ITERATIONS;
				iteration++
			) {
				const drawnFamilies = Array.from(
					{ length: metricFamilies.length },
					() => metricFamilies[Math.floor(random() * metricFamilies.length)],
				);
				for (const engine of engines) {
					const drawn = drawnFamilies.flatMap(
						(family) => byEngineFamily.get(`${engine}\0${family}`) ?? [],
					);
					const estimate = mean(drawn, metric);
					if (estimate === null)
						throw new Error("eligible bootstrap draw has no observations");
					distributions.get(`${engine}\0${metric}`)?.push(estimate);
				}
			}
		}

		for (const engine of engines) {
			const engineSamples = languageSamples.filter(
				(sample) => sample.engine === engine,
			);
			const key = `${engine}/${language}`;
			intervals[key] = {} as Record<Metric, Interval | null>;
			for (const metric of METRICS) {
				const values = distributions.get(`${engine}\0${metric}`);
				const distribution = values
					? [...values].sort((left, right) => left - right)
					: undefined;
				if (!distribution) throw new Error("missing bootstrap distribution");
				const estimate = mean(engineSamples, metric);
				if (estimate === null) {
					intervals[key][metric] = null;
					continue;
				}
				intervals[key][metric] = {
					estimate,
					lower: percentile(distribution, 0.025),
					upper: percentile(distribution, 0.975),
					independentClusters: eligibleFamilies.get(metric)?.length ?? 0,
				};
			}
		}

		for (const [leftEngine, rightEngine] of enginePairs(engines))
			for (const metric of METRICS) {
				const left = distributions.get(`${leftEngine}\0${metric}`);
				const right = distributions.get(`${rightEngine}\0${metric}`);
				if (!left || !right) throw new Error("missing paired distribution");
				const leftInterval = intervals[`${leftEngine}/${language}`][metric];
				const rightInterval = intervals[`${rightEngine}/${language}`][metric];
				if (!leftInterval || !rightInterval) continue;
				const differences = left
					.map((value, index) => value - right[index])
					.sort((a, b) => a - b);
				pairedDifferences.push({
					leftEngine,
					rightEngine,
					language,
					metric,
					preferredDirection:
						metric === "currentAt1" || metric === "currentAtK"
							? "higher"
							: "lower",
					estimate: leftInterval.estimate - rightInterval.estimate,
					lower: percentile(differences, 0.025),
					upper: percentile(differences, 0.975),
					independentClusters: eligibleFamilies.get(metric)?.length ?? 0,
				});
			}
	}

	return {
		method:
			"metric-eligible-paired-family-cluster-percentile-bootstrap-v2" as const,
		confidenceLevel: 0.95,
		iterations: SEMANTIC_BOOTSTRAP_ITERATIONS,
		resamplingUnit: "familyId" as const,
		minimumRecommendedClusters: 10,
		hasSparseClusterWarning: Object.values(intervals).some((metrics) =>
			Object.values(metrics).some(
				(interval) => interval !== null && interval.independentClusters < 10,
			),
		),
		multiplicityAdjustment: "none" as const,
		seedSha256,
		intervals,
		pairedDifferences,
	};
}
