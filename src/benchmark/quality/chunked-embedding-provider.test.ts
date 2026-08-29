import { describe, expect, it } from "vitest";
import type { EmbeddingProvider } from "../../memory/embeddings.js";
import { ChunkedEmbeddingProvider } from "./chunked-embedding-provider.js";

class RecordingProvider implements EmbeddingProvider {
	readonly name = "recording";
	readonly dims = 1;
	readonly embeddingSpaceId = "recording:1";
	readonly batches: string[][] = [];

	async embed(text: string): Promise<number[]> {
		return [text.length];
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		this.batches.push([...texts]);
		return texts.map((text) => [text.length]);
	}
}

describe("ChunkedEmbeddingProvider", () => {
	it("preserves order while bounding delegated batches", async () => {
		const delegate = new RecordingProvider();
		const provider = new ChunkedEmbeddingProvider(delegate, 2);

		await expect(
			provider.embedBatch(["a", "bb", "ccc", "dddd", "eeeee"]),
		).resolves.toEqual([[1], [2], [3], [4], [5]]);
		expect(delegate.batches).toEqual([["a", "bb"], ["ccc", "dddd"], ["eeeee"]]);
	});

	it.each([0, -1, 1.5])("rejects invalid batch size %s", (batchSize) => {
		expect(
			() => new ChunkedEmbeddingProvider(new RecordingProvider(), batchSize),
		).toThrow("batchSize must be a positive integer");
	});
});
