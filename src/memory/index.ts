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
} from "./types.js";

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
} from "./types.js";

// Import A/B test algorithm interfaces and implementations
import type { MemoryAlgorithm } from "./algorithms/base.js";
import { AlgorithmVariantA } from "./algorithms/variantA.js";
import { AlgorithmVariantB } from "./algorithms/variantB.js";


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
        maxEmotion: number;
        sourceEpisodeIds: string[];
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
async function heuristicFactExtractor(
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

// Phase D.1 — real consolidation primitives.
// Authored per outline at `.agents/progress/phase-d-1-outline.md`.

/** Korean particles stripped from token tails when stem length >= 2. */
export const ALLOWED_KOREAN_PARTICLES: readonly string[] = [
	"을",
	"를",
	"은",
	"는",
	"이",
	"가",
	"로",
	"으로",
	"에",
	"에서",
	"의",
	"과",
	"와",
	"도",
	"만",
	"까지",
	"부터",
	"에게",
	"한테",
];

/** Jaccard threshold above which two fact contents are treated as duplicates. */
export const DEDUP_JACCARD_THRESHOLD = 0.85;

export function stripKoreanParticle(token: string): string {
	for (const particle of ALLOWED_KOREAN_PARTICLES) {
		if (token.endsWith(particle)) {
			const stem = token.slice(0, -particle.length);
			// Only strip when stem length >= 2 (CT-09)
			if (stem.length >= 2) return stem;
		}
	}
	return token;
}

function contentTokens(text: string): Set<string> {
	const cleaned = text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, " ");
	const tokens = cleaned.split(/\s+/).filter((t) => t.length > 0);
	const out = new Set<string>();
	for (const raw of tokens) {
		const stemmed = stripKoreanParticle(raw);
		if (stemmed.length >= 3) {
			out.add(stemmed);
		}
	}
	return out;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
	// Fail-safe: empty sets are NOT treated as duplicates (JS-03).
	if (a.size === 0 && b.size === 0) return 0;
	if (a.size === 0 || b.size === 0) return 0;
	let intersection = 0;
	for (const x of a) {
		if (b.has(x)) intersection++;
	}
	const union = a.size + b.size - intersection;
	if (union === 0) return 0;
	return intersection / union;
}

const TEMPORAL_GROUP_WINDOW_MS = 30 * 60 * 1000;
const MAX_EPISODES_PER_CYCLE = 200;

function unionDedup<T>(a: readonly T[], b: readonly T[]): T[] {
	const seen = new Set<T>();
	const out: T[] = [];
	for (const x of a) {
		if (!seen.has(x)) {
			seen.add(x);
			out.push(x);
		}
	}
	for (const x of b) {
		if (!seen.has(x)) {
			seen.add(x);
			out.push(x);
		}
	}
	return out;
}

function factsWithinTemporalWindow(
	a: ExtractedFact,
	b: ExtractedFact,
	episodes: readonly Episode[],
): boolean {
	// If source-episode timestamps unavailable, fall back to content-only merge.
	if (episodes.length === 0) return true;
	const tsById = new Map<string, number>();
	for (const ep of episodes) tsById.set(ep.id, ep.timestamp);
	const aTimestamps = a.sourceEpisodeIds
		.map((id) => tsById.get(id))
		.filter((t): t is number => t !== undefined);
	const bTimestamps = b.sourceEpisodeIds
		.map((id) => tsById.get(id))
		.filter((t): t is number => t !== undefined);
	if (aTimestamps.length === 0 || bTimestamps.length === 0) return true;
	const minA = Math.min(...aTimestamps);
	const maxA = Math.max(...aTimestamps);
	const minB = Math.min(...bTimestamps);
	const maxB = Math.max(...bTimestamps);
	// Facts merge only if either fact's nearest timestamp is within
	// TEMPORAL_GROUP_WINDOW_MS of the other's nearest.
	const gap = Math.max(0, Math.max(minA, minB) - Math.min(maxA, maxB));
	return gap <= TEMPORAL_GROUP_WINDOW_MS;
}

function mergeRelatedFacts(
	facts: ExtractedFact[],
	sourceEpisodes?: Episode[],
): ExtractedFact[] {
	if (facts.length === 0) return [];
	const episodes = sourceEpisodes ?? [];
	const tokenCache: Set<string>[] = facts.map((f) => contentTokens(f.content));
	const merged: boolean[] = new Array(facts.length).fill(false);
	const out: ExtractedFact[] = [];

	for (let i = 0; i < facts.length; i++) {
		if (merged[i]) continue;
		let acc = facts[i] as ExtractedFact;
		merged[i] = true;
		for (let j = i + 1; j < facts.length; j++) {
			if (merged[j]) continue;
			const other = facts[j] as ExtractedFact;
			const sim = jaccardSimilarity(
				tokenCache[i] as Set<string>,
				tokenCache[j] as Set<string>,
			);
			if (
				sim > DEDUP_JACCARD_THRESHOLD &&
				factsWithinTemporalWindow(acc, other, episodes)
			) {
				acc = {
				        content: acc.content,
				        entities: unionDedup(acc.entities, other.entities),
				        topics: unionDedup(acc.topics, other.topics),
				        importance: Math.max(acc.importance, other.importance),
				        maxEmotion: Math.max(acc.maxEmotion, other.maxEmotion),
				        sourceEpisodeIds: unionDedup(
				                acc.sourceEpisodeIds,
				                other.sourceEpisodeIds,
				        ),
				};				merged[j] = true;
			}
		}
		out.push(acc);
	}
	return out;
}

/** @internal Test-only export for Phase D.1 primitives. */
export const __testables = {
	contentTokens,
	jaccardSimilarity,
	mergeRelatedFacts,
};

// Factory function to get the correct memory algorithm variant
function getMemoryAlgorithm(variant: string): MemoryAlgorithm {
	switch (variant) {
		case "control":
			return new AlgorithmVariantA();
		case "treatment":
			return new AlgorithmVariantB();
		default:
			console.warn(
				`Unknown memory algorithm variant: ${variant}. Defaulting to 'control'.`,
			);
			return new AlgorithmVariantA(); // Default to control
	}
}

export class MemorySystem {
	private readonly adapter: MemoryAdapter;
	private readonly _initPromise: Promise<void>;
	private consolidationTimer: ReturnType<typeof setInterval> | null = null;
	private readonly consolidationIntervalMs: number;
	private readonly factExtractor: FactExtractor;
	private readonly contradictionFilter: ContradictionFilterProvider;
	/** Phase B-γ A/B toggle. When true, encode() bypasses scoreImportance()
	 *  and uses a neutral max-utility score so importance gating has no
	 *  effect on retrieval ranking or decay. Default false. */
	private readonly disableImportanceGating: boolean;
	private _isConsolidating = false;
	/** R4 #26 — Background brain spike subscribers. naia-agent 가 on('spike')
	 *  으로 등록. emit 시점은 consolidate / decay / fact upsert 등 (R4 Step 3+). */
	private spikeHandlers: Array<
		(event: import("./spike.js").SpikeEvent) => Promise<
			import("./spike.js").SpikeAction | void
		>
	> = [];
	/** R4 #26 — Active context (naia-agent → naia-memory).
	 *  spike rule 평가 시 사용. cross-project leak 방지 (anchor §A10). */
	private activeContext: import("./spike.js").ActiveContext | null = null;
	/** R4 #26 Step 3c — Recent recall query history (ring buffer, max 100).
	 *  *0 result* query 가 *recall failure*. 새 fact 추출 시 history 매칭 시
	 *  emit reason='recall-failure-resolved'. naia-agent 통합 후 daily 사용
	 *  시 사용자가 자주 묻던 fact 가 새로 알려진 시점 신호. */
	private recallHistory: Array<{ query: string; resultCount: number; ts: number }> = [];
	private static readonly RECALL_HISTORY_MAX = 100;

