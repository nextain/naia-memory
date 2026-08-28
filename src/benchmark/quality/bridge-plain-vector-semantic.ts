import type { EmbeddingProvider } from "../../memory/embeddings.js";
import type {
	SemanticEngineBridge,
	SemanticIngestReceipt,
	SemanticNativeMemory,
} from "./memory-semantic-runner.js";

type StoredTurn = SemanticNativeMemory & { embedding: number[] };

function cosineSimilarity(left: number[], right: number[]): number {
	if (left.length === 0 || left.length !== right.length)
		throw new Error("plain-vector embedding dimensions are inconsistent");
	let leftScale = 0;
	let rightScale = 0;
	for (let index = 0; index < left.length; index += 1) {
		const leftValue = left[index];
		const rightValue = right[index];
		if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue))
			throw new Error("plain-vector embedding contains a non-finite value");
		leftScale = Math.max(leftScale, Math.abs(leftValue));
		rightScale = Math.max(rightScale, Math.abs(rightValue));
	}
	if (leftScale === 0 || rightScale === 0)
		throw new Error("plain-vector embedding must have a non-zero norm");
	let dot = 0;
	let leftNorm = 0;
	let rightNorm = 0;
	for (let index = 0; index < left.length; index += 1) {
		const leftValue = left[index] / leftScale;
		const rightValue = right[index] / rightScale;
		dot += leftValue * rightValue;
		leftNorm += leftValue * leftValue;
		rightNorm += rightValue * rightValue;
	}
	const score = dot / Math.sqrt(leftNorm * rightNorm);
	if (!Number.isFinite(score))
		throw new Error("plain-vector cosine score is non-finite");
	return score;
}

function validateEmbedding(
	embedding: number[] | undefined,
	expectedDimensions: number,
	kind: "passage" | "query",
): asserts embedding is number[] {
	if (!embedding || embedding.length !== expectedDimensions)
		throw new Error(`plain-vector ${kind} embedding has invalid dimensions`);
	if (embedding.some((value) => !Number.isFinite(value)))
		throw new Error(
			`plain-vector ${kind} embedding contains a non-finite value`,
		);
	if (embedding.every((value) => value === 0))
		throw new Error(`plain-vector ${kind} embedding must have a non-zero norm`);
}

/**
 * Immutable turn-level vector retrieval control. It deliberately performs no
 * extraction, consolidation, replacement, deletion, or LLM inference.
 */
export class PlainVectorSemanticBridge implements SemanticEngineBridge {
	readonly isolationPolicy = "fresh-case-state-v1" as const;
	readonly identityPolicy = "engine-native-memory-v1" as const;
	readonly ingestionPolicy = "sequential-turn-commit-v1" as const;
	readonly temporalInputPolicy = "engine-default-ingest-time-v1" as const;
	readonly retrievalSurface =
		"baseline-immutable-turn-vector-search-v1" as const;
	private readonly turns: StoredTurn[] = [];

	constructor(private readonly embeddingProvider: EmbeddingProvider) {}

	async ingestTurn(turn: { content: string }): Promise<SemanticIngestReceipt> {
		const embeddings = await this.embeddingProvider.embedBatch([turn.content]);
		if (embeddings.length !== 1)
			throw new Error(
				"plain-vector passage embedding response must contain one vector",
			);
		const embedding = embeddings[0];
		validateEmbedding(embedding, this.embeddingProvider.dims, "passage");
		this.turns.push({
			nativeId: `turn-${String(this.turns.length + 1).padStart(6, "0")}`,
			content: turn.content,
			embedding: [...embedding],
		});
		return { outcome: "native-operations", nativeOperationCount: 1 };
	}

	async search(query: string, topK: number): Promise<SemanticNativeMemory[]> {
		const queryEmbedding = await this.embeddingProvider.embed(query);
		validateEmbedding(queryEmbedding, this.embeddingProvider.dims, "query");
		return this.turns
			.map((turn) => ({
				turn,
				score: cosineSimilarity(queryEmbedding, turn.embedding),
			}))
			.sort(
				(left, right) =>
					right.score - left.score ||
					(left.turn.nativeId < right.turn.nativeId
						? -1
						: left.turn.nativeId > right.turn.nativeId
							? 1
							: 0),
			)
			.slice(0, topK)
			.map(({ turn }) => ({ nativeId: turn.nativeId, content: turn.content }));
	}

	async getNativeState(): Promise<SemanticNativeMemory[]> {
		return this.turns.map(({ nativeId, content }) => ({ nativeId, content }));
	}

	async close(): Promise<void> {
		this.turns.length = 0;
	}
}
