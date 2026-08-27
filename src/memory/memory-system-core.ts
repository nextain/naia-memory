import crypto, { randomUUID } from "node:crypto";
import { LocalAdapter } from "./adapters/local.js";
import { QdrantAdapter } from "./adapters/qdrant.js";
import { scoreImportance } from "./importance.js";
import {
	selectFilter,
	HeuristicContradictionFilter,
} from "./contradiction-filter.js";
import { filterNegativeCapture } from "./negative-capture.js";
import {
	findContradictions,
	findContradictionsWith,
} from "./reconsolidation.js";
import { allocateBudget } from "./context-budget.js";
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
} from "./types.js";
import type { ContradictionFilterProvider } from "./contradiction-filter.js";
import {
	deterministicEpisodeId,
	heuristicFactExtractor,
	type DeleteVerifier,
	type ExtractedFact,
	type FactExtractor,
	type MemorySystemOptions,
} from "./memory-system-api.js";
import {
	contentTokens,
	getMemoryAlgorithm,
	jaccardSimilarity,
	MAX_EPISODES_PER_CYCLE,
} from "./consolidation-primitives.js";
import {
	type CompactionSummarizer,
	type RollingSummary,
} from "./compaction-helpers.js";

export abstract class MemorySystemCore {
	protected readonly adapter: MemoryAdapter;
	private readonly _initPromise: Promise<void>;
	protected readonly factExtractor: FactExtractor;
	protected readonly deleteVerifier?: DeleteVerifier;
	protected readonly contradictionFilter: ContradictionFilterProvider;
	/** Phase B-γ A/B toggle. When true, encode() bypasses scoreImportance()
	 *  and uses a neutral max-utility score so importance gating has no
	 *  effect on retrieval ranking or decay. Default false. */
	private readonly disableImportanceGating: boolean;
	protected _isConsolidating = false;
	/** R4 #26 — Background brain spike subscribers. naia-agent 가 on('spike')
	 *  으로 등록. emit 시점은 consolidate / decay / fact upsert 등 (R4 Step 3+). */
	protected spikeHandlers: Array<
		(
			event: import("./spike.js").SpikeEvent,
		) => Promise<import("./spike.js").SpikeAction | void>
	> = [];
	/** R4 #26 — Active context (naia-agent → naia-memory).
	 *  spike rule 평가 시 사용. cross-project leak 방지 (anchor §A10). */
	protected activeContext: import("./spike.js").ActiveContext | null = null;
	/** R4 #26 Step 3c — Recent recall query history (ring buffer, max 100).
	 *  *0 result* query 가 *recall failure*. 새 fact 추출 시 history 매칭 시
	 *  emit reason='recall-failure-resolved'. naia-agent 통합 후 daily 사용
	 *  시 사용자가 자주 묻던 fact 가 새로 알려진 시점 신호. */
	protected recallHistory: Array<{
		query: string;
		resultCount: number;
		ts: number;
	}> = [];
	private static readonly RECALL_HISTORY_MAX = 100;

	/**
	 * Rolling summaries keyed by sessionId. Incrementally built by
	 * `encode()` so `compact()` can return a precomputed digest (and flag
	 * `realtime: true`). Survives for the lifetime of the MemorySystem.
	 * Not persisted by default — host can call `snapshotRollingSummaries()`
	 * if durability is needed.
	 */
	protected readonly rollingSummaries = new Map<string, RollingSummary>();
	/** Max messages tracked per rolling summary; older entries are folded
	 *  into `compressed`. Prevents unbounded growth on long sessions. */
	protected readonly rollingHeadroom: number;
	/** Max characters allowed in `compressed` stem. Older compressed
	 *  fragments are truncated from the front when exceeded. */
	protected readonly rollingCompressedMax: number;
	/** Max topic entries tracked per session. Uses LRU-recency eviction. */
	protected readonly rollingTopicCap: number;
	protected readonly summarizer?: CompactionSummarizer;