	/**
	 * Rolling summaries keyed by sessionId. Incrementally built by
	 * `encode()` so `compact()` can return a precomputed digest (and flag
	 * `realtime: true`). Survives for the lifetime of the MemorySystem.
	 * Not persisted by default — host can call `snapshotRollingSummaries()`
	 * if durability is needed.
	 */
	private readonly rollingSummaries = new Map<string, RollingSummary>();
	/** Max messages tracked per rolling summary; older entries are folded
	 *  into `compressed`. Prevents unbounded growth on long sessions. */
	private readonly rollingHeadroom: number;
	/** Max characters allowed in `compressed` stem. Older compressed
	 *  fragments are truncated from the front when exceeded. */
	private readonly rollingCompressedMax: number;
	/** Max topic entries tracked per session. Uses LRU-recency eviction. */
	private readonly rollingTopicCap: number;

	constructor(options: MemorySystemOptions) {
		this.consolidationIntervalMs =
			options.consolidationIntervalMs ?? 30 * 60 * 1000;
		this.factExtractor = options.factExtractor ?? heuristicFactExtractor;
		// R2.5 — pluggable filter; falls back to env-based selection when caller
		// doesn't pin one. Tests pass HeuristicContradictionFilter explicitly to
		// avoid env coupling.
		this.contradictionFilter =
			options.contradictionFilter ??
			(typeof process !== "undefined" && process.env
				? selectFilter(process.env)
				: new HeuristicContradictionFilter());
		this.disableImportanceGating = options.disableImportanceGating ?? false;
		if (options.summarizer) this.summarizer = options.summarizer;
		this.rollingHeadroom = options.rollingSummaryOptions?.headroom ?? 24;
		this.rollingCompressedMax = options.rollingSummaryOptions?.compressedMax ?? 4000;
		this.rollingTopicCap = options.rollingSummaryOptions?.topicCap ?? 24;

		if (options.qdrantOptions) {
			if (!options.embeddingProvider) {
				throw new Error(
					"Qdrant adapter requires an embeddingProvider in MemorySystemOptions",
				);
			}
			const qdrantAdapter = new QdrantAdapter({
				...options.qdrantOptions,
				embeddingProvider: options.embeddingProvider,
			});
			this.adapter = qdrantAdapter;
			this._initPromise = qdrantAdapter.initialize();
		} else if (options.adapter) {
			this.adapter = options.adapter;
			this._initPromise = Promise.resolve();
		} else {
			const localAdapter = new LocalAdapter({
				embeddingProvider: options.embeddingProvider,
				disableKGSpreading: options.disableKGSpreading,
				reranker: options.reranker,
			});
			this.adapter = localAdapter;
			this._initPromise = Promise.resolve();
		}
	}

	/** Asynchronously initializes the MemorySystem. Must be called after constructor. */
	async init(): Promise<void> {
		await this._initPromise;
	}

	/** Whether a consolidation cycle is currently running */
	get isConsolidating(): boolean {
		return this._isConsolidating;
	}

	// ─── Memory Encoding ──────────────────────────────────────────────────

	/**
	 * Encode a new memory from a conversation turn.
	 * Applies importance gating (amygdala analog) — low-utility inputs are dropped.
	 * Checks for contradictions with existing facts (reconsolidation).
	 *
	 * @returns The episode if stored, null if gated out
	 */
	async encode(
		input: MemoryInput,
		context: EncodingContext,
	): Promise<Episode> {
		// Phase B-γ A/B measurement toggle. When importance gating is
		// disabled we neutralize the 3-axis score (utility=1.0) so all
		// episodes carry equal weight through ranking, decay, and fact
		// extraction. The scoreImportance() function itself is unchanged.
		const score = this.disableImportanceGating
			? { importance: 1.0, surprise: 0.0, emotion: 0.5, utility: 1.0 }
			: scoreImportance(input);

		const now = input.timestamp ?? Date.now();
		const episode: Episode = {
			id: randomUUID(),
			content: input.content,
			role: input.role,
			summary: input.content.slice(0, 200),
			timestamp: now,
			importance: score,
			encodingContext: context,
			consolidated: false,
			recallCount: 0,
			lastAccessed: now,
			strength: score.utility,
		};

		await this.adapter.episode.store(episode);

		// Rolling-summary incremental update (compact v2 hook).
		// Keeps a per-session digest live so compact() can return it
		// without re-reading the conversation window.
		this.updateRollingSummary(input, context);

		// Reconsolidation: check if new info contradicts existing facts
		// Runs for all stored messages — contradiction detection is cheap
		await this.checkAndReconsolidate(
			input.content,
			episode.id,
			score.utility,
			now,
			context.project,
		);

		// Strengthen associations between entities in the encoding context
		if (context.project && context.activeFile) {
			await this.adapter.semantic.associate(
				context.project,
				context.activeFile,
			);
		}

		return episode;
	}

	/**
	 * Check new information against existing facts for contradictions.
	 * Automatically updates facts when contradictions are detected (reconsolidation).
	 *
	 * Uses vector search instead of getAll() — O(topK) instead of O(N).
	 */
	private async checkAndReconsolidate(
		newInfo: string,
		episodeId: string,
		importance: number,
		now: number,
		project?: string,
	): Promise<void> {
		// Search for semantically similar facts instead of loading all
		// Reconsolidation 용 search — 모든 후보 검토해야 (#27 minConfidence
		// 적용 X). 명시적 0 으로 future default 변경 시 안전.
		const candidates = await this.adapter.semantic.search(newInfo, 10, false, { project, minConfidence: 0 });
		const contradictions = findContradictions(candidates, newInfo);

		// Update ALL contradicted facts to prevent stale contradictory data
		// (Partial resolution bug #4 fixed).
		//
		// R2.5 v2 (사용자 directive 2026-05-08, 보존 우선):
		//  - 옛 fact 의 *데이터 그대로* — splice X, status `superseded` 유지
		//  - validTo = now (bi-temporal validity 종료)
		//  - successorId = 새 fact id (chain forward)
		//  - 새 fact: supersedes = 옛 fact id (chain backward), validFrom = now,
		//    validTo = null (현재 active)
		// status="superseded" 는 default search filter 와 backward compat 유지.
		// 새로 추가된 chain pointer + validTo 가 history mode recall 에 사용됨.
		for (const { fact, result } of contradictions) {
			if (result.action === "update" && result.updatedContent) {
				const newImportance = Math.max(fact.importance, importance, 0.7);
				const successorId = `${fact.id}-v${Date.now()}`;
				await this.adapter.semantic.upsert({
					...fact,
					status: "superseded",
					updatedAt: now,
					validTo: now,
					successorId,
				});
				await this.adapter.semantic.upsert({
					...fact,
					id: successorId,
					content: result.updatedContent,
					status: "active",
					createdAt: now,
					updatedAt: now,
					lastAccessed: now,
					importance: newImportance,
					strength: newImportance,
					sourceEpisodes: [...new Set([...fact.sourceEpisodes, episodeId])],
					supersedes: fact.id,
					validFrom: now,
					validTo: null,
				});
				// R4 #26 Step 3a — supersede 시점 spike emit (contradiction reason).
				// naia-agent 가 subscribe 시 source-monitor + pragmatic-gate 로
				// "아.. 그거 아니었어, [새 fact]" 자연 inject 결정.
				await this.emitSpike({
					factId: successorId,
					content: result.updatedContent,
					reason: "contradiction",
					confidence: 0.9, // R2.5 detection 자체는 high confidence
					relatedFactIds: [fact.id], // predecessor (옛 fact)
					emittedAt: now,
					scope: project ? { project } : undefined,
				});
			}
		}
	}

	// ─── Memory Retrieval ─────────────────────────────────────────────────

	/**
	 * Recall relevant memories for a query.
	 * Combines episodic recall + semantic search + procedural reflections.
	 * Implements Tulving's encoding specificity — context at retrieval matters.
	 */
	async recall(
		query: string,
		context: RecallContext,
	): Promise<{
		episodes: Episode[];
		facts: Fact[];
		reflections: Reflection[];
	}> {
		const topK = context.topK ?? 20;

		const [episodes, facts, reflections] = await Promise.all([
			this.adapter.episode.recall(query, { ...context, topK }),
			this.adapter.semantic.search(query, topK, context.deepRecall, {
			        project: context.project,
			        atTimestamp: context.atTimestamp,
			        mode: context.mode,
			        minConfidence: context.minConfidence,
			        queryHint: context.queryHint,
			        scopeMode: context.scopeMode,
			        crossProject: context.crossProject,
			        epochAnchor: context.epochAnchor,
			}),			this.adapter.procedural.getReflections(query, topK),
		]);

		// R4 Step 3c — recall history ring buffer.
		this.recallHistory.push({
			query,
			resultCount: facts.length,
			ts: Date.now(),
		});
		if (this.recallHistory.length > MemorySystem.RECALL_HISTORY_MAX) {
			this.recallHistory.shift();
		}

		return { episodes, facts, reflections };
	}

