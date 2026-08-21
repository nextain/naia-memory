import type { EmbeddingProvider } from "../../memory/embeddings.js";

/**
 * DeterministicEmbeddingProvider — a fast, dependency-free embedder for the
 * *retrieval latency / scale* benchmark axis.
 *
 * WHY this exists (methodology):
 * sqlite-vec (vec0) performs a brute-force linear scan: it computes the
 * distance for **every** row regardless of the vector's values. Therefore the
 * recall latency at a given (dims, corpus-size) is identical whether the
 * vectors come from a real transformer or from this hash-seeded generator.
 * Using this embedder isolates the SqliteAdapter + FTS5 + sqlite-vec +
 * worker-IPC cost from the ~54 CPU-min that real transformer inference spends
 * embedding 100k texts on CPU — turning a 3-minute injection into seconds and
 * making a tight measure→improve loop possible.
 *
 * It is NOT a semantic embedder. It is a *bag-of-tokens* embedder: each token
 * maps to a stable pseudo-random unit vector and a text's embedding is the
 * L2-normalized sum of its token vectors. Consequence: texts that share tokens
 * (e.g. two facts both mentioning "topic-500") have high cosine similarity,
 * which yields a *valid relative* precision@k signal on synthetic corpora
 * where ground-truth relevance is defined by shared tokens. For real semantic
 * quality, use OfflineEmbeddingProvider on a labeled corpus (accuracy axis).
 */
export class DeterministicEmbeddingProvider implements EmbeddingProvider {
	readonly name = "deterministic-bag-of-tokens";
	readonly dims: number;
	readonly embeddingSpaceId: string;

	constructor(dims = 384) {
		this.dims = dims;
		// This benchmark provider is persisted by SqliteAdapter, so it needs the
		// same immutable vector-space identity required from production providers.
		// Bump the algorithm version if tokenization, hashing, PRNG, pooling, or
		// normalization changes; dimensions alone do not identify those semantics.
		this.embeddingSpaceId = `benchmark:deterministic-bag-of-tokens@1:dims=${dims}:fnv1a-mulberry32:l2`;
	}

	/** FNV-1a 32-bit hash of a string → stable seed. */
	private hash(s: string): number {
		let h = 0x811c9dc5;
		for (let i = 0; i < s.length; i++) {
			h ^= s.charCodeAt(i);
			h = Math.imul(h, 0x01000193);
		}
		return h >>> 0;
	}

	/** mulberry32 PRNG — fast, deterministic, seedable. */
	private tokenVector(token: string): Float64Array {
		let a = this.hash(token);
		const v = new Float64Array(this.dims);
		for (let i = 0; i < this.dims; i++) {
			a |= 0;
			a = (a + 0x6d2b79f5) | 0;
			let t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			// map to [-1, 1]
			v[i] = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
		}
		return v;
	}

	private tokenize(text: string): string[] {
		return text
			.toLowerCase()
			.replace(/[^\w\s-]/g, " ")
			.split(/\s+/)
			.filter((t) => t.length > 0);
	}

	async embed(text: string): Promise<number[]> {
		const tokens = this.tokenize(text);
		const acc = new Float64Array(this.dims);
		if (tokens.length === 0) {
			// stable non-zero vector for empty text
			acc[0] = 1;
		} else {
			for (const tok of tokens) {
				const tv = this.tokenVector(tok);
				for (let i = 0; i < this.dims; i++) acc[i] += tv[i];
			}
		}
		// L2 normalize
		let norm = 0;
		for (let i = 0; i < this.dims; i++) norm += acc[i] * acc[i];
		norm = Math.sqrt(norm) || 1;
		const out = new Array<number>(this.dims);
		for (let i = 0; i < this.dims; i++) out[i] = acc[i] / norm;
		return out;
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		return Promise.all(texts.map((t) => this.embed(t)));
	}
}
