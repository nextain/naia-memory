/**
 * MemorySystem — Orchestrator for Naia Memory architecture.
 *
 * Coordinates the 4-store memory system:
 * - Working Memory: managed by ContextManager (#65)
 * - Episodic Memory: timestamped events via MemoryAdapter
 * - Semantic Memory: facts/knowledge via MemoryAdapter
 * - Procedural Memory: skills/reflections via MemoryAdapter
 *
 * This class handles:
 * - Memory encoding (with importance gating)
 * - Memory retrieval (with context-dependent recall)
 * - Consolidation scheduling (sleep cycle analog)
 */

import crypto, { randomUUID } from "node:crypto";
import { LocalAdapter } from "./adapters/local.js";
import { QdrantAdapter } from "./adapters/qdrant.js";
import { SqliteAdapter } from "./adapters/sqlite.js";
import type { EmbeddingProvider } from "./embeddings.js";
import { scoreImportance } from "./importance.js";
import { allocateBudget } from "./context-budget.js";
import {
	type ContradictionFilterProvider,
	HeuristicContradictionFilter,
	selectFilter,
} from "./contradiction-filter.js";

// Re-export contradiction filter surface so consumers (naia-agent / tests) can
// import HeuristicContradictionFilter from the package main entry without
// resorting to deep paths (naia-os#272 reconcile — was hardcoded to absolute
// Windows path).
export {
	HeuristicContradictionFilter,
	selectFilter,
	type ContradictionFilterProvider,
} from "./contradiction-filter.js";
import { findContradictions, findContradictionsWith } from "./reconsolidation.js";
import { filterNegativeCapture } from "./negative-capture.js";
import { findStructuredSupersessions, sameStructuredFact } from "./structured-facts.js";
import type {
	BackupCapable,
	ConsolidationResult,
	EncodingContext,
	Episode,
	Fact,
	MemoryAdapter,
	MemoryInput,
	RecallContext,
	Reflection,
	StructuredFact,
} from "./types.js";