	/** R4 Step 3c — recall-failure-resolved detection.
	 *  새 fact 가 추출됐는데, *최근 fail recall* (resultCount=0) 의 query
	 *  와 매칭 시 emit. naia-agent 통합 후 \"사용자가 자주 묻던 거 이제 알아\"
	 *  signal. */
	private async checkRecallFailureResolved(
		newFact: { id: string; content: string; encodingContext?: any },
		now: number,
	): Promise<void> {
		// 최근 fail history 조회
		const failedQueries = this.recallHistory.filter((h) => h.resultCount === 0);
		if (failedQueries.length === 0) return;
		// 새 fact content 와 substring 매칭
		const factLower = newFact.content.toLowerCase();
		for (const fail of failedQueries) {
			const queryLower = fail.query.toLowerCase();
			// query 의 핵심 token (length ≥ 2) 이 새 fact 에 포함?
			const tokens = queryLower
				.split(/[\s,.\?!]+/)
				.filter((t) => t.length >= 2);
			const hit = tokens.some((t) => factLower.includes(t));
			if (hit) {
				await this.emitSpike({
					factId: newFact.id,
					content: newFact.content,
					reason: "recall-failure-resolved",
					confidence: 0.7,
					relatedFactIds: [],
					emittedAt: now,
					scope: newFact.encodingContext?.project
						? { project: newFact.encodingContext.project }
						: undefined,
				});
				// fail history 에서 resolved query 제거 (중복 emit 방지)
				const idx = this.recallHistory.indexOf(fail);
				if (idx >= 0) this.recallHistory.splice(idx, 1);
				break;
			}
		}
	}

	/** R4 Step 3d — repeated-fail 매칭 fact 자동 emit.
	 *  consolidate 시 새 fact 가 *repeated-fail query* 와 매칭되면 자동
	 *  emit reason='repeated-fail'. polling-free pattern (다른 trigger 와
	 *  일관성). */
	private async checkRepeatedFailResolved(
		newFact: { id: string; content: string; encodingContext?: any },
		now: number,
	): Promise<void> {
		const repeated = this.getRepeatedFailQueries(3, 3);
		if (repeated.length === 0) return;
		const factLower = newFact.content.toLowerCase();
		for (const rq of repeated) {
			const tokens = rq.split(/[\s,.\?!]+/).filter((t) => t.length >= 2);
			const hit = tokens.some((t) => factLower.includes(t));
			if (hit) {
				await this.emitSpike({
					factId: newFact.id,
					content: newFact.content,
					reason: "repeated-fail",
					confidence: 0.8, // 반복 + 매칭 = 신뢰성 ↑
					relatedFactIds: [],
					emittedAt: now,
					scope: newFact.encodingContext?.project
						? { project: newFact.encodingContext.project }
						: undefined,
				});
				// repeated query 의 history entries 제거 (중복 emit 방지)
				this.recallHistory = this.recallHistory.filter(
					(h) => h.query.toLowerCase().trim() !== rq,
				);
				break;
			}
		}
	}

	/** R4 Step 3d — repeated-fail detection.
	 *  같은 query 가 *3 회 이상* recall history 에 있고 *모두 result < 3*
	 *  → 사용자가 같은 거 반복 질문 + 답 부족. naia-agent 가 *진짜 답 모른다고
	 *  명시* 결정 또는 사용자 명시 알림 path. naia-agent#26 의 source-monitor
	 *  가 활용. */
	getRepeatedFailQueries(minRepeats = 3, maxResultThreshold = 3): string[] {
		const queryCounts = new Map<string, { count: number; allLow: boolean }>();
		for (const h of this.recallHistory) {
			const key = h.query.toLowerCase().trim();
			const existing = queryCounts.get(key) ?? { count: 0, allLow: true };
			existing.count++;
			if (h.resultCount >= maxResultThreshold) existing.allLow = false;
			queryCounts.set(key, existing);
		}
		const repeated: string[] = [];
		for (const [q, info] of queryCounts) {
			if (info.count >= minRepeats && info.allLow) repeated.push(q);
		}
		return repeated;
	}

	/**
	 * A/B Test enabled search method for memory algorithms.
	 * Uses the selected variant of the memory algorithm to perform the search.
	 */
	async search(
		query: string,
		variant = "control",
		options?: any,
	): Promise<any[]> {
		console.log(`[MemorySystem] Performing search with variant: ${variant}`);
		const algorithm = getMemoryAlgorithm(variant);
		// Log start time
		const startTime = process.hrtime.bigint();
		const results = await algorithm.retrieve(query, options);
		// Log end time and duration
		const endTime = process.hrtime.bigint();
		const durationMs = Number(endTime - startTime) / 1_000_000;
		console.log(
			`Experiment: memory_algorithm_experiment, Variant: ${variant}, Query: "${query}", Results Count: ${results.length}, Duration: ${durationMs.toFixed(2)}ms`,
		);
		return results;
	}

	/**
	 * Auto-recall for session init (L6 analog).
	 * Retrieves relevant context before first LLM call of a new session.
	 */
	async sessionRecall(
		firstMessage: string,
		context: RecallContext,
		tokenBudget?: number,
	): Promise<string> {
		const { episodes, facts, reflections } = await this.recall(firstMessage, {
			...context,
			topK: 20,
		});

		if (facts.length === 0 && reflections.length === 0 && episodes.length === 0)
			return "";

		const hasKorean = (s: string) => /[가-힣]/.test(s);
		const lang: "ko" | "en" =
			hasKorean(firstMessage) ||
			facts.some((f) => hasKorean(f.content)) ||
			episodes.some((e) => hasKorean(e.content))
				? "ko"
				: "en";

		return allocateBudget(facts, episodes, reflections, {
			maxTokens: tokenBudget ?? 2000,
			lang,
		});
	}

	// ─── Procedural Learning ──────────────────────────────────────────────

	/**
	 * Record a task failure with self-reflection (Reflexion pattern).
	 */
	async reflectOnFailure(
		task: string,
		failure: string,
		analysis: string,
		correction: string,
	): Promise<void> {
		const reflection: Reflection = {
			task,
			failure,
			analysis,
			correction,
			timestamp: Date.now(),
		};
		await this.adapter.procedural.learnFromFailure(reflection);
	}

	// ─── Consolidation (Sleep Cycle) ──────────────────────────────────────

	/**
	 * Start the background consolidation timer.
	 * Runs periodically during idle time, like sleep-cycle memory consolidation.
	 *
	 * Neuroscience basis: during slow-wave sleep, the hippocampus replays
	 * recent experiences and transfers patterns to the neocortex.
	 */
	startConsolidation(): void {
		if (this.consolidationTimer) return;
		this.consolidationTimer = setInterval(async () => {
			try {
				await this.consolidateNow();
			} catch (err) {
				// Non-critical — log and continue
				console.error("[MemorySystem] consolidation error:", err);
			}
		}, this.consolidationIntervalMs);
	}

	/** Stop the consolidation timer */
	stopConsolidation(): void {
		if (this.consolidationTimer) {
			clearInterval(this.consolidationTimer);
			this.consolidationTimer = null;
		}
	}

