/**
 * Naia Memory System — Type definitions
 *
 * 4-store architecture inspired by Tulving's memory taxonomy + CLS theory:
 * - Episodic (Hippocampus): timestamped events with context
 * - Semantic (Neocortex): facts, entities, relationships
 * - Procedural (Basal Ganglia): skills, learned strategies
 * - Working Memory managed by ContextManager (#65)
 */

// ─── Importance Scoring (Amygdala) ───────────────────────────────────────────

/** 3-axis importance score inspired by CraniMem (2025) */
export interface ImportanceScore {
	/** How relevant to user's current goals (0.0–1.0) */
	importance: number;
	/** How unexpected/novel this information is (0.0–1.0) */
	surprise: number;
	/** User's emotional valence detected (0.0–1.0, where 0.5 = neutral) */
	emotion: number;
	/** Combined utility score */
	utility: number;
}

/** Input to the importance scoring function */
export interface MemoryInput {
        content: string;
        role: "user" | "assistant" | "tool";
        /** Current conversation context for scoring */
        context?: string;
        /** Optional override for timestamp (used in benchmarks) */
        timestamp?: number;
}

/** R4 #220 — Life epoch representing a significant time period or milestone. */
export interface Epoch {
        id: string;
        name: string;
        /** Description of this period (e.g., 'Before moving to Seoul') */
        description?: string;
        /** ms unix timestamp when this period started */
        start: number;
        /** ms unix timestamp when this period ended (null for ongoing) */
        end: number | null;
        /** Source episode ID that defined this epoch */
        sourceEpisodeId?: string;
}

// ─── Episodic Memory (Hippocampus) ───────────────────────────────────────────
/** A single episode — a timestamped event with full context */
export interface Episode extends Record<string, unknown> {
	id: string;
	/** The content of the episode */
	content: string;
	/** Speaker role */
	role?: "user" | "assistant" | "tool";
	/** Summary for retrieval (shorter than content) */
	summary: string;
	/** When this happened */
	timestamp: number;
	/** Importance score at time of encoding */
	importance: ImportanceScore;
	/** Context at encoding (for encoding specificity principle) */
	encodingContext: EncodingContext;
	/** Has this episode been consolidated into semantic memory? */
	consolidated: boolean;
	/** Number of times this episode has been recalled */
	recallCount: number;
	/** Last time this episode was accessed */
	lastAccessed: number;
	/** Current memory strength (Ebbinghaus decay applied) */
	strength: number;
	/** Lifecycle status — R3 보존 우선 (사용자 directive 2026-05-08).
	 *  decay 가 strength 약화 시 'archived' 로 변경, splice X.
	 *  default search 에서 hide. */
	status?: "active" | "archived";
}

/** Context captured at the time of memory encoding (Tulving's encoding specificity) */
export interface EncodingContext {
	/** What project/workspace was active. R5 #28: hard partition key —
	 *  recall 시 strict mode 면 해당 project 의 fact 만 노출. */
	project?: string;
	/** What file was being discussed */
	activeFile?: string;
	/** What task was being worked on */
	taskDescription?: string;
	/** Session identifier */
	sessionId?: string;
	/** R5 #28 — privacy / topic category for irrelevant isolation.
	 *  encode 시점 fact 의 카테고리 추론 (예: "personal" / "work" /
	 *  "tech"). recall 시점 query 의 intent 와 mismatch 일 때 score
	 *  penalty 적용. heuristic 또는 LLM 으로 추론, default null. */
	category?: string;
}

