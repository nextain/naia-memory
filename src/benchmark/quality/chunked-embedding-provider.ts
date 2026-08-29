import type { EmbeddingProvider } from "../../memory/embeddings.js";

export class ChunkedEmbeddingProvider implements EmbeddingProvider {
	readonly name: string;
	readonly dims: number;
	readonly embeddingSpaceId?: string;

	constructor(
		private readonly delegate: EmbeddingProvider,
		readonly batchSize: number,
	) {
		if (!Number.isInteger(batchSize) || batchSize < 1)
			throw new Error("batchSize must be a positive integer");
		this.name = delegate.name;
		this.dims = delegate.dims;
		this.embeddingSpaceId = delegate.embeddingSpaceId;
	}

	embed(text: string): Promise<number[]> {
		return this.delegate.embed(text);
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		const vectors: number[][] = [];
		for (let offset = 0; offset < texts.length; offset += this.batchSize)
			vectors.push(
				...(await this.delegate.embedBatch(
					texts.slice(offset, offset + this.batchSize),
				)),
			);
		return vectors;
	}
}
