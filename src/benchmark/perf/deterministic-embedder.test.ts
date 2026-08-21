import { describe, expect, it } from "vitest";
import { DeterministicEmbeddingProvider } from "./deterministic-embedder.js";

describe("DeterministicEmbeddingProvider", () => {
	it("declares a stable identity that distinguishes vector dimensions", () => {
		const first = new DeterministicEmbeddingProvider(384);
		const same = new DeterministicEmbeddingProvider(384);
		const differentDimensions = new DeterministicEmbeddingProvider(768);

		expect(first.embeddingSpaceId).toBe(same.embeddingSpaceId);
		expect(first.embeddingSpaceId).not.toBe(differentDimensions.embeddingSpaceId);
		expect(first.embeddingSpaceId).toContain("@1");
	});
});