	/**
	 * Run a full consolidation cycle on demand.
	 *
	 * Pipeline:
	 * 1. Extract facts from unconsolidated episodes (hippocampal replay)
	 * 2. Check extracted facts against existing facts (reconsolidation)
	 * 3. Upsert new/updated facts into semantic memory
	 * 4. Mark processed episodes as consolidated
	 * 5. Run adapter-level decay + association cleanup
	 */
	async consolidateNow(force = false): Promise<ConsolidationResult> {
		if (this._isConsolidating) {
			return {
				episodesProcessed: 0,
				factsCreated: 0,
				factsUpdated: 0,
				memoriesPruned: 0,
				associationsUpdated: 0,
			};
		}
		this._isConsolidating = true;

		try {
			const now = Date.now();
			let factsCreated = 0;
			let factsUpdated = 0;

			// 1. Get unconsolidated episodes
			// LocalAdapter returns insertion order (oldest-first); slice preserves that order.
			const unconsolidated = await this.adapter.episode.getUnconsolidated();
			const readyEpisodes = unconsolidated
				.filter((ep) => force || now - ep.timestamp > 5 * 60 * 1000) // 5 min age gate (skip if forced)
				.slice(0, MAX_EPISODES_PER_CYCLE); // Cap batch size — oldest first

			if (readyEpisodes.length > 0) {
				// 2. Extract facts from episodes
				const extracted = await this.factExtractor(readyEpisodes);

				// Dedup entity-pair associations across the entire cycle (not just per-fact)
				const seenPairs = new Set<string>();

				// 3. For each extracted fact, check contradictions and upsert
				for (const ef of extracted) {
					const srcEp = readyEpisodes.find((e) =>
						ef.sourceEpisodeIds.includes(e.id),
					);
					const efProject = srcEp?.encodingContext?.project;
					// Search for semantically similar facts instead of getAll() — O(topK) not O(N).
					// R2.5 (#20): deepRecall=true so the isRelevant threshold
					// (`vs>=0.12 || bs>0 || eb>=0.2`) does NOT prune candidates here. For
					// contradiction detection we want broad recall — even loosely related
					// facts must reach the LLM filter so it can decide.
					const existingFacts = await this.adapter.semantic.search(
						ef.content,
						10,
						true,
						efProject ? { project: efProject } : undefined,
					);
					if (process.env.NAIA_FILTER_DEBUG === "1") {
						const totalFacts = (this.adapter as any).getStore?.()?.facts?.length ?? "?";
						console.error(
							`[FILTER_DEBUG] search("${ef.content.slice(0, 40)}", topK=10, deepRecall=true, proj=${efProject ?? "—"}) → ${existingFacts.length} hits | store total facts: ${totalFacts}`,
						);
					}

					// Check for exact/near identity to prevent semantic redundancy (#4)
					const duplicate = existingFacts.find((f) => {
						const sim = jaccardSimilarity(
							contentTokens(f.content),
							contentTokens(ef.content),
						);
						return sim > 0.85; // High similarity threshold for identity
					});

					if (duplicate) {
						// Near-duplicate found — update metadata but don't create new entry
						const newImportance = Math.max(
						        duplicate.importance,
						        ef.importance,
						        0.7,
						);
						const newMaxEmotion = Math.max(
						        duplicate.maxEmotion ?? 0,
						        ef.maxEmotion,
						);
						await this.adapter.semantic.upsert({
						        ...duplicate,
						        updatedAt: now,
						        lastAccessed: now, // Strengthening on reactivation
						        importance: newImportance,
						        maxEmotion: newMaxEmotion,
						        strength: newImportance,
						        sourceEpisodes: [
						                ...new Set([
						                   ...duplicate.sourceEpisodes,
						                   ...ef.sourceEpisodeIds,
						                ]),
						        ],
						});						factsUpdated++;
						continue;
					}

					const contradictions = await findContradictionsWith(
						existingFacts,
						ef.content,
						this.contradictionFilter,
					);

					if (contradictions.length > 0) {
						// Update ALL contradicted facts to prevent stale contradictory data
						// (Partial resolution bug #4 fixed).
						// R2.5 v2: chain + bi-temporal validity (보존 우선).
						for (const { fact, result } of contradictions) {
							if (result.action === "update" && result.updatedContent) {
								const newImportance = Math.max(
								   fact.importance,
								   ef.importance,
								   0.7,
								);
								const newMaxEmotion = Math.max(
								   fact.maxEmotion ?? 0,
								   ef.maxEmotion,
								);
								const successorId = `${fact.id}-v${Date.now()}`;
								await this.adapter.semantic.upsert({
								   ...fact,
								   status: "superseded",
								   updatedAt: now,
								   validTo: now,
								   successorId,
								});
								await this.adapter.semantic.upsert({
								   ...fact,
								   id: successorId,
								   content: result.updatedContent,
								   status: "active",
								   createdAt: now,
								   updatedAt: now,
								   lastAccessed: now,
								   importance: newImportance,
								   maxEmotion: newMaxEmotion,
								   strength: newImportance,
								   sourceEpisodes: [
								   ...new Set([
								   ...fact.sourceEpisodes,
								   ...ef.sourceEpisodeIds,
								   ]),
								   ],
								   encodingContext: fact.encodingContext ?? srcEp?.encodingContext,
								   supersedes: fact.id,
								   validFrom: now,
								   validTo: null,
								});								// R4 #26 Step 3a — supersede 시점 spike emit
								// (consolidate path).
								await this.emitSpike({
									factId: successorId,
									content: result.updatedContent,
									reason: "contradiction",
									confidence: 0.9,
									relatedFactIds: [fact.id],
									emittedAt: now,
									scope: fact.encodingContext?.project
										? { project: fact.encodingContext.project }
										: undefined,
								});
								factsUpdated++;
							}
						}
					} else {
						// New fact — create with deterministic UUID for idempotency
						// Prevents duplicates if consolidation is interrupted and re-run.
						// Format: 32 SHA-256 hex chars arranged as UUID (8-4-4-4-12) — accepted by both
						// LocalAdapter (string key) and QdrantAdapter (requires UUID format).
						const hashHex = crypto
							.createHash("sha256")
							.update(ef.content + ef.sourceEpisodeIds.sort().join(","))
							.digest("hex")
							.slice(0, 32);
						const deterministicId = `${hashHex.slice(0, 8)}-${hashHex.slice(8, 12)}-${hashHex.slice(12, 16)}-${hashHex.slice(16, 20)}-${hashHex.slice(20, 32)}`;

						const newImportance = Math.max(ef.importance, 0.7);
						const newFact: Fact = {
						        id: deterministicId,
						        content: ef.content,
						        entities: ef.entities,
						        topics: ef.topics,
						        createdAt: now,
						        updatedAt: now,
						        importance: newImportance,
						        maxEmotion: ef.maxEmotion,
						        recallCount: 0,
						        lastAccessed: now,
						        strength: newImportance,
						        status: "active",
						        sourceEpisodes: ef.sourceEpisodeIds,
						        encodingContext: srcEp?.encodingContext,
						};						await this.adapter.semantic.upsert(newFact);
						factsCreated++;
						// R4 #26 Step 3b — high-importance + active context relevant
						// 시점 spike emit. naia-agent 가 active context push 했고,
						// 새 fact 가 active topic 또는 entity 매칭 + importance ≥ 0.8.
						if (
							this.activeContext &&
							newImportance >= 0.8 &&
							this.matchesActiveContext(newFact)
						) {
							await this.emitSpike({
								factId: deterministicId,
								content: ef.content,
								reason: "high-importance-relevant",
								confidence: newImportance,
								relatedFactIds: [],
								emittedAt: now,
								scope: srcEp?.encodingContext?.project
									? { project: srcEp.encodingContext.project }
									: undefined,
							});
						}
						// R4 Step 3c — recall-failure-resolved 검사.
						await this.checkRecallFailureResolved(newFact, now);
						// R4 Step 3d — repeated-fail 검사 (자동 emit).
						await this.checkRepeatedFailResolved(newFact, now);
					}

					// Strengthen associations between extracted entities (cycle-level dedup)
					for (let i = 0; i < ef.entities.length; i++) {
						for (let j = i + 1; j < ef.entities.length; j++) {
							const a = ef.entities[i].toLowerCase();
							const b = ef.entities[j].toLowerCase();
							const pairKey = a < b ? `${a}|${b}` : `${b}|${a}`;
							if (seenPairs.has(pairKey)) continue;
							seenPairs.add(pairKey);
							await this.adapter.semantic.associate(a, b, 0.05);
						}
					}
				}

				// 4. Mark episodes as consolidated
				await this.adapter.episode.markConsolidated(
					readyEpisodes.map((ep) => ep.id),
				);
			}

			// 5. Run adapter-level decay + cleanup
			const adapterResult = await this.adapter.consolidate();

			// 6. R4 #220 Step 3 — Semantic Consolidation (Insight Distillation)
			//    Distill clusters of facts into high-level insights.
			const insightsCreated = await this.distillInsights(now);

			// 7. R4 #26 Step 4 — Replay-worthy fact strength boost.
			//    학계 정합 (anchor §7): Sharp-wave ripples + CLS — 자다가
			//    *recent + important + recently-recalled* fact 의 strength
			//    를 강화 (replay). decay 의 반대 동작.
			//
			// 기준:
			//  - createdAt < 14일 이내 (recent)
			//  - importance >= 0.7 (high)
			//  - 또는 lastAccessed < 7일 이내 (recent recall)
			//  - active context topic 매칭 시 추가 boost
			const sevenDays = 7 * 24 * 60 * 60 * 1000;
			const fourteenDays = 14 * 24 * 60 * 60 * 1000;
			let replayBoosted = 0;
			try {
			        const allFacts = await this.adapter.semantic.getAll();
			        for (const fact of allFacts) {
			                if (fact.status !== "active") continue;
			                const isRecent = now - fact.createdAt < fourteenDays;
			                const isImportant = fact.importance >= 0.7;
			                const recentRecall = now - fact.lastAccessed < sevenDays;
			                if (!(isRecent && isImportant) && !recentRecall) continue;
			                // boost = +5% strength, capped 1.0
			                const boost = this.matchesActiveContextFact(fact) ? 0.1 : 0.05;
			                fact.strength = Math.min(1.0, fact.strength + boost);
			                await this.adapter.semantic.upsert(fact);
			                replayBoosted++;
			        }
			} catch (e: any) {
			        console.warn(`[MemorySystem] replay boost failed: ${e?.message}`);
			}
			// 측정 framework — replay 갯수 기록.
			try {
			        const { recordReplayBoost } = await import("./usage-tracker.js");
			        recordReplayBoost(replayBoosted);
			} catch {}

			return {
			        episodesProcessed: readyEpisodes.length,
			        factsCreated,
			        factsUpdated,
			        insightsCreated,
			        memoriesPruned: adapterResult.memoriesPruned,
			        associationsUpdated: adapterResult.associationsUpdated,
			        // R4 Step 4 — replay boost count (informational, not part of legacy
			        // ConsolidationResult contract; type-assert to extend).
			        ...({ replayBoosted } as any),
			};
			} finally {
			this._isConsolidating = false;
			}
			}

