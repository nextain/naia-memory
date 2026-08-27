import { describe, expect, it } from "vitest";
import { fullCorpusEmbeddingExecutionPolicy } from "./native-full-corpus-policy.js";
import {
	validateBoundRankingResult,
	validateRankingAbExecutionTreatment,
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
			embedding: {
				model: "locked-model",
				revision: "locked-revision",
				dtype: "q8",
				dimensions: 1024,
				queryPrefix: "query: ",
				passagePrefix: "passage: ",
				pooling: "mean",
				normalize: true,
				tokenizerMaxLength: 512,
				truncation: true,
				titleConcatenation: "provider-receives-precomposed-text",
			},
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

	it("binds a legacy per-item baseline to an isolated true-batch candidate", () => {
		const candidate = JSON.parse(valid);
		candidate.configuration.embeddingInferenceMode = "padded-array-batch-v1";
		candidate.configuration.embeddingExecutionPolicySha256 =
			fullCorpusEmbeddingExecutionPolicy(
				candidate.configuration.embedding,
				candidate.configuration.passageComposition,
				"padded-array-batch-v1",
			).embeddingPolicySha256;
		candidate.configuration.collectionName = `naia_miracl_ko_source_${candidate.configuration.embeddingExecutionPolicySha256.slice(0, 8)}`;
		expect(() =>
			validateRankingAbExecutionTreatment(valid, JSON.stringify(candidate)),
		).not.toThrow();
		candidate.configuration.embeddingExecutionPolicySha256 = "tampered";
		expect(() =>
			validateRankingAbExecutionTreatment(valid, JSON.stringify(candidate)),
		).toThrow("policy hash mismatch");
	});

	it("rejects a true-batch receipt that reuses an unrelated collection", () => {
		const candidate = JSON.parse(valid);
		candidate.configuration.embeddingInferenceMode = "padded-array-batch-v1";
		candidate.configuration.embeddingExecutionPolicySha256 =
			fullCorpusEmbeddingExecutionPolicy(
				candidate.configuration.embedding,
				candidate.configuration.passageComposition,
				"padded-array-batch-v1",
			).embeddingPolicySha256;
		candidate.configuration.collectionName = "baseline-only";
		expect(() =>
			validateRankingAbExecutionTreatment(valid, JSON.stringify(candidate)),
		).toThrow("collection is not isolated");
	});

	it("rejects candidates that do not declare the exact treatment", () => {
		const candidate = JSON.parse(valid);
		candidate.configuration.embeddingInferenceMode = "per-item-v1";
		expect(() =>
			validateRankingAbExecutionTreatment(valid, JSON.stringify(candidate)),
		).toThrow("expected inference modes");
	});
});
