import type { EmbeddingProvider } from "../embeddings.js";

/** Constructor configuration for the JSON-backed local memory adapter. */
export interface LocalAdapterOptions {
	storePath?: string;
	/** Optional vector provider; absent falls back to keyword retrieval. */
	embeddingProvider?: EmbeddingProvider;
	/** Maximum semantic candidates admitted by vector similarity alone (default 50). */
	vectorCandidateLimit?: number;
	/** Filters low-similarity vector matches; default 0.7. */
	similarityThreshold?: number;
	/** Legacy option, validated for compatibility; unused by default deletion. */
	deleteSimilarityThreshold?: number;
	/** Legacy option, validated for compatibility; unused by default deletion. */
	deleteOverlapThreshold?: number;
	/** Skip lookup-side knowledge-graph spreading for A/B measurement. */
	disableKGSpreading?: boolean;
	/** Optional caller-injected multilingual cross-encoder reranker. */
	reranker?: import("../reranker.js").RerankerProvider;
	/** Observes background persistence failures that cannot be returned to a caller. */
	onPersistenceError?: (error: unknown) => void;
	/**
	 * Rebuild persisted vectors when their embedding identity differs.
	 * Default true: first `whenReady()` / recall / save rebuilds the index.
	 * Pass false to keep fail-closed until an explicit `reindexEmbeddings()`.
	 */
	reindexEmbeddingsOnMismatch?: boolean;
}
