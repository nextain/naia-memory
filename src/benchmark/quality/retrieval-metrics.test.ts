import { describe, expect, it } from "vitest";
import { summarizeRetrievalMetrics } from "./retrieval-metrics.js";

describe("retrieval metrics", () => {
	it("does not mislabel any-hit success as multi-gold recall", () => {
		const metrics = summarizeRetrievalMetrics([
			{ relevantIds: ["a", "b"], ranking: ["a", "x", "y"] },
		]);
		expect(metrics.successAt1).toBe(1);
		expect(metrics.recallAt10).toBe(0.5);
	});

	it("fails closed on duplicate ranking ids", () => {
		expect(() =>
			summarizeRetrievalMetrics([{ relevantIds: ["a"], ranking: ["a", "a"] }]),
		).toThrow(/duplicate document ids/);
	});

	it("includes relevant documents at ranks 5 and 10 but not rank 11", () => {
		const at5 = summarizeRetrievalMetrics([
			{ relevantIds: ["a"], ranking: ["1", "2", "3", "4", "a"] },
		]);
		const at10 = summarizeRetrievalMetrics([
			{
				relevantIds: ["a"],
				ranking: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "a"],
			},
		]);
		const at11 = summarizeRetrievalMetrics([
			{
				relevantIds: ["a"],
				ranking: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "a"],
			},
		]);
		expect(at5.successAt5).toBe(1);
		expect(at10.successAt10).toBe(1);
		expect(at11.successAt10).toBe(0);
	});

	it("returns zeroes for an empty judged set", () => {
		expect(summarizeRetrievalMetrics([])).toEqual({
			successAt1: 0,
			successAt5: 0,
			successAt10: 0,
			recallAt10: 0,
			ndcgAt10: 0,
			mrr: 0,
		});
	});
});