			/**
			* R4 #220 Step 3 — Semantic Consolidation (The Power of Forgetting).
			* 
			* Distills clusters of related facts into high-level semantic insights.
			* Prunes/archives the raw facts that have been fully consolidated to mirror 
			* human memory abstraction.
			*/
			private async distillInsights(now: number): Promise<number> {
			let insightsCreated = 0;
			try {
			// Get all active facts that are not already insights
			const allFacts = await this.adapter.semantic.getAll();
			const activeFacts = allFacts.filter(
			        (f) =>
			                f.status === "active" &&
			                !(f.topics?.includes("system:insight") ?? false),
			);

			// Use KnowledgeGraph hubs to identify candidates for distillation
			// This mirrors how the brain prioritizes highly-connected concepts for abstraction.
			const hubs =
			        "getHubs" in this.adapter
			                ? await (this.adapter as any).getHubs()
			                : "getStore" in this.adapter
			                        ? (this.adapter as any).getStore().knowledgeGraph?.nodes ?? {}
			                        : {};
			const hubNames = Object.keys(hubs).sort(
			        (a, b) => (hubs[b].frequency ?? 0) - (hubs[a].frequency ?? 0),
			);

			for (const hubName of hubNames.slice(0, 10)) {
			        const related = activeFacts.filter((f) =>
			                f.entities.some((e) => e.toLowerCase() === hubName.toLowerCase()),
			        );

			        // Threshold for distillation: 3+ related facts about a hub entity
			        if (related.length >= 3) {
			                // R4 #220 — Genuine insight distillation.
			                // Summarize the core themes of the related facts.
			                const themes = [...new Set(related.flatMap(f => f.topics ?? []))].join(", ");
			                const distilledContent = `Consolidated Insight on '${hubName}': Observed consistent patterns regarding ${themes}. Key observations include: ${related.map(f => f.content).join("; ")}`;

			                const hashHex = crypto
			                        .createHash("sha256")
			                        .update("insight:" + hubName + related.map((f) => f.id).sort().join(","))
			                        .digest("hex")
			                        .slice(0, 32);			                const deterministicId = `insight-${hashHex.slice(0, 8)}-${hashHex.slice(8, 12)}-${hashHex.slice(12, 16)}-${hashHex.slice(16, 20)}-${hashHex.slice(20, 32)}`;

			                const insightFact: Fact = {
			                        id: deterministicId,
			                        content: distilledContent,
			                        entities: [hubName],
			                        topics: [
			                                "system:insight",
			                                ...new Set(related.flatMap((f) => f.topics ?? [])),
			                        ],
			                        createdAt: now,
			                        updatedAt: now,
			                        importance: 0.95, // Insights are highly important
			                        maxEmotion: Math.max(...related.map((f) => f.maxEmotion ?? 0), 0.5),
			                        recallCount: 0,
			                        lastAccessed: now,
			                        strength: 1.0, // Fresh insights start at full strength
			                        status: "active",
			                        sourceEpisodes: [
			                                ...new Set(related.flatMap((f) => f.sourceEpisodes)),
			                        ],
			                        encodingContext: { category: "insight" },
			                };

			                await this.adapter.semantic.upsert(insightFact);
			                insightsCreated++;

			                // "The Power of Forgetting": Archive source facts to prioritize the insight.
			                // This reduces noise in standard retrieval.
			                for (const f of related) {
			                        f.status = "archived";
			                        f.strength *= 0.5; // Weaken for Ebbinghaus decay sweep
			                        await this.adapter.semantic.upsert(f);
			                }
			        }
			}
			} catch (e: any) {
			console.warn(`[MemorySystem] insight distillation failed: ${e?.message}`);
			}
			return insightsCreated;
			}
	// ─── Backup ───────────────────────────────────────────────────────────

	/** Returns true if the current adapter supports encrypted backup. */
	supportsBackup(): boolean {
		return "export" in this.adapter && "import" in this.adapter;
	}

	/**
	 * Export an encrypted backup of the memory store.
	 * Only available when the adapter implements BackupCapable.
	 * @throws Error if the current adapter does not support backup.
	 */
	async exportBackup(password: string): Promise<Uint8Array> {
		if (!this.supportsBackup()) {
			throw new Error("Current memory adapter does not support backup export");
		}
		return (this.adapter as unknown as BackupCapable).export(password);
	}

	/**
	 * Import an encrypted backup, replacing the current memory store.
	 * Only available when the adapter implements BackupCapable.
	 * @throws Error if the current adapter does not support backup.
	 */
	async importBackup(blob: Uint8Array, password: string): Promise<void> {
		if (!this.supportsBackup()) {
			throw new Error("Current memory adapter does not support backup import");
		}
		return (this.adapter as unknown as BackupCapable).import(blob, password);
	}

	// ─── Rolling summary (v2 — realtime compaction prep) ──────────────────

