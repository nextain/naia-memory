import { describe, expect, it } from "vitest";
import {
	type CrossedWarmPair,
	type FullCorpusThroughputMeasurement,
	analyzeThroughputAb,
} from "./throughput-ab-analysis.js";

function warmPairs(candidateMilliseconds = 40): CrossedWarmPair[] {
	return Array.from({ length: 6 }, (_, offset) => ({
		pairIndex: offset + 1,
		order: offset % 2 === 0 ? "AB" : "BA",
		baseline: { milliseconds: 100 + offset, peakRssBytes: 1_000, failures: 0 },
		candidate: {
			milliseconds: candidateMilliseconds + offset,
			peakRssBytes: 1_200,
			failures: 0,
		},
	}));
}

function full(milliseconds: number): FullCorpusThroughputMeasurement {
	return {
		milliseconds,
		peakRssBytes: 2_000,
		failures: 0,
		embeddedDocuments: 1_486_752,
		cachedDocuments: 0,
	};
}

function pairAt(pairs: CrossedWarmPair[], index: number): CrossedWarmPair {
	const pair = pairs[index];
	if (!pair) throw new Error(`missing test pair ${index}`);
	return pair;
}

describe("throughput A/B analysis", () => {
	it("passes balanced crossed measurements above both speedup floors", () => {
		const result = analyzeThroughputAb({
			warmPairs: warmPairs(),
			baselineFullCorpus: full(150_000),
			candidateFullCorpus: full(90_000),
		});
		expect(result.passed).toBe(true);
		expect(result.warm.speedup).toBeGreaterThan(2);
		expect(result.fullCorpus.speedup).toBeCloseTo(5 / 3);
		expect(result.warm.peakRssBytes).toEqual({
			baseline: 1_000,
			candidate: 1_200,
		});
	});

	it("fails adoption when either speedup floor or failure gate misses", () => {
		const pairs = warmPairs(80);
		pairAt(pairs, 0).candidate.failures = 1;
		const result = analyzeThroughputAb({
			warmPairs: pairs,
			baselineFullCorpus: full(150_000),
			candidateFullCorpus: full(110_000),
		});
		expect(result.passed).toBe(false);
		expect(result.checks).toMatchObject({
			warmSpeedup: false,
			fullCorpusSpeedup: false,
			zeroWarmFailures: false,
		});
	});

	it("rejects unbalanced ordering and cached full-corpus work", () => {
		const unbalanced = warmPairs();
		pairAt(unbalanced, 1).order = "AB";
		expect(() =>
			analyzeThroughputAb({
				warmPairs: unbalanced,
				baselineFullCorpus: full(150_000),
				candidateFullCorpus: full(90_000),
			}),
		).toThrow("must alternate");
		const cached = full(90_000);
		cached.cachedDocuments = 1;
		expect(() =>
			analyzeThroughputAb({
				warmPairs: warmPairs(),
				baselineFullCorpus: full(150_000),
				candidateFullCorpus: cached,
			}),
		).toThrow("freshly embed");
	});

	it("rejects malformed resource and timing evidence", () => {
		const pairs = warmPairs();
		pairAt(pairs, 0).baseline.peakRssBytes = 0;
		expect(() =>
			analyzeThroughputAb({
				warmPairs: pairs,
				baselineFullCorpus: full(150_000),
				candidateFullCorpus: full(90_000),
			}),
		).toThrow("peak RSS");
	});
});