/** Context used when recalling episodes */
export interface RecallContext {
	/** Current project for context-dependent retrieval */
	project?: string;
	/** Current file being discussed */
	activeFile?: string;
	/** Max number of episodes to return */
	topK?: number;
	/** Minimum strength threshold */
	minStrength?: number;
	/**
	 * Deep recall mode — search long-term memory ignoring decay.
	 * Triggered when user explicitly asks about forgotten memories
	 * ("왜 잊었어?", "예전에 뭐라고 했었지?").
	 * Uses pure vector similarity without strength weighting.
	 */
	deepRecall?: boolean;
	/**
	 * R2.5 v2 — recall mode for chain + bi-temporal facts.
	 *  - 'latest' (default): only currently active facts (status==='active'
	 *    and validTo===null/undefined). Backward compat with R2.5 v1.
	 *  - 'history': include superseded chain (active + superseded). Caller
	 *    can traverse `supersedes` / `successorId` for chain order.
	 *  - 'at-time': fact versions valid at `atTimestamp` — pre-existing
	 *    bi-temporal recall (uses `factsValidAtTime`).
	 *
	 * 사용자 directive (2026-05-08): 시간 연관 회상 + 장기기억 보존.
	 * latest 가 default — 자연어 의도 파악 ("history 보여줘") 은 naia-agent.
	 */
	mode?: "latest" | "history" | "at-time";
	/** Bi-temporal anchor for `mode: 'at-time'`. ms unix timestamp. */
	atTimestamp?: number;
	/** R4 #220 — Epoch-based anchor (e.g., '이사 전', '대학 시절').
	 *  If provided, the system resolves this to a time range via KnowledgeGraph. */
	epochAnchor?: string;
	/**
	 * R5 #28 — Privacy: project scope hard partition.	 *
	 *  - 'strict' (권장 for production): 해당 project 의 fact 만 노출.
	 *    cross-project 조회 시 explicit \`crossProject: true\` 필요.
	 *  - 'soft' (default): 기존 동작 — project 명시 시 우선, 미명시 시
	 *    cross-project 도 노출 (backward compat).
	 *
	 *  사용자 directive (2026-05-08): cross-project leak 의 진짜 위험은
	 *  naia-agent LLM 발화. naia-memory 측 hard partition 으로 *데이터
	 *  level* 차단 + naia-agent 의 source-monitor + pragmatic-gate 와 결합.
	 */
	scopeMode?: "strict" | "soft";
	/** R5 #28 — explicit cross-project recall (scopeMode='strict' 시 필요). */
	crossProject?: boolean;
	/** R5 #28 — query intent category. fact.category 와 mismatch 시
	 *  penalty 적용. heuristic 또는 caller-injected. */
	queryIntent?: string;
	/**
	 * #27 Retrieval ranking 강화 — HyDE (Hypothetical Document Embedding).
	 *
	 * Caller (naia-agent) 가 query 받은 후 LLM 으로 *가상의 답변* 생성하여
	 * 여기에 주입. naia-memory 는 query 대신 (또는 함께) `queryHint` 로
	 * embedding 검색. paraphrase 의미 매칭 정확도 ↑.
	 *
	 * 책임 분리: naia-memory 가 LLM 호출 X, caller (naia-agent) 책임.
	 * 사용자 directive A08 (Background/Active brain 분리) 정합.
	 *
	 * 예: query="내 직업?" + queryHint="사용자 직업: 소프트웨어 엔지니어"
	 *  → embedding 시 queryHint 사용 → fact "사용자 직업: 디자이너" 와
	 *  cosine 더 높음 (둘 다 \"직업\" attribute key).
	 *
	 * 미설정 시 query 그대로 embedding (현재 동작).
	 */
	queryHint?: string;
	/**
	 * #27 Retrieval ranking 강화 — minimum confidence threshold.
	 *
	 * Filters out facts with *adapter-internal final score* < this. Score
	 * distribution differs by searchMode:
	 *   - vector-only (high-dim embedder): typical range 0~1.3, recommended
	 *     0.5-0.7 (cosine-like).
	 *   - rrf (default): typical range 0.001~0.03 (RRF formula), recommended
	 *     0.005-0.015. **0.6 will exclude everything.**
	 *
	 * Adversarial review (2026-05-08): score is composite (relevance×0.7 +
	 * strength×0.3 in normal mode), not raw cosine. Future #27 step
	 * (cross-encoder) will replace this with calibrated 0-1 confidence —
	 * minConfidence semantic will then be cosine-like.
	 *
	 * deepRecall=true 와 결합 시 cutoff 를 0.5 배 — \"오래된 기억 회상\"
	 * 의도와 충돌 회피.
	 *
	 * Default 0 (no threshold). Companion to #9 abstention: caller
	 * (naia-agent) abstains when result is empty.
	 *
	 * 사용자 directive A09 — preservation-first 의 짝, mem0 \"97.8% junk\"
	 * 회피.
	 */
	minConfidence?: number;
}