	/**
	 * Incrementally extend the per-session rolling summary when a new
	 * message is encoded. Drops old raw messages beyond `rollingHeadroom`
	 * into the `compressed` stem (topic counts + first/last quotes).
	 */
	private updateRollingSummary(input: MemoryInput, context: EncodingContext): void {
		const sessionId = context.sessionId;
		if (!sessionId) return; // only track when caller provides sessionId

		let rs = this.rollingSummaries.get(sessionId);
		if (!rs) {
			rs = {
				sessionId,
				started: Date.now(),
				updated: Date.now(),
				recent: [],
				compressed: "",
				userCount: 0,
				assistantCount: 0,
				toolCount: 0,
				topics: new Map<string, number>(),
				firstUser: undefined,
			};
			this.rollingSummaries.set(sessionId, rs);
		}

		if (input.role === "user") {
			rs.userCount++;
			if (!rs.firstUser) rs.firstUser = truncateForRecap(input.content, 120);
		} else if (input.role === "assistant") {
			rs.assistantCount++;
		} else if (input.role === "tool") {
			rs.toolCount++;
		}

		// LRU topic tracking: delete-then-set marks recency. Unicode-aware
		// regex catches Korean/CJK/accented alphabets too.
		for (const match of input.content.matchAll(/\b[\p{Lu}\p{Lo}][\p{L}\p{N}_-]{2,}\b/gu)) {
			const topic = match[0];
			if (rs.topics.has(topic)) rs.topics.delete(topic);
			rs.topics.set(topic, Date.now());
			while (rs.topics.size > this.rollingTopicCap) {
				// Map iteration is insertion order → first entry is LRU.
				const iter = rs.topics.keys().next();
				if (iter.done) break;
				rs.topics.delete(iter.value);
			}
		}

		rs.recent.push({
			role: input.role,
			content: input.content,
			timestamp: input.timestamp ?? Date.now(),
		});
		if (rs.recent.length > this.rollingHeadroom) {
			const evicted = rs.recent.splice(0, rs.recent.length - this.rollingHeadroom);
			if (evicted.length > 0) {
				const compressed = compressEvictedMessages(evicted);
				rs.compressed = rs.compressed ? `${rs.compressed}\n${compressed}` : compressed;
				// Truncate from the front when the stem exceeds its cap.
				if (rs.compressed.length > this.rollingCompressedMax) {
					const overflow = rs.compressed.length - this.rollingCompressedMax;
					rs.compressed = `[…earlier stem truncated…]\n${rs.compressed.slice(overflow)}`;
				}
			}
		}
		rs.updated = Date.now();
	}

	/**
	 * Debug / persistence hook — export rolling summaries for host-managed
	 * durability. Restoration via `loadRollingSummaries()` is planned.
	 */
	snapshotRollingSummaries(): RollingSummarySnapshot[] {
		return Array.from(this.rollingSummaries.values()).map((rs) => ({
			sessionId: rs.sessionId,
			started: rs.started,
			updated: rs.updated,
			recent: [...rs.recent],
			compressed: rs.compressed,
			userCount: rs.userCount,
			assistantCount: rs.assistantCount,
			toolCount: rs.toolCount,
			topics: Array.from(rs.topics.keys()),
			...(rs.firstUser !== undefined ? { firstUser: rs.firstUser } : {}),
		}));
	}

	/** Clear a single session's rolling summary (e.g. on session close). */
	clearRollingSummary(sessionId: string): void {
		this.rollingSummaries.delete(sessionId);
	}

	/**
	 * Restore rolling summaries from a prior `snapshotRollingSummaries()`
	 * result. Use for process-level durability (write snapshot to disk,
	 * restore on restart). Overwrites any existing in-memory entries for
	 * the same sessionId.
	 */
	loadRollingSummaries(snapshots: readonly RollingSummarySnapshot[]): void {
		for (const s of snapshots) {
			const topics = new Map<string, number>();
			for (const t of s.topics) topics.set(t, s.updated);
			const rs: RollingSummary = {
				sessionId: s.sessionId,
				started: s.started,
				updated: s.updated,
				recent: [...s.recent],
				compressed: s.compressed,
				userCount: s.userCount,
				assistantCount: s.assistantCount,
				toolCount: s.toolCount,
				topics,
			};
			if (s.firstUser !== undefined) rs.firstUser = s.firstUser;
			this.rollingSummaries.set(s.sessionId, rs);
		}
	}

	// ─── Compaction (naia-agent CompactableCapable) ──────────────────────
	//
	// Implements the shape of @nextain/agent-types `CompactableCapable`
	// structurally — no type-level import of that package is required,
	// keeping naia-memory's zero-dep guarantee on external ecosystem
	// packages.
	//
	// v0: deterministic summarizer that compresses a message window into a
	// synthetic recap paragraph. No LLM call.
	// **v1 (current)**: optional `summarizer` callback. When provided,
	// MemorySystem asks it to produce a higher-fidelity summary, fallback
	// to v0 recap on failure.
	// v2 (roadmap #6 CompactionMap): rolling summary maintained during
	// encode() so compact() returns an already-built summary instantly.

	/** Optional LLM-backed summarizer. Host injects via
	 *  `MemorySystemOptions.summarizer`. Receives the compaction input and
	 *  a deterministic recap seed; returns the polished summary text. */
	private readonly summarizer?: CompactionSummarizer;

	/**
	 * Produce a summary of the given message window suitable for replacing
	 * the head of a conversation when the LLM context approaches its budget.
	 *
	 * Structural match for `CompactableCapable.compact()`.
	 *
	 * v3 (Slice 3-XR-Compact #47):
	 * - `priorRecap` (optional): the prior compaction's recap message.
	 *   When present, prepended verbatim as a `## Prior recap (anchored)`
	 *   section so this compaction becomes anchored iterative summarization
	 *   (Factory.ai pattern) rather than naive head-summarize.
	 * - `strategy` (optional): hint to memory implementations. Currently
	 *   informational; future versions may switch summarization style.
	 * - Recap shape: legacy first-line header (preserved for backward
	 *   compatibility with existing tests) + structured 5-section markdown
	 *   appended (Goal / Instructions / Tool calls / Discoveries / Files).
	 */
	async compact(input: {
		messages: readonly { role: string; content: string; timestamp?: number }[];
		keepTail: number;
		targetTokens: number;
		sessionId?: string;
		strategy?: string;
		priorRecap?: { role: string; content: string; timestamp?: number };
	}): Promise<{
		summary: { role: "assistant"; content: string; timestamp?: number };
		droppedCount: number;
		realtime?: boolean;
	}> {
		const msgs = input.messages;

		// v2 fast path: if the caller supplied `sessionId` and we have a
		// rolling summary for it, use that as the seed. compact() becomes
		// essentially free — realtime=true.
		const rs = input.sessionId ? this.rollingSummaries.get(input.sessionId) : undefined;
		const baseRecap = rs
			? buildRecapFromRollingSummary(rs, msgs.length, input.keepTail)
			: buildDeterministicRecap(msgs, input.keepTail);

		// v3: structured sections (opencode pattern) appended after legacy
		// header. priorRecap merged as the leading anchor section.
		const structured = buildStructuredSections(msgs, input.priorRecap);
		const recap = structured.length > 0 ? `${baseRecap}\n\n${structured}` : baseRecap;

		let finalContent = recap;
		// Rolling-summary seed is precomputed → realtime=true unless a
		// summarizer overwrites the content.
		let realtime = rs !== undefined;
		if (this.summarizer) {
			try {
				const polished = await this.summarizer({
					messages: msgs,
					keepTail: input.keepTail,
					targetTokens: input.targetTokens,
					...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
					seedSummary: recap,
				});
				if (typeof polished === "string") {
					if (polished.trim().length > 0) finalContent = polished.trim();
				} else if (polished && typeof polished.content === "string") {
					if (polished.content.trim().length > 0) {
						finalContent = polished.content.trim();
					}
					if (polished.realtime === true) realtime = true;
				}
			} catch (err) {
				console.warn("[MemorySystem] compaction summarizer failed, using deterministic recap:", err);
			}
		}

		return {
			summary: {
				role: "assistant",
				content: finalContent,
				timestamp: Date.now(),
			},
			droppedCount: msgs.length,
			realtime,
		};
	}

	// ─── R4 #26 Background brain — spike + active context ──────────────

	/** Subscribe spike events. naia-agent 가 source-monitor + pragmatic-gate
	 *  로 처리 후 SpikeAction 반환 (또는 skip).
	 *  R4 Step 2 — emit infrastructure. 실 emit 은 Step 3 (consolidate
	 *  / R2.5 supersede / decay 시점) 에서 trigger 예정. */
	on(
		event: "spike",
		handler: (e: import("./spike.js").SpikeEvent) => Promise<
			import("./spike.js").SpikeAction | void
		>,
	): void {
		if (event === "spike") this.spikeHandlers.push(handler);
	}

	off(
		event: "spike",
		handler: (e: import("./spike.js").SpikeEvent) => Promise<
			import("./spike.js").SpikeAction | void
		>,
	): void {
		if (event === "spike") {
			const idx = this.spikeHandlers.indexOf(handler);
			if (idx >= 0) this.spikeHandlers.splice(idx, 1);
		}
	}

