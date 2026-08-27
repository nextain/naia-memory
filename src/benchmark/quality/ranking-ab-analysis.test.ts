import { describe, expect, it } from "vitest";
import { type RankedQuery, analyzeRankingAb } from "./ranking-ab-analysis.js";

function ranking(queryId: string, prefix = "d"): RankedQuery {
	return {
		queryId,
		ranking: Array.from({ length: 100 }, (_, index) => `${prefix}${index}`),
	};
}

describe("ranking A/B analysis", () => {
	it("reports exact identity for unchanged rankings", () => {
		const rows = [ranking("q1"), ranking("q2")];
		const result = analyzeRankingAb({
			baseline: rows,
			candidate: rows,
			relevantByQuery: new Map([
				["q1", new Set(["d0", "d50"])],
				["q2", new Set(["d1", "d99"])],
			]),
			bootstrapRepetitions: 1_000,
			bootstrapSeed: 7,
		});
		expect(result.metrics.ndcgAt10.delta).toBe(0);
		expect(result.metrics.recallAt100.delta).toBe(0);
		expect(result.metrics.ndcgAt10.delta95PercentileInterval).toEqual({
			lower: 0,
			upper: 0,
		});
		expect(result.rankingStability).toEqual({
			meanTop10Jaccard: 1,
			meanTop100Jaccard: 1,
		});
	});

	it("detects a candidate that loses relevant documents", () => {
		const baseline = [ranking("q1")];
		const candidate = [ranking("q1", "x")];
		const result = analyzeRankingAb({
			baseline,
			candidate,
			relevantByQuery: new Map([["q1", new Set(["d0", "d50"])]]),
			bootstrapRepetitions: 1_000,
			bootstrapSeed: 7,
		});
		expect(result.metrics.ndcgAt10.delta).toBeCloseTo(-0.6131471927654584);
		expect(result.metrics.recallAt100.delta).toBe(-1);
		expect(result.metrics.ndcgAt10.delta95PercentileInterval.upper).toBeCloseTo(
			-0.6131471927654584,
		);
		expect(result.rankingStability.meanTop10Jaccard).toBe(0);
	});

	it("fails closed on coverage and ranking integrity errors", () => {
		expect(() =>
			analyzeRankingAb({
				baseline: [ranking("q1")],
				candidate: [ranking("q2")],
				relevantByQuery: new Map([["q1", new Set(["d0"])]]),
				bootstrapRepetitions: 1_000,
			}),
		).toThrow("candidate missing query q1");
		const duplicate = ranking("q1");
		duplicate.ranking[99] = "d0";
		expect(() =>
			analyzeRankingAb({
				baseline: [duplicate],
				candidate: [ranking("q1")],
				relevantByQuery: new Map([["q1", new Set(["d0"])]]),
				bootstrapRepetitions: 1_000,
			}),
		).toThrow("duplicate document ID");
		const tooLong = ranking("q1");
		tooLong.ranking.push("d100");
		expect(() =>
			analyzeRankingAb({
				baseline: [tooLong],
				candidate: [ranking("q1")],
				relevantByQuery: new Map([["q1", new Set(["d0"])]]),
				bootstrapRepetitions: 1_000,
			}),
		).toThrow("exactly 100");
	});
});
