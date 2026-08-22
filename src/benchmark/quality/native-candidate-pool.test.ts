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
			hardNegativeRuns: {
				lexical: {
					source: "bm25-full-corpus:test-revision",
					byQuery: new Map([
						["q1", ["p1", "h1"]],
						["q2", ["h2"]],
					]),
				},
				dense: {
					source: "mcontriever-full-corpus:test-revision",
					byQuery: new Map([
						["q1", ["h2"]],
						["q2", ["h1"]],
					]),
				},
			},
			targetSize: 5,
			minimumHardNegativesPerQuery: 1,
			minimumUniqueHardNegativeRatio: 0.5,
			maximumRandomFillerFraction: 0.5,
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
				hardNegativeRuns: runs(new Map([["q1", []]])),
				targetSize: 2,
				minimumHardNegativesPerQuery: 1,
				minimumUniqueHardNegativeRatio: 1,
				maximumRandomFillerFraction: 0.5,
				seed: "contract-v1",
			}),
		).toThrow(/hard-negative coverage failed/);
	});

	it("fails when per-query coverage collapses onto a shared hub", () => {
		expect(() =>
			buildNativeCandidatePool({
				corpusDocumentIds: ["p1", "p2", "hub1", "hub2"],
				relevantByQuery: new Map([
					["q1", ["p1"]],
					["q2", ["p2"]],
				]),
				hardNegativeRuns: {
					lexical: {
						source: "bm25-full-corpus:test-revision",
						byQuery: new Map([
							["q1", ["hub1"]],
							["q2", ["hub1"]],
						]),
					},
					dense: {
						source: "mcontriever-full-corpus:test-revision",
						byQuery: new Map([
							["q1", ["hub2"]],
							["q2", ["hub2"]],
						]),
					},
				},
				targetSize: 4,
				minimumHardNegativesPerQuery: 1,
				minimumUniqueHardNegativeRatio: 0.75,
				maximumRandomFillerFraction: 0.5,
				seed: "contract-v1",
			}),
		).toThrow(/unique hard-negative ratio/);
	});

	it("fails when a judged query has no positive in the source corpus", () => {
		expect(() =>
			buildNativeCandidatePool({
				corpusDocumentIds: ["h1", "r1"],
				relevantByQuery: new Map([["q1", ["missing"]]]),
				hardNegativeRuns: runs(new Map([["q1", ["h1"]]])),
				targetSize: 2,
				minimumHardNegativesPerQuery: 1,
				minimumUniqueHardNegativeRatio: 1,
				maximumRandomFillerFraction: 0.5,
				seed: "contract-v1",
			}),
		).toThrow(/positive coverage failed/);
	});

	it("rejects a diagnostic dominated by random filler", () => {
		expect(() =>
			buildNativeCandidatePool({
				corpusDocumentIds: ["p", "h1", "h2", "r1", "r2", "r3", "r4"],
				relevantByQuery: new Map([["q", ["p"]]]),
				hardNegativeRuns: {
					lexical: {
						source: "bm25-full-corpus:test-revision",
						byQuery: new Map([["q", ["h1"]]]),
					},
					dense: {
						source: "mcontriever-full-corpus:test-revision",
						byQuery: new Map([["q", ["h2"]]]),
					},
				},
				targetSize: 7,
				minimumHardNegativesPerQuery: 1,
				minimumUniqueHardNegativeRatio: 1,
				maximumRandomFillerFraction: 0.5,
				seed: "contract-v1",
			}),
		).toThrow(/random filler fraction/);
	});

	it("builds a required-only pool without random filler", () => {
		const pool = buildNativeCandidatePool({
			corpusDocumentIds: ["p", "h1", "h2", "unused"],
			relevantByQuery: new Map([["q", ["p"]]]),
			hardNegativeRuns: {
				lexical: {
					source: "bm25-full-corpus:test-revision",
					byQuery: new Map([["q", ["h1"]]]),
				},
				dense: {
					source: "mcontriever-full-corpus:test-revision",
					byQuery: new Map([["q", ["h2"]]]),
				},
			},
			targetSize: "required-only",
			minimumHardNegativesPerQuery: 1,
			minimumUniqueHardNegativeRatio: 1,
			maximumRandomFillerFraction: 0,
			seed: "contract-v1",
		});
		expect(pool.documentIds).toEqual(["h1", "h2", "p"]);
		expect(pool.receipt.targetSizeMode).toBe("required-only");
		expect(pool.receipt.randomFillerCount).toBe(0);
	});
});

function runs(byQuery: ReadonlyMap<string, readonly string[]>) {
	return {
		lexical: { source: "bm25-full-corpus:test-revision", byQuery },
		dense: { source: "mcontriever-full-corpus:test-revision", byQuery },
	};
}