	/** Push active context — naia-agent 가 *현재 대화 context* 명시.
	 *  Background brain 의 spike rule 평가 시 사용. cross-project leak
	 *  방지 (anchor §A10) — scope.project 필수. */
	setActiveContext(ctx: import("./spike.js").ActiveContext): void {
		this.activeContext = ctx;
	}

	/** Read current active context (debug / introspection). */
	getActiveContext(): import("./spike.js").ActiveContext | null {
		return this.activeContext;
	}

	/** Internal — emit spike to all subscribers. R4 Step 3 — supersede /
	 *  high-importance-relevant trigger 에서 호출. */
	protected async emitSpike(
		event: import("./spike.js").SpikeEvent,
	): Promise<void> {
		// R4 Step 3 — optOutTopics 검사 (cross-project / privacy 차단).
		if (this.activeContext?.optOutTopics?.length) {
			const optOut = this.activeContext.optOutTopics;
			const lower = event.content.toLowerCase();
			if (optOut.some((t) => lower.includes(t.toLowerCase()))) {
				return; // skip
			}
		}
		// Cross-project leak 차단 (anchor §A10): scope.project 가 active
		// context project 와 다르면 skip.
		if (
			this.activeContext &&
			event.scope?.project &&
			event.scope.project !== this.activeContext.scope.project
		) {
			return;
		}
		// R4 측정 framework — emit count 기록 (handler 미등록도 count).
		try {
			const { recordSpike } = await import("./usage-tracker.js");
			recordSpike(event.reason);
		} catch {}
		for (const handler of this.spikeHandlers) {
			try {
				await handler(event);
			} catch (e: any) {
				console.warn(`[MemorySystem] spike handler failed: ${e?.message}`);
			}
		}
	}

	/** R4 Step 5c — User-emotion-anniversary spike detection.
	 *  Consolidate cycle 마다 *high importance + 같은 month/day* fact 매칭
	 *  시 emit. 학계 정합 (anchor §7): emotion-modulated memory (LeDoux 1996,
	 *  amygdala) + DMN 의 *anniversary effect*.
	 *
	 *  temporal-anchor 와 차이:
	 *  - temporal-anchor: 365 ± 1 day (1년 전 정확)
	 *  - user-emotion-anniversary: month/day 매칭 (연도 무관, 매년)
	 */
	private async detectEmotionAnniversaries(now: number): Promise<void> {
		try {
			const today = new Date(now);
			const todayMonth = today.getMonth();
			const todayDay = today.getDate();
			const allFacts = await this.adapter.semantic.getAll();
			for (const fact of allFacts) {
				if (fact.status !== "active") continue;
				if (fact.importance < 0.8) continue; // high importance only
				const factDate = new Date(fact.createdAt);
				if (
					factDate.getMonth() === todayMonth &&
					factDate.getDate() === todayDay &&
					factDate.getFullYear() < today.getFullYear() // 작년 이상
				) {
					await this.emitSpike({
						factId: fact.id,
						content: fact.content,
						reason: "user-emotion-anniversary",
						confidence: fact.importance,
						relatedFactIds: [],
						emittedAt: now,
						scope: fact.encodingContext?.project
							? { project: fact.encodingContext.project }
							: undefined,
					});
				}
			}
		} catch (e: any) {
			console.warn(`[MemorySystem] anniversary scan failed: ${e?.message}`);
		}
	}

	/** R4 Step 5a — Temporal-anchor spike detection.
	 *  Consolidate cycle 마다 fact 의 createdAt 이 *N 일 전 같은 날짜* 인지
	 *  확인 (1년 / 6개월 / 3개월 / 1개월). 매칭 시 emit.
	 *  학계 정합 (anchor §7): DMN 의 spontaneous reorganization — 시간
	 *  anchor 에 의한 연관 fact 떠올림. */
	private async detectTemporalAnchors(now: number): Promise<void> {
		try {
			const allFacts = await this.adapter.semantic.getAll();
			const ANCHORS = [365, 180, 90, 30]; // days
			const TOL = 1; // ±1 day
			const dayMs = 24 * 60 * 60 * 1000;
			for (const fact of allFacts) {
				if (fact.status !== "active") continue;
				if (fact.importance < 0.7) continue; // 중요 fact 만 anchor
				const ageDays = Math.round((now - fact.createdAt) / dayMs);
				const matched = ANCHORS.find((a) => Math.abs(ageDays - a) <= TOL);
				if (matched) {
					await this.emitSpike({
						factId: fact.id,
						content: fact.content,
						reason: "temporal-anchor",
						confidence: fact.importance,
						relatedFactIds: [],
						emittedAt: now,
						scope: fact.encodingContext?.project
							? { project: fact.encodingContext.project }
							: undefined,
					});
				}
			}
		} catch (e: any) {
			console.warn(`[MemorySystem] temporal-anchor scan failed: ${e?.message}`);
		}
	}

	/** R4 Step 4 — fact 가 active context 매칭 (replay boost 시 사용). */
	private matchesActiveContextFact(fact: Fact): boolean {
		return this.matchesActiveContext(fact);
	}

	/** R4 Step 3b — fact 가 active context topic / recentFactIds / entity
	 *  와 매칭? heuristic — fact content/topics 가 active topic substring 매칭. */
	private matchesActiveContext(fact: Fact): boolean {
		if (!this.activeContext) return false;
		const lower = fact.content.toLowerCase();
		// active topic substring 매칭
		for (const t of this.activeContext.topics) {
			if (lower.includes(t.toLowerCase())) return true;
		}
		// fact entity 가 active topic 매칭
		for (const e of fact.entities) {
			for (const t of this.activeContext.topics) {
				if (e.toLowerCase().includes(t.toLowerCase())) return true;
			}
		}
		return false;
	}

	/** R4 #220 — Register or update a life epoch. */
	async upsertEpoch(epoch: import("./types.js").Epoch): Promise<void> {
	        if ("upsertEpoch" in this.adapter) {
	                await (this.adapter as any).upsertEpoch(epoch);
	        }
	}

	/** R4 #220 — Get all defined life epochs. */
	async getEpochs(): Promise<import("./types.js").Epoch[]> {
	        if ("getEpochs" in this.adapter) {
	                return (this.adapter as any).getEpochs();
	        }
	        return [];
	}

	// ─── Lifecycle ────────────────────────────────────────────────────────

	/** R2.5 v2 — Bi-temporal recall: memories valid at T. */
	async recallWithHistory(
	        query: string,
	        atTimestamp: number,
	        opts: RecallContext = {},
	): Promise<{ facts: Fact[]; episodes: Episode[] }> {
	        return this.recall(query, { ...opts, mode: "at-time", atTimestamp });
	}

	/** Run a decay cycle. Returns number of facts archived/weakened. */
	async applyDecay(): Promise<number> {
	        return this.adapter.semantic.decay(Date.now());
	}

	async close(): Promise<void> {		this.stopConsolidation();
		this.spikeHandlers = [];
		this.activeContext = null;
		this.recallHistory = [];
		await this.adapter.close();
	}
}

function truncateForRecap(s: string, max: number): string {
	const trimmed = s.trim().replace(/\s+/g, " ");
	if (trimmed.length <= max) return trimmed;
	return `${trimmed.slice(0, max - 1)}…`;
}

/**
 * Build the deterministic recap used when no summarizer is injected, and
 * as the fallback seed passed to an injected summarizer.
 */
function buildDeterministicRecap(
	msgs: readonly { role: string; content: string; timestamp?: number }[],
	keepTail: number,
): string {
	let userCount = 0;
	let assistantCount = 0;
	let toolCount = 0;
	const topics = new Set<string>();
	for (const m of msgs) {
		if (m.role === "user") userCount++;
		else if (m.role === "assistant") assistantCount++;
		else if (m.role === "tool") toolCount++;
		for (const match of m.content.matchAll(/\b[A-Z][\w-]{2,}\b/g)) {
			topics.add(match[0]);
			if (topics.size >= 8) break;
		}
	}

	const first = msgs[0];
	const last = msgs[msgs.length - 1];

	const lines: string[] = [
		`[Conversation recap — ${msgs.length} earlier messages compacted]`,
		`Turns: ${userCount} user · ${assistantCount} assistant · ${toolCount} tool`,
	];
	if (topics.size > 0) {
		lines.push(`Topics mentioned: ${Array.from(topics).join(", ")}`);
	}
	if (first) lines.push(`Started with: "${truncateForRecap(first.content, 120)}"`);
	if (last && last !== first) {
		lines.push(`Most recent before recap: "${truncateForRecap(last.content, 120)}"`);
	}
	lines.push(`(Follow-up context continues in the ${keepTail} messages after this recap.)`);

	return lines.join("\n");
}

