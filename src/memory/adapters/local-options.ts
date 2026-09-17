import type { EmbeddingProvider } from "../embeddings.js";

/** Constructor configuration for the JSON-backed local memory adapter. */
export interface LocalAdapterOptions {
	storePath?: string;
	/** Optional vector provider; absent falls back to keyword retrieval. */
	embeddingProvider?: EmbeddingProvider;
	/** Filters low-similarity vector matches; default 0.7. */
	similarityThreshold?: number;
	/** Skip lookup-side knowledge-graph spreading for A/B measurement. */
	disableKGSpreading?: boolean;
	/** Optional caller-injected multilingual cross-encoder reranker. */
	reranker?: import("../reranker.js").RerankerProvider;
	/** Observes background persistence failures that cannot be returned to a caller. */
	onPersistenceError?: (error: unknown) => void;
	/**
	 * Rebuild persisted vectors when their embedding identity differs.
	 * Default false: recall/save stay fail-closed until `reindexEmbeddings()`.
	 * Product hosts that want open-time recovery pass true and await `whenReady()`.
	 */
	reindexEmbeddingsOnMismatch?: boolean;
}