export function deterministicEpisodeId(
	key: string,
	role: string,
	context: EncodingContext,
): string {
	const hex = crypto
		.createHash("sha256")
		.update(JSON.stringify([context.project ?? "", context.sessionId ?? "", role, key]))
		.digest("hex")
		.slice(0, 32);
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Re-exports for package consumers
export type { EmbeddingProvider };
export {
	OfflineEmbeddingProvider,
	OpenAICompatEmbeddingProvider,
	HuggingFaceEmbeddingProvider,
	NaiaGatewayEmbeddingProvider,
} from "./embeddings.js";
export { buildLLMFactExtractor } from "./llm-fact-extractor.js";
export type { LLMFactExtractorOptions } from "./llm-fact-extractor.js";
export { buildLLMQueryStructurer } from "./llm-query-structurer.js";
export type { LLMQueryStructurerOptions, StructuredQuery } from "./llm-query-structurer.js";
export { buildLLMSummarizer } from "./llm-summarizer.js";
export type { LLMSummarizerOptions } from "./llm-summarizer.js";
export {
	IdentityReranker,
	OfflineRerankerProvider,
	type RerankerProvider,
} from "./reranker.js";
export type {
	SpikeEvent,
	SpikeAction,
	SpikeHandler,
	ActiveContext,
	SubscribableMemory,
} from "./spike.js";
// MemoryProvider contract + runtime capability detection.
// `isCapable(provider, capName)` lets a host (naia-agent) feature-detect
// optional capabilities (Backup / ImportanceScoring / Reconsolidation /
// Temporal / Compactable) without a hard dependency on a separate types
// package. Re-exported here so consumers import from "@nextain/naia-memory"
// (the published package entry) — these interfaces live in provider-types.ts
// until/if a standalone @nextain/agent-types package ships.
export { isCapable } from "./provider-types.js";
export type {
	MemoryProvider,
	MemoryProviderInput,
	MemoryHit,
	RecallOptions,
	ConsolidationSummary,
	AnyCapability,
	BackupCapableProvider,
	ImportanceScoringCapable,
	ReconsolidationCapableProvider,
	TemporalCapableProvider,
	CompactableCapableProvider,
} from "./provider-types.js";
export { LocalAdapter } from "./adapters/local.js";
export { QdrantAdapter } from "./adapters/qdrant.js";
export { SqliteAdapter } from "./adapters/sqlite.js";
export type {
	BackupCapable,
	MemoryAdapter,
	Episode,
	Fact,
	Reflection,
	Skill,
	MemoryInput,
	RecallContext,
	EncodingContext,
	ImportanceScore,
	ConsolidationResult,
	StructuredFact,
} from "./types.js";

// Import A/B test algorithm interfaces and implementations
import type { MemoryAlgorithm } from "./algorithms/base.js";
import { AlgorithmVariantA } from "./algorithms/variantA.js";
import { AlgorithmVariantB } from "./algorithms/variantB.js";
import type { CompactionSummarizer } from "./compaction-helpers.js";


/**
 * Callback for extracting facts from episodes.
 * In production, this would call an LLM. For testing, a simple heuristic.
 */
export type FactExtractor = (episodes: Episode[]) => Promise<ExtractedFact[]>;

/** A fact extracted from episodes (before insertion) */
export interface ExtractedFact {
        content: string;
        entities: string[];
        topics: string[];
        importance: number;
        /** Highest emotional valence among source episodes (0.0–1.0).
         *  Optional — defaults to 0 when absent (matches stored `Fact.maxEmotion`). */
        maxEmotion?: number;
        sourceEpisodeIds: string[];
	/** Optional explicit structure for conservative write-time supersession. */
	structured?: StructuredFact;
}
export interface MemorySystemOptions {
	/** Pre-built adapter. If omitted and qdrantOptions is not set, defaults to LocalAdapter. */
	adapter?: MemoryAdapter;
	/**
	 * Embedding provider for vector search.
	 * - Required when adapter = 'qdrant'
	 * - Used by LocalAdapter for vector similarity search when provided.
	 *   Falls back to keyword-only search when omitted.
	 */
	embeddingProvider?: EmbeddingProvider;
	/** Consolidation interval in ms (default: 30 minutes) */
	consolidationIntervalMs?: number;
	/** Custom fact extractor (default: heuristic). Inject LLM-based extractor in production. */
	factExtractor?: FactExtractor;
	/** Optional LLM summarizer for `compact()`. When omitted, compact()
	 *  uses a deterministic recap. When provided, the summarizer polishes
	 *  the recap (fallback to deterministic on failure). */
	summarizer?: CompactionSummarizer;
	/** Rolling-summary tuning. All optional, sensible defaults. */
	rollingSummaryOptions?: {
		/** Max recent messages kept per session (default 24). */
		headroom?: number;
		/** Max chars allowed in the compressed stem (default 4000). */
		compressedMax?: number;
		/** Max topics tracked per session with LRU eviction (default 24). */
		topicCap?: number;
	};
	/** Qdrant-specific options. When set, QdrantAdapter is used; embeddingProvider is required. */
	qdrantOptions?: {
		url: string;
		/** Qdrant cloud API key (optional for local Qdrant) */
		apiKey?: string;
		collectionPrefix?: string;
	};
	/** Pluggable contradiction filter (R2.5 — dual-process retrieval-rerank).
	 *  When omitted, defaults to `selectFilter(process.env)` which picks
	 *  Vllm > Gemini > Heuristic based on env. Pass an explicit provider
	 *  (e.g. `new HeuristicContradictionFilter()`) for deterministic tests. */
	contradictionFilter?: ContradictionFilterProvider;
	/** Phase B-γ A/B measurement toggle — when true, the 3-axis importance
	 *  score (importance × surprise × emotion) is **neutralized** (utility
	 *  forced to 1.0) so every encoded episode reaches semantic store with
	 *  equal weight, and ranking/decay no longer differentiate by score.
	 *  Default false (current production behaviour).
	 *
	 *  This option does NOT remove or rewrite the importance code path —
	 *  it only bypasses scoring for measurement. Used to compare
	 *  importance-gating ON vs OFF on AI Hub 141.  */
	disableImportanceGating?: boolean;
	/** Phase B-γ A/B measurement toggle — when true, the knowledge-graph
	 *  spreading-activation step is skipped during semantic recall so
	 *  ranking falls back to vector cosine + BM25 only. Default false
	 *  (current production behaviour).
	 *
	 *  Preservation-first: KG entities and associations are NOT deleted.
	 *  `semantic.upsert()` still calls `kg.touchNode()` /
	 *  `kg.strengthen()` so the graph keeps building during a no-KG run.
	 *  Only the lookup-side propagation is bypassed, allowing a clean
	 *  spreading ON vs OFF measurement on AI Hub 141.
	 *
	 *  When `adapter` is supplied by the caller, this flag is forwarded
	 *  only to the auto-built `LocalAdapter`. Pre-built adapters must be
	 *  configured with their own `disableKGSpreading` option directly
	 *  (same model as `embeddingProvider`). */
	disableKGSpreading?: boolean;
	/** #27 Step 3 — Cross-encoder reranker (caller-injected).
	 *  Forwarded to auto-built LocalAdapter. Pre-built adapter 의 reranker
	 *  는 caller 가 직접 설정. */
	reranker?: import("./reranker.js").RerankerProvider;
}

// Placeholder for heuristicFactExtractor and related functions
// In a real scenario, these would be properly implemented or replaced by LLM calls.
let _heuristicWarnOnce = false;
export async function heuristicFactExtractor(
	episodes: Episode[],
): Promise<ExtractedFact[]> {
	if (!_heuristicWarnOnce) {
		console.warn(
			"[MemorySystem] Using heuristic fact extractor (no LLM). Inject factExtractor option for production.",
		);
		_heuristicWarnOnce = true;
	}
	return episodes.map((ep) => ({
	        content: ep.content,
	        entities: [],
	        topics: ep.encodingContext.project ? [ep.encodingContext.project] : [],
	        importance: ep.importance.utility,
	        maxEmotion: ep.importance.emotion,
	        sourceEpisodeIds: [ep.id],
	}));}