/** Rolling summary internal shape (lives in memory, not persisted). */
interface RollingSummary {
	sessionId: string;
	started: number;
	updated: number;
	/** Raw recent messages up to `rollingHeadroom`. */
	recent: { role: string; content: string; timestamp: number }[];
	/** Compressed stem — stats + quotes from evicted older messages. */
	compressed: string;
	userCount: number;
	assistantCount: number;
	toolCount: number;
	/** LRU topic → last-seen timestamp. Map preserves insertion order so
	 *  the oldest entry is evicted when the cap is reached. */
	topics: Map<string, number>;
	firstUser?: string;
}

/** Serializable snapshot of a RollingSummary. */
export interface RollingSummarySnapshot {
	sessionId: string;
	started: number;
	updated: number;
	recent: readonly { role: string; content: string; timestamp: number }[];
	compressed: string;
	userCount: number;
	assistantCount: number;
	toolCount: number;
	topics: readonly string[];
	firstUser?: string;
}

function compressEvictedMessages(
	msgs: readonly { role: string; content: string; timestamp: number }[],
): string {
	const userCount = msgs.filter((m) => m.role === "user").length;
	const assistantCount = msgs.filter((m) => m.role === "assistant").length;
	const toolCount = msgs.filter((m) => m.role === "tool").length;
	const first = msgs[0];
	const last = msgs[msgs.length - 1];
	const lines: string[] = [
		`[evicted ${msgs.length}: ${userCount}u/${assistantCount}a/${toolCount}t]`,
	];
	if (first) lines.push(`  first: "${truncateForRecap(first.content, 80)}"`);
	if (last && last !== first) lines.push(`  last: "${truncateForRecap(last.content, 80)}"`);
	return lines.join("\n");
}

/**
 * v3 structured 5-section markdown sections (opencode/openclaw pattern,
 * Slice 3-XR-Compact #47 §6.1). Appended after the legacy header line so
 * existing assertions ("[Conversation recap …]") survive.
 *
 * Sections (omitted when empty):
 * - `## Prior recap (anchored)` — when `priorRecap` provided (Factory.ai
 *   anchored iterative pattern — Q7 lock).
 * - `## Goal` — first user message (intent).
 * - `## Instructions` — system-role messages in the window.
 * - `## Tool calls made` — distinct tool messages (Microsoft pattern via
 *   caller-side preprocessing; we list names/targets here).
 * - `## Discoveries` — fact-shaped assistant lines (heuristic).
 * - `## Relevant files / URLs` — strict-preserve identifiers (paths, URLs).
 */
function buildStructuredSections(
	msgs: readonly { role: string; content: string; timestamp?: number }[],
	priorRecap?: { role: string; content: string; timestamp?: number },
): string {
	const sections: string[] = [];

	if (priorRecap && priorRecap.content.trim().length > 0) {
		sections.push("## Prior recap (anchored)", priorRecap.content.trim());
	}

	const firstUser = msgs.find((m) => m.role === "user");
	if (firstUser) {
		sections.push("## Goal", truncateForRecap(firstUser.content, 240));
	}

	const systemMsgs = msgs.filter((m) => m.role === "system");
	if (systemMsgs.length > 0) {
		const lines = ["## Instructions"];
		for (const sm of systemMsgs.slice(0, 3)) {
			lines.push(`- ${truncateForRecap(sm.content, 160)}`);
		}
		sections.push(lines.join("\n"));
	}

	const toolMsgs = msgs.filter((m) => m.role === "tool");
	if (toolMsgs.length > 0) {
		const lines = ["## Tool calls made"];
		const seen = new Set<string>();
		let shown = 0;
		for (const tm of toolMsgs) {
			const key = truncateForRecap(tm.content, 80);
			if (seen.has(key)) continue;
			seen.add(key);
			lines.push(`- ${truncateForRecap(tm.content, 120)}`);
			shown++;
			if (shown >= 10) {
				if (toolMsgs.length > shown) {
					lines.push(`- … (${toolMsgs.length - shown} more tool messages)`);
				}
				break;
			}
		}
		sections.push(lines.join("\n"));
	}

	const assistantMsgs = msgs.filter((m) => m.role === "assistant");
	if (assistantMsgs.length > 0) {
		const lines = ["## Discoveries"];
		let added = 0;
		outer: for (const am of assistantMsgs) {
			const factLines = am.content
				.split("\n")
				.map((l) => l.trim())
				.filter((l) => l.length >= 40 && l.length <= 200);
			for (const line of factLines.slice(0, 2)) {
				lines.push(`- ${line}`);
				added++;
				if (added >= 5) break outer;
			}
		}
		if (added > 0) {
			sections.push(lines.join("\n"));
		}
	}

	// Identifier strict-preserve: file-path-like + URLs verbatim. Used as
	// "## Relevant files / URLs" — recall pin for later reference.
	const pathRe = /(?:^|\s|`)([/\w][\w./\-]*\.[a-z]{1,6})(?=\s|`|$|[,.;:!?])/gim;
	const urlRe = /https?:\/\/[^\s)`'"<>]+/g;
	const files = new Set<string>();
	for (const m of msgs) {
		for (const match of m.content.matchAll(pathRe)) {
			const p = match[1];
			if (p && p.length >= 3) files.add(p);
			if (files.size >= 15) break;
		}
		if (files.size >= 15) break;
		for (const match of m.content.matchAll(urlRe)) {
			files.add(match[0]);
			if (files.size >= 15) break;
		}
		if (files.size >= 15) break;
	}
	if (files.size > 0) {
		const lines = ["## Relevant files / URLs"];
		for (const f of [...files].slice(0, 15)) {
			lines.push(`- \`${f}\``);
		}
		sections.push(lines.join("\n"));
	}

	return sections.join("\n\n");
}

function buildRecapFromRollingSummary(
	rs: RollingSummary,
	windowSize: number,
	keepTail: number,
): string {
	const lines: string[] = [
		`[Conversation recap (rolling) — ${windowSize} messages in the caller's compaction window]`,
		`Session turns tracked so far: ${rs.userCount} user · ${rs.assistantCount} assistant · ${rs.toolCount} tool`,
	];
	if (rs.topics.size > 0) {
		lines.push(`Topics: ${Array.from(rs.topics.keys()).join(", ")}`);
	}
	if (rs.firstUser) lines.push(`Session started with: "${rs.firstUser}"`);
	if (rs.compressed) lines.push(`Earlier: ${rs.compressed}`);
	lines.push(`(Follow-up context continues in the ${keepTail} messages after this recap.)`);
	return lines.join("\n");
}

/** Host-supplied summarizer. Receives the original messages plus the
 *  deterministic recap seed and returns either a plain polished summary
 *  string (simple shape) or a structured result that can additionally
 *  declare `realtime: true` when the summary was already precomputed
 *  (e.g. from a rolling summary maintained during encode()). */
export type CompactionSummarizer = (input: {
	messages: readonly { role: string; content: string; timestamp?: number }[];
	keepTail: number;
	targetTokens: number;
	sessionId?: string;
	seedSummary: string;
	signal?: AbortSignal;
}) => Promise<string | CompactionSummarizerResult>;

export interface CompactionSummarizerResult {
	content: string;
	/** Mark true when the summary was precomputed/cached (no fresh LLM call). */
	realtime?: boolean;
}

// 8G tier lightweight MemoryProvider (naia-agent#41) — public API so hosts
// (naia-agent) can inject it. Faithful MemoryProvider impl (anchor #1).
export { LiteMemoryProvider } from "./lite-provider.js";
export type { LiteMemoryProviderOptions } from "./lite-provider.js";