	protected abstract updateRollingSummary(
		input: MemoryInput,
		context: EncodingContext,
	): void;
	protected abstract emitSpike(
		event: import("./spike.js").SpikeEvent,
	): Promise<void>;
	protected abstract detectEmotionAnniversaries(now: number): Promise<void>;
	protected abstract detectTemporalAnchors(now: number): Promise<void>;
	protected abstract matchesActiveContextFact(fact: Fact): boolean;
	protected abstract matchesActiveContext(fact: Fact): boolean;

	constructor(options: MemorySystemOptions) {
		this.factExtractor = options.factExtractor ?? heuristicFactExtractor;
		this.deleteVerifier = options.deleteVerifier;
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
		this.rollingCompressedMax =
			options.rollingSummaryOptions?.compressedMax ?? 4000;
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
	async encode(input: MemoryInput, context: EncodingContext): Promise<Episode> {
		// Phase B-γ A/B measurement toggle. When importance gating is
		// disabled we neutralize the 3-axis score (utility=1.0) so all
		// episodes carry equal weight through ranking, decay, and fact
		// extraction. The scoreImportance() function itself is unchanged.
		let score = this.disableImportanceGating
			? { importance: 1.0, surprise: 0.0, emotion: 0.5, utility: 1.0 }
			: scoreImportance(input);

		// First-class REACTION signal: a caller-supplied emotion(=VALENCE 0..1, 0.5
		// neutral) / importance overrides the keyword heuristic. NOTE: emotion is
		// VALENCE, not intensity — arousal (= |emotion-0.5|*2) is the "how strongly
		// reacted-to" that drives utility; flashbulb (maxEmotion>=0.8) fires on
		// positive valence only (a known naia-memory limitation — strong NEGATIVE
		// reactions boost utility but not flashbulb). Guard with Number.isFinite so
		// null/NaN (trivial from JSON) is treated as NO signal, not max-arousal.
		if (Number.isFinite(input.emotion) || Number.isFinite(input.importance)) {
			const clamp = (n: number) => Math.max(0, Math.min(1, n));
			const emotion = Number.isFinite(input.emotion)
				? clamp(input.emotion as number)
				: score.emotion;
			const importance = Number.isFinite(input.importance)
				? clamp(input.importance as number)
				: score.importance;
			const arousal = Math.abs(emotion - 0.5) * 2;
			// Preserve the disableImportanceGating equal-weight invariant (utility=1.0);
			// otherwise recompute utility with the importance.ts formula.
			const utility = this.disableImportanceGating
				? 1.0
				: Math.min(1, importance * 0.5 + score.surprise * 0.2 + arousal * 0.3);
			score = { importance, surprise: score.surprise, emotion, utility };
		}

		const now = input.timestamp ?? Date.now();
		const episodeId = input.idempotencyKey
			? deterministicEpisodeId(input.idempotencyKey, input.role, context)
			: randomUUID();
		const episode: Episode = {
			id: episodeId,
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

		// Do not mutate semantic facts from the raw episode text here. At encode
		// time no explicit subject/property/cardinality assertion exists, so a
		// lexical contradiction guess can bypass the conservative consolidation
		// policy (notably for negated or multi-valued statements). Consolidation
		// remains the single write-time reconciliation point.

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
		const candidates = await this.adapter.semantic.search(newInfo, 10, false, {
			project,
			minConfidence: 0,
		});
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
				structuredQuery: context.structuredQuery,
				scopeMode: context.scopeMode,
				crossProject: context.crossProject,
				epochAnchor: context.epochAnchor,
			}),
			this.adapter.procedural.getReflections(query, topK),
		]);

		// R4 Step 3c — recall history ring buffer.
		this.recallHistory.push({
			query,
			resultCount: facts.length,
			ts: Date.now(),
		});
		if (this.recallHistory.length > MemorySystemCore.RECALL_HISTORY_MAX) {
			this.recallHistory.shift();
		}

		return { episodes, facts, reflections };
	}

	/** R4 Step 3c — recall-failure-resolved detection.
	 *  새 fact 가 추출됐는데, *최근 fail recall* (resultCount=0) 의 query
	 *  와 매칭 시 emit. naia-agent 통합 후 \"사용자가 자주 묻던 거 이제 알아\"
	 *  signal. */
	protected async checkRecallFailureResolved(
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
	protected async checkRepeatedFailResolved(
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
}