// ─── Semantic Memory (Neocortex) ─────────────────────────────────────────────

/** A semantic fact — general knowledge extracted from episodes */
export interface Fact extends Record<string, unknown> {
	id: string;
	/** The fact content */
	content: string;
	/** Extracted entities (people, tools, concepts) */
	entities: string[];
	/** Topic categories */
	topics: string[];
	/** When first created */
	createdAt: number;
	/** When last updated (reconsolidation) */
	updatedAt: number;
	/** Base importance (set at creation, modifiable) */
	importance: number;
	/** Number of times retrieved */
	recallCount: number;
	/** Last accessed timestamp */
	lastAccessed: number;
	/** Current strength (Ebbinghaus decay) */
	strength: number;
	/** R4 #220 — Highest emotional valence recorded for this fact.
	 *  Used for non-linear Flashbulb Memory gating. */
	maxEmotion?: number;
	/** Lifecycle status — superseded facts are hidden from default search */
	status: "active" | "superseded" | "archived";	/** R2.5 v2 chain — predecessor fact id (chain backward).
	 *  Set when this fact replaces an older one on the same attribute.
	 *  Older fact's `successorId` should point back here. */
	supersedes?: string | null;
	/** R2.5 v2 chain — successor fact id (chain forward).
	 *  Set when a newer fact has replaced this one. Allows
	 *  history-mode recall to traverse the chain. */
	successorId?: string | null;
	/** R2.5 v2 — bi-temporal validity start (defaults to createdAt).
	 *  Fact is "active" between validFrom and validTo. */
	validFrom?: number;
	/** R2.5 v2 — bi-temporal validity end. `null` means currently active.
	 *  Set to the supersede timestamp when a successor takes over.
	 *  *Data preservation guarantee*: validTo replaces hard delete; the
	 *  fact record itself is never spliced from the store. */
	validTo?: number | null;
	/** Source episode IDs that contributed to this fact */
	sourceEpisodes: string[];
	/** Cosine similarity score from vector search (0.0–1.0, optional) */
	relevanceScore?: number;
	/** Encoding context inherited from source episodes — used for project-scoped retrieval */
	encodingContext?: EncodingContext;
}

// ─── Procedural Memory (Basal Ganglia / Cerebellum) ──────────────────────────

/** A learned skill/strategy from experience */
export interface Skill extends Record<string, unknown> {
	id: string;
	/** Skill name / identifier */
	name: string;
	/** What this skill does */
	description: string;
	/** When was the strategy learned */
	learnedAt: number;
	/** How many times successfully applied */
	successCount: number;
	/** How many times it failed */
	failureCount: number;
	/** Current confidence (success / (success + failure)) */
	confidence: number;
}

/** A self-reflection from a failure (Reflexion pattern) */
export interface Reflection extends Record<string, unknown> {
	/** What task was attempted */
	task: string;
	/** What went wrong */
	failure: string;
	/** Self-critique: why it failed */
	analysis: string;
	/** What to do differently next time */
	correction: string;
	/** When this reflection was created */
	timestamp: number;
}

// ─── Consolidation ──────────────────────────────────────────────────────────

/** Result of a consolidation cycle (sleep cycle analog) */
export interface ConsolidationResult {
        /** Number of episodes processed */
        episodesProcessed: number;
        /** Number of new facts extracted */
        factsCreated: number;
        /** Number of existing facts updated (reconsolidated) */
        factsUpdated: number;
        /** R4 #220 — Number of high-level insights distilled */
        insightsCreated?: number;
        /** Number of weak memories pruned (below decay threshold) */
        memoriesPruned: number;
        /** Associations strengthened */
        associationsUpdated: number;
}
// ─── Memory Adapter Interface ───────────────────────────────────────────────

