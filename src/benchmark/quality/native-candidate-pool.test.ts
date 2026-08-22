import { describe, expect, it } from "vitest";
import { buildNativeCandidatePool } from "./native-candidate-pool.js";

describe("native candidate pool", () => {
	it("retains positives and per-query hard negatives before deterministic fillers", () => {
		const options = {
			corpusDocumentIds: ["p1", "p2", "h1", "h2", "r1", "r2"],
			relevantByQuery: new Map([
				["q1", ["p1"]],
				["q2", ["p2"]],
			]),
			hardNegativeRunByQuery: new Map([
				["q1", ["p1", "h1"]],
				["q2", ["h2"]],
			]),
			targetSize: 5,
			minimumHardNegativesPerQuery: 1,
			minimumUniqueHardNegativeRatio: 1,
			maximumRandomFillerFraction: 0.5,
			hardNegativeSource: "bm25-full-corpus:test-revision",
			seed: "contract-v1",
		};
		const first = buildNativeCandidatePool(options);
		const second = buildNativeCandidatePool(options);
		expect(first).toEqual(second);
		expect(first.documentIds).toEqual(
			expect.arrayContaining(["p1", "p2", "h1", "h2"]),
		);
		expect(first.receipt.hardNegativeCount).toBe(2);
	});

	it("fails closed instead of replacing missing hard negatives with noise", () => {
		expect(() =>
			buildNativeCandidatePool({
				corpusDocumentIds: ["p1", "r1"],
				relevantByQuery: new Map([["q1", ["p1"]]]),
				hardNegativeRunByQuery: new Map([["q1", []]]),
				targetSize: 2,
				minimumHardNegativesPerQuery: 1,
				minimumUniqueHardNegativeRatio: 1,
				maximumRandomFillerFraction: 0.5,
				hardNegativeSource: "bm25-full-corpus:test-revision",
				seed: "contract-v1",
			}),
		).toThrow(/hard-negative coverage failed/);
	});

	it("fails when per-query coverage collapses onto a shared hub", () => {
		expect(() =>
			buildNativeCandidatePool({
				corpusDocumentIds: ["p1", "p2", "hub", "r1"],
				relevantByQuery: new Map([
					["q1", ["p1"]],
					["q2", ["p2"]],
				]),
				hardNegativeRunByQuery: new Map([
					["q1", ["hub"]],
					["q2", ["hub"]],
				]),
				targetSize: 4,
				minimumHardNegativesPerQuery: 1,
				minimumUniqueHardNegativeRatio: 0.75,
				maximumRandomFillerFraction: 0.5,
				hardNegativeSource: "bm25-full-corpus:test-revision",
				seed: "contract-v1",
			}),
		).toThrow(/unique hard-negative ratio/);
	});

	it("fails when a judged query has no positive in the source corpus", () => {
		expect(() =>
			buildNativeCandidatePool({
				corpusDocumentIds: ["h1", "r1"],
				relevantByQuery: new Map([["q1", ["missing"]]]),
				hardNegativeRunByQuery: new Map([["q1", ["h1"]]]),
				targetSize: 2,
				minimumHardNegativesPerQuery: 1,
				minimumUniqueHardNegativeRatio: 1,
				maximumRandomFillerFraction: 0.5,
				hardNegativeSource: "bm25-full-corpus:test-revision",
				seed: "contract-v1",
			}),
		).toThrow(/positive coverage failed/);
	});

	it("rejects a diagnostic dominated by random filler", () => {
		expect(() =>
			buildNativeCandidatePool({
				corpusDocumentIds: ["p", "h", "r1", "r2", "r3", "r4"],
				relevantByQuery: new Map([["q", ["p"]]]),
				hardNegativeRunByQuery: new Map([["q", ["h"]]]),
				targetSize: 6,
				minimumHardNegativesPerQuery: 1,
				minimumUniqueHardNegativeRatio: 1,
				maximumRandomFillerFraction: 0.5,
				hardNegativeSource: "bm25-full-corpus:test-revision",
				seed: "contract-v1",
			}),
		).toThrow(/random filler fraction/);
	});
});
