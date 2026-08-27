import { describe, expect, it } from "vitest";
import type { OfflineEmbeddingPolicyReceipt } from "../../memory/embeddings.js";
import {
	fullCorpusEmbeddingExecutionPolicy,
	parseOfflineBatchInferenceMode,
} from "./native-full-corpus-policy.js";

const modelPolicy: OfflineEmbeddingPolicyReceipt = {
	model: "Xenova/multilingual-e5-large",
	revision: "revision",
	dtype: "q8",
	dimensions: 1024,
	queryPrefix: "query: ",
	passagePrefix: "passage: ",
	pooling: "mean",
	normalize: true,
	tokenizerMaxLength: 512,
	truncation: true,
	titleConcatenation: "provider-receives-precomposed-text",
};

describe("full-corpus embedding execution policy", () => {
	it("defaults strictly to the legacy per-item mode", () => {
		expect(parseOfflineBatchInferenceMode(undefined)).toBe("per-item-v1");
		expect(parseOfflineBatchInferenceMode("per-item-v1")).toBe("per-item-v1");
		expect(() => parseOfflineBatchInferenceMode("batch")).toThrow();
	});

	it("isolates true-batch policy and checkpoints from the legacy baseline", () => {
		const baseline = fullCorpusEmbeddingExecutionPolicy(
			modelPolicy,
			"title + text",
			"per-item-v1",
		);
		const candidate = fullCorpusEmbeddingExecutionPolicy(
			modelPolicy,
			"title + text",
			"padded-array-batch-v1",
		);
		expect(baseline.checkpointLeaf).toBe("vectors");
		expect(candidate.checkpointLeaf).toBe("vectors-padded-array-batch-v1");
		expect(candidate.embeddingPolicySha256).not.toBe(
			baseline.embeddingPolicySha256,
		);
	});
});