/**
 * Abstract memory adapter — gateway-independent.
 *
 * LocalAdapter (JSON file) is always functional.
 * Future adapters (cloud, distributed) can be added without changing consumers.
 */
export interface MemoryAdapter {
	/** Episodic memory operations (Hippocampus) */
	episode: {
		/** Store a new episode */
		store(event: Episode): Promise<void>;
		/** Recall episodes matching query + context (encoding specificity) */
		recall(query: string, context: RecallContext): Promise<Episode[]>;
		/** Get N most recent episodes */
		getRecent(n: number): Promise<Episode[]>;
		/** Get unconsolidated episodes for background processing */
		getUnconsolidated(): Promise<Episode[]>;
		/** Mark episodes as consolidated */
		markConsolidated(ids: string[]): Promise<void>;
	};

	/** Semantic memory operations (Neocortex) */
	semantic: {
		/** Insert or update a fact (includes reconsolidation logic) */
		upsert(fact: Fact): Promise<void>;
		/** Search facts by query string. deepRecall ignores decay for long-term retrieval.
		 *  context.atTimestamp (optional, ms): bi-temporal recall — only fact versions valid
		 *  at the given timestamp are considered. Adapters without bi-temporal support may
		 *  ignore this option (degrades to standard search). */
		search(query: string, topK: number, deepRecall?: boolean, context?: { project?: string; atTimestamp?: number; mode?: "latest" | "history" | "at-time"; minConfidence?: number; queryHint?: string; scopeMode?: "strict" | "soft"; crossProject?: boolean; epochAnchor?: string }): Promise<Fact[]>;
		/** Run Ebbinghaus decay sweep, returns number of pruned memories */
		decay(now: number): Promise<number>;
		/** Strengthen association between two entities (Hebbian) */
		associate(entityA: string, entityB: string, weight?: number): Promise<void>;
		/** Get all facts (for full consolidation) */
		getAll(): Promise<Fact[]>;
		/** Delete a fact by ID. Returns true if found and deleted. */
		delete(id: string): Promise<boolean>;
	};

	/** Procedural memory operations (Basal Ganglia) */
	procedural: {
		/** Get a learned skill by name */
		getSkill(name: string): Promise<Skill | null>;
		/** Record a skill usage result */
		recordOutcome(name: string, success: boolean): Promise<void>;
		/** Store a self-reflection from a failure (Reflexion pattern) */
		learnFromFailure(reflection: Reflection): Promise<void>;
		/** Get reflections relevant to a task */
		getReflections(task: string, topK: number): Promise<Reflection[]>;
	};

	/** Run a full consolidation cycle (sleep cycle analog) */
	consolidate(): Promise<ConsolidationResult>;

	/** Close the adapter and release resources */
	close(): Promise<void>;
}

// ─── Backup ──────────────────────────────────────────────────────────────────

/**
 * BackupCapable — implemented by adapters that support AES-256-GCM export/import.
 *
 * Blob layout (49-byte fixed header):
 *   4 bytes  magic    "NAIA"
 *   1 byte   version  0x01
 *   16 bytes salt     (PBKDF2 input)
 *   12 bytes iv       (AES-GCM nonce)
 *   16 bytes authTag  (AES-GCM authentication tag)
 *   N bytes  ciphertext
 *
 * Key derivation: PBKDF2-SHA256, 200_000 iterations, 32-byte key.
 */
export interface BackupCapable {
	/**
	 * Export all memory as an AES-256-GCM encrypted blob.
	 * @param password  User-supplied passphrase (never stored)
	 * @returns         Encrypted blob as Uint8Array
	 */
	export(password: string): Promise<Uint8Array>;

	/**
	 * Import memory from an encrypted blob created by export().
	 * Replaces current memory entirely after successful decryption.
	 * @param blob      Encrypted blob from export()
	 * @param password  User-supplied passphrase
	 * @throws          If decryption fails, JSON is invalid, or schema mismatch
	 */
	import(blob: Uint8Array, password: string): Promise<void>;
}
