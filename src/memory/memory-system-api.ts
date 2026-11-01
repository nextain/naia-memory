import { deletionTarget } from "./delete-tombstone.js";
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
import { allocateBudget } from "./context-budget.js";
import {
	type ContradictionFilterProvider,
	HeuristicContradictionFilter,
	selectFilter,
} from "./contradiction-filter.js";
import type { EmbeddingProvider } from "./embeddings.js";
import { scoreImportance } from "./importance.js";

// Re-export contradiction filter surface so consumers (naia-agent / tests) can
// import HeuristicContradictionFilter from the package main entry without
// resorting to deep paths (naia-os#272 reconcile — was hardcoded to absolute
// Windows path).
export {
	HeuristicContradictionFilter,
	selectFilter,
	type ContradictionFilterProvider,
} from "./contradiction-filter.js";
import { filterNegativeCapture } from "./negative-capture.js";
import {
	findContradictions,
	findContradictionsWith,
} from "./reconsolidation.js";
import {
	findStructuredSupersessions,
	sameStructuredFact,
} from "./structured-facts.js";
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
		.update(
			JSON.stringify([
				context.project ?? "",
				context.sessionId ?? "",
				role,
				key,
			]),
		)
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
export type {
	LLMQueryStructurerOptions,
	StructuredQuery,
} from "./llm-query-structurer.js";
export { buildLLMSummarizer } from "./llm-summarizer.js";
export type { LLMSummarizerOptions } from "./llm-summarizer.js";
export {
	chatCompletionsUrl,
	isGpt5FamilyModel,
	temperatureField,
} from "./llm-request.js";
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
export {
	LocalAdapter,
	LocalStoreLoadError,
	EmbeddingSpaceMismatchError,
} from "./adapters/local.js";
export { QdrantAdapter } from "./adapters/qdrant.js";
export { SqliteAdapter } from "./adapters/sqlite.js";
export type {
	BackupCapable,
	MemoryAdapter,
	MemoryUse,
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

/** An eligible active candidate which the secondary verifier may select. */
export interface DeleteCandidate {
	id: string;
	/** Minimal bounded disclosure sent to the configured verifier endpoint. */
	structured: Pick<
		StructuredFact,
		"subjectId" | "propertyId" | "value" | "polarity" | "cardinality"
	>;
}

export type DeleteVerificationResult =
	| { authorized: false }
	| { authorized: true; targetFactId: string };

/** Secondary semantic authorization and exact target selection for a delete. */
export type DeleteVerifier = (
	episode: Episode,
	fact: ExtractedFact,
	candidates: DeleteCandidate[],
) => Promise<DeleteVerificationResult>;

/** A fact extracted from episodes (before insertion) */
export interface ExtractedFact {
	attribute?: import("./types.js").FactAttribute;
	content: string;
	/** First-person subject inherited from a connected preceding proposition. */
	inheritedFirstPerson?: boolean;
	entities: string[];
	topics: string[];
	importance: number;
	/** Highest emotional valence among source episodes (0.0–1.0).
	 *  Optional — defaults to 0 when absent (matches stored `Fact.maxEmotion`). */
	maxEmotion?: number;
	sourceEpisodeIds: string[];
	/** Optional explicit structure for conservative write-time supersession. */
	structured?: StructuredFact;
	/** Explicit memory mutation. Delete is honored only with an exact structured target. */
	operation?: "upsert" | "delete";
	/** Grounding retained so the mutation sink can independently revalidate deletes. */
	deleteEvidence?: {
		kind: "explicit_removal_request" | "durable_cessation";
		evidenceQuote: string;
		targetQuote: string;
	};
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
	/** Maximum LocalAdapter candidates admitted by vector similarity alone (default 50). */
	vectorCandidateLimit?: number;
	/** Consolidation interval in ms (default: 30 minutes) */
	consolidationIntervalMs?: number;
	/** Custom fact extractor (default: heuristic). Inject LLM-based extractor in production. */
	factExtractor?: FactExtractor;
	/** Optional second decision for deletes. Without it, LocalAdapter uses its own conservative matching; other adapters fail closed. */
	deleteVerifier?: DeleteVerifier;
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
function splitPropositions(content: string): { content: string; inheritedFirstPerson: boolean }[] {
	const pieces = content.split(/((?<=[.!?。！？])\s*|\n+|(?<=[고데]),\s*|\s+and\s+)/iu);
	const result: { content: string; inheritedFirstPerson: boolean }[] = [];
	let previousFirstPerson = false;
	for (let i = 0; i < pieces.length; i += 2) {
		const piece = pieces[i].trim();
		if (!piece) continue;
		const connected = i > 0 && /^,/.test(pieces[i - 1]);
		const explicitFirstPerson = /(?:^|\s)(?:내가|나는|저는|제가)(?=\s|$)/.test(piece);
		const otherSubject = /(?:^|\s)(?!(?:나는|내가|저는|제가)(?:\s|$))(?:[가-힣]+\s+)?[가-힣]+(?:은|는|이|가)(?=\s)/.test(piece);
		const inheritedFirstPerson: boolean = connected && previousFirstPerson && !explicitFirstPerson && !otherSubject;
		// Korean commonly omits the subject; a predicate is enough in context.
		const predicate = /[가-힣]+(?:다|어|아|야|해|고|데|요|음|함|임)(?:[.!?。！？,]*)$|\b(?:am|is|are|was|were|live|lives|work|works|worked|moved|have|has|like|likes)\b/i.test(piece);
		if ((piece.replace(/[^\p{L}\p{N}]/gu, "").length < 4 || !predicate) && result.length) result[result.length - 1].content += ` ${piece}`;
		else result.push({ content: piece, inheritedFirstPerson });
		previousFirstPerson = explicitFirstPerson || inheritedFirstPerson;
	}
	return result;
}

function factAttribute(content: string): import("./types.js").FactAttribute {
	if (/(?:예전|이전|전에|과거).*(?:일했|근무|직장)|\b(?:previously|formerly|before)\b.*\bworked\b/i.test(content)) return "past_workplace";
	if (/살아|살고|살았|거주|이사|\b(?:live|lives|lived|moved)\b/i.test(content)) return "residence";
	if (/(?:의사|개발자|디자이너|교사)(?:야|예요|이에요|입니다)[.!?。！？]*$/u.test(content) || /\bi am an? (?:doctor|developer|designer|teacher|engineer)[.!?]*$/i.test(content)) return "occupation";
	if (/일해|일하|일했|근무|(?:가|사|원|자|장|인|관|교사|의사)(?:이야|이고|인데|입니다)|\b(?:work|works|worked|occupation|profession)\b/i.test(content)) return "occupation";
	return "general";
}
export async function heuristicFactExtractor(
	episodes: Episode[],
): Promise<ExtractedFact[]> {
	if (!_heuristicWarnOnce) {
		console.warn(
			"[MemorySystem] Using heuristic fact extractor (no LLM). Inject factExtractor option for production.",
		);
		_heuristicWarnOnce = true;
	}
	return episodes.flatMap<ExtractedFact>((ep) => {
		const target = ep.role === "user" ? deletionTarget(ep.content) : null;
		if (target) return [{ content: target, operation: "delete" as const, entities: [], topics: [], importance: ep.importance.utility, sourceEpisodeIds: [ep.id], deleteEvidence: { kind: "explicit_removal_request" as const, evidenceQuote: ep.content, targetQuote: target } }];
		return splitPropositions(ep.content).map(({ content, inheritedFirstPerson }) => ({
		content,
		inheritedFirstPerson,
		attribute: factAttribute(content),
		entities: [],
		topics: ep.encodingContext.project ? [ep.encodingContext.project] : [],
		importance: ep.importance.utility,
		maxEmotion: ep.importance.emotion,
		sourceEpisodeIds: [ep.id],
	}));
	});
}
