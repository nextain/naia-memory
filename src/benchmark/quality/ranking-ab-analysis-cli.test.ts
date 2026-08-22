import { describe, expect, it } from "vitest";
import {
	validateBoundRankingResult,
	validateReportedRankingMetrics,
	validateSharedRankingProtocol,
} from "./ranking-ab-analysis.js";

describe("ranking A/B result binding", () => {
	const valid = JSON.stringify({
		benchmark: "miracl-ko-full-corpus-naia-vector-exact-v1",
		inputs: {
			sourceLockSha256: "source",
			topicsSha256: "topics",
			qrelsSha256: "qrels",
			corpusDocidsSha256: "docids",
			documentCount: 1_486_752,
			queryCount: 213,
		},
		configuration: {
			passageComposition: "title + text",
			embedding: { model: "locked-model", normalize: true },
			vectorStore: "Qdrant",
			distance: "Cosine",
			exactSearch: true,
			topK: 100,
			cpuOnly: true,
			collectionName: "baseline-only",
		},
		metrics: { ndcgAt10: 0.5, recallAt100: 0.75 },
		trecSha256: "trec",
	});

	it("requires reported metrics to reproduce from the bound TREC run", () => {
		expect(() =>
			validateReportedRankingMetrics(valid, {
				ndcgAt10: 0.5,
				recallAt100: 0.75,
			}),
		).not.toThrow();
		expect(() =>
			validateReportedRankingMetrics(valid, {
				ndcgAt10: 0.49,
				recallAt100: 0.75,
			}),
		).toThrow("do not match");
	});

	it("accepts the exact bound protocol", () => {
		expect(() =>
			validateBoundRankingResult(valid, "trec", "qrels", 213),
		).not.toThrow();
	});

	it.each([
		["TREC", "other", "qrels"],
		["qrels", "trec", "other"],
	])("rejects a mismatched %s binding", (_label, trec, qrels) => {
		expect(() => validateBoundRankingResult(valid, trec, qrels, 213)).toThrow(
			"does not bind",
		);
	});

	it("rejects a weakened retrieval protocol", () => {
		const approximate = valid.replace(
			'"exactSearch":true',
			'"exactSearch":false',
		);
		expect(() =>
			validateBoundRankingResult(approximate, "trec", "qrels", 213),
		).toThrow("does not bind");
	});

	it("accepts collection isolation but rejects a changed model policy", () => {
		const isolatedCandidate = valid.replace("baseline-only", "candidate-only");
		expect(() =>
			validateSharedRankingProtocol(valid, isolatedCandidate),
		).not.toThrow();
		const changedModel = valid.replace("locked-model", "different-model");
		expect(() => validateSharedRankingProtocol(valid, changedModel)).toThrow(
			"same ranking protocol",
		);
	});
});
