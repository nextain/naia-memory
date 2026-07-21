/**
 * LocalAdapter — JSON file-backed MemoryAdapter implementation.
 *
 * Always functional, no external dependencies.
 * Uses atomic write (write-to-temp + rename) for crash safety.
 * Suitable for desktop companion use — the data volume is manageable in JSON.
 *
 * Future: can be swapped to SQLite (better-sqlite3) if query performance
 * becomes a bottleneck. For now, simplicity wins (ChatGPT Memory approach).
 */

import {
	createCipheriv,
	createDecipheriv,
	pbkdf2,
	randomBytes,
	randomUUID,
} from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { calculateStrength, shouldPrune } from "../decay.js";
import type { EmbeddingProvider } from "../embeddings.js";
import { tokenize as koTokenize } from "../ko-normalize.js";
import {
	type KGState,
	KnowledgeGraph,
	emptyKGState,
} from "../knowledge-graph.js";
import type {
	BackupCapable,
	ConsolidationResult,
	Episode,
	Fact,
	MemoryAdapter,
	RecallContext,
	Reflection,
	Skill,
} from "../types.js";

const pbkdf2Async = promisify(pbkdf2);

/** On-disk schema for JSON persistence */
interface MemoryStore {
        version: 1;
        episodes: Episode[];
        facts: Fact[];
        /** R4 #220 — Life epochs for temporal anchoring */
        epochs?: import("../types.js").Epoch[];
        skills: Skill[];	reflections: Reflection[];
	/** Hebbian association weights: "entityA::entityB" → weight */
	associations: Record<string, number>;
	/** Knowledge graph state (Phase 2) */
	knowledgeGraph?: KGState;
	/** Vector embeddings: id → float[] (optional, populated when EmbeddingProvider is set) */
	factEmbeddings?: Record<string, number[]>;
	episodeEmbeddings?: Record<string, number[]>;
}

function emptyStore(): MemoryStore {
	return {
		version: 1,
		episodes: [],
		facts: [],
		skills: [],
		reflections: [],
		associations: {},
		factEmbeddings: {},
		episodeEmbeddings: {},
	};
}

/** Cosine similarity between two equal-length vectors.
 * Returns 0 for degenerate inputs (zero vectors, NaN, mismatched dims).
 */
function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length || a.length === 0) return 0;
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	if (!isFinite(denom) || denom === 0) return 0;
	const sim = dot / denom;
	return isNaN(sim) ? 0 : sim;
}

/** LocalAdapter constructor options */
export interface LocalAdapterOptions {
	/** Path to the JSON store file (default: ~/.naia/memory/naia-memory.json) */
	storePath?: string;
	/** Optional embedding provider for vector search.
	 *  When set, facts and episodes are embedded on write and retrieved by cosine similarity.
	 *  When absent, falls back to keyword search. */
	embeddingProvider?: EmbeddingProvider;
	/** Cosine similarity threshold for filtering noise (default: 0.7).
	 *  Higher values reduce hallucinations but may skip relevant context. */
	similarityThreshold?: number;
	/** Phase B-γ A/B measurement toggle — when true, the knowledge-graph
	 *  spreading-activation step is skipped during `semantic.search()` so
	 *  ranking falls back to vector cosine + BM25 only.
	 *  Default false (current production behaviour).
	 *
	 *  Preservation-first: this option does NOT delete KG entities or
	 *  associations. `upsert()` still calls `kg.touchNode()` /
	 *  `kg.strengthen()` so the graph keeps building during a no-KG run.
	 *  Only the lookup-side spreading propagation is bypassed, allowing a
	 *  clean spreading ON vs OFF measurement on AI Hub 141. */
	disableKGSpreading?: boolean;
	/** #27 Step 3 — Cross-encoder reranker (optional).
	 *  When set, search 의 final ranking 후 (cosine + BM25 + KG + MMR
	 *  + threshold 모두 적용 후) reranker 가 query-fact relevance 를
	 *  재평가. naia 의 진짜 ranking 강화 path.
	 *
	 *  caller (naia-agent) 가 인스턴스 주입 (책임 분리, anchor §A08).
	 *  미설정 시 reranker 미적용 (backward compat).
	 *
	 *  권장: BGE-reranker-v2-m3 (transformers.js, multilingual KO).
	 */
	reranker?: import("../reranker.js").RerankerProvider;
}

/** Normalize association key (alphabetical order for consistency) */
function assocKey(a: string, b: string): string {
	const sorted = [a.toLowerCase(), b.toLowerCase()].sort();
	return `${sorted[0]}::${sorted[1]}`;
}

/** KO-aware tokenizer — uses ko-normalize for Korean text, simple split for non-Korean */
function tokenize(text: string): string[] {
	const hasKorean = /[가-힣]/.test(text);
	if (hasKorean) return koTokenize(text);
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, " ")
		.split(/\s+/)
		.filter((t) => t.length > 1);
}

class BM25 {
	private k1 = 1.2;
	private b = 0.75;
	private docTokens: Map<string, string[]> = new Map();
	private avgDl = 0;
	private N = 0;
	private df: Map<string, number> = new Map();

	index(docs: Map<string, string>): void {
		this.docTokens.clear();
		this.df.clear();
		this.N = docs.size;
		let totalLen = 0;

		for (const [id, text] of docs) {
			const tokens = tokenize(text);
			this.docTokens.set(id, tokens);
			totalLen += tokens.length;
			const seen = new Set<string>();
			for (const t of tokens) {
				if (!seen.has(t)) {
					seen.add(t);
					this.df.set(t, (this.df.get(t) ?? 0) + 1);
				}
			}
		}
		this.avgDl = this.N > 0 ? totalLen / this.N : 1;
	}

	score(query: string, docId: string): number {
		const queryTokens = tokenize(query);
		const docTokens = this.docTokens.get(docId);
		if (!docTokens || queryTokens.length === 0) return 0;

		const dl = docTokens.length;
		const tfMap = new Map<string, number>();
		for (const t of docTokens) {
			tfMap.set(t, (tfMap.get(t) ?? 0) + 1);
		}

		let total = 0;
		const docLower = docTokens.join(" ");

		for (const qt of queryTokens) {
			let tf = tfMap.get(qt) ?? 0;
			if (tf === 0) {
				const idx = docLower.indexOf(qt);
				if (idx !== -1) tf = 0.8;
			}
			if (tf === 0) continue;

			const dfVal = this.df.get(qt) ?? 0;
			const idf = Math.log(1 + (this.N - dfVal + 0.5) / (dfVal + 0.5));
			const tfNorm = (tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * dl / this.avgDl));
			total += idf * tfNorm;
		}
		return total;
	}
}

/**
 * Score relevance of a document to a query.
 * Uses substring matching as fallback for Korean particles (e.g., "TypeScript로")
 * and partial matches that exact tokenization misses.
 */
function keywordScore(query: string, document: string): number {
	const queryTokens = tokenize(query);
	const docLower = document.toLowerCase();
	const docTokens = new Set(tokenize(document));
	if (queryTokens.length === 0) return 0;

	let hits = 0;
	for (const qt of queryTokens) {
		if (docTokens.has(qt)) {
			hits++;
		} else if (docLower.includes(qt)) {
			// Substring match — handles Korean particles (TypeScript로, Cursor로)
			hits += 0.8;
		}
	}
	return hits / queryTokens.length;
}

export class LocalAdapter implements MemoryAdapter, BackupCapable {
	private store: MemoryStore;
	private readonly storePath: string;
	private dirty = false;
	private saveTimer: NodeJS.Timeout | null = null;
	private readonly SAVE_DEBOUNCE_MS = 2000;
	private kg: KnowledgeGraph;
	/** Optional vector embedding provider (null = keyword-only mode) */
	private readonly embedder: EmbeddingProvider | null;
	/** Phase B-γ A/B toggle — see LocalAdapterOptions.disableKGSpreading. */
	private readonly disableKGSpreading: boolean;
	/** #27 Step 3 — Cross-encoder reranker. null when disabled. */
	private readonly reranker: import("../reranker.js").RerankerProvider | null;
	/**
	 * In-memory embedding cache — avoids duplicate API calls for the same text.
	 * Key: text content. Value: embedding vector.
	 * Cache is intentionally unbounded (benchmark: ~1000 unique texts).
	 */
	private readonly embedCache = new Map<string, number[]>();

	constructor(options?: string | LocalAdapterOptions) {
		const storePath =
			typeof options === "string" ? options : options?.storePath;
		this.embedder =
			typeof options === "object" ? (options.embeddingProvider ?? null) : null;
		this.disableKGSpreading =
			typeof options === "object"
				? (options?.disableKGSpreading ?? false)
				: false;
		this.reranker =
			typeof options === "object" ? (options?.reranker ?? null) : null;
		this.storePath =
			storePath ?? join(homedir(), ".naia", "memory", "naia-memory.json");
		this.store = this.load();
		// Initialize knowledge graph from persisted state
		if (!this.store.knowledgeGraph) {
			this.store.knowledgeGraph = emptyKGState();
		}
		// Initialize embedding maps if missing (backward-compat with old store files)
		if (!this.store.factEmbeddings) this.store.factEmbeddings = {};
		if (!this.store.episodeEmbeddings) this.store.episodeEmbeddings = {};
		this.kg = new KnowledgeGraph(this.store.knowledgeGraph);
	}

	// ─── Bi-temporal helpers (R2.3) ───────────────────────────────────────

	/** Strip `-v{ts}` (possibly chained) suffix to recover the base fact id.
	 *  Used to group fact versions created by reconsolidation (`index.ts:715-737`).
	 */
	private static baseIdOf(id: string): string {
		return id.replace(/(-v\d+)+$/, "");
	}

	/** Return the fact versions valid at `atTimestamp` (ms).
	 *  For each baseId group, picks the latest version whose `createdAt <= atTimestamp`
	 *  and whose successor (if any) was created strictly after `atTimestamp`.
	 */
	private factsValidAtTime(atTimestamp: number): Fact[] {
	        return this.factsInTimeRange(atTimestamp, atTimestamp);
	}

	/** Return the fact versions that were active within the [start, end] range.
	 *  Bi-temporal range recall: identifies facts whose validity overlaps with the epoch.
	 */
	private factsInTimeRange(start: number, end: number | null): Fact[] {
	        const actualEnd = end ?? Date.now();
	        const groups = new Map<string, Fact[]>();
	        for (const f of this.store.facts) {
	                const base = LocalAdapter.baseIdOf(f.id);
	                const group = groups.get(base);
	                if (group) group.push(f);
	                else groups.set(base, [f]);
	        }

	        const valid: Fact[] = [];
	        for (const group of groups.values()) {
	                const sorted = [...group].sort((a, b) => b.createdAt - a.createdAt); // Latest version first
	                for (const f of sorted) {
	                        // A fact is relevant if its validity [validFrom, validTo] overlaps with [start, actualEnd]
	                        const fStart = f.validFrom ?? f.createdAt;
	                        const fEnd = f.validTo ?? Infinity;

	                        if (fStart <= actualEnd && fEnd >= start) {
	                                // Pick the most recent version that was active in this range for this group
	                                valid.push(f);
	                                break; 
	                        }
	                }
	        }
	        return valid;
	}
	// ─── Persistence ──────────────────────────────────────────────────────
	private load(): MemoryStore {
		try {
			if (existsSync(this.storePath)) {
				const raw = readFileSync(this.storePath, "utf-8");
				const parsed = JSON.parse(raw) as MemoryStore;
				if (parsed.version === 1) {
					for (const f of parsed.facts) {
						if (!f.status) f.status = "active";
					}
					return parsed;
				}
			}
		} catch {
			// Corrupted file — start fresh
		}
		return emptyStore();
	}

	private save(): void {
		if (!this.dirty) return;
		// Throttle pattern — first dirty mark schedules a flush in SAVE_DEBOUNCE_MS.
		// Subsequent calls within that window do NOT reset the timer, so we get a
		// guaranteed flush at most every SAVE_DEBOUNCE_MS even under sustained writes.
		if (this.saveTimer) return;
		this.saveTimer = setTimeout(() => {
			this.saveImmediate();
		}, this.SAVE_DEBOUNCE_MS);
	}

	saveImmediate(): void {
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		if (!this.dirty) return;
		const dir = dirname(this.storePath);
		mkdirSync(dir, { recursive: true });
		const tmpPath = `${this.storePath}.tmp`;
		writeFileSync(tmpPath, JSON.stringify(this.store, null, "\t"), "utf-8");
		renameSync(tmpPath, this.storePath);
		this.dirty = false;
	}

	async flush(): Promise<void> {
		this.saveImmediate();
	}

	/** Embed text with in-memory cache to avoid redundant API calls. */
	private async embedWithCache(text: string): Promise<number[] | null> {
		if (!this.embedder) return null;
		const cached = this.embedCache.get(text);
		if (cached) return cached;
		try {
			const vec = await this.embedder.embed(text);
			this.embedCache.set(text, vec);
			return vec;
		} catch {
			return null; // Non-fatal — keyword fallback still works
		}
	}

	private markDirty(): void {
	        this.dirty = true;
	}

	// ─── Epoch Memory (R4 #220) ───────────────────────────────────────────

	/** Register or update a life epoch (e.g., 'Before moving to Seoul'). */
	async upsertEpoch(epoch: import("../types.js").Epoch): Promise<void> {
	        if (!this.store.epochs) this.store.epochs = [];
	        const idx = this.store.epochs.findIndex((e) => e.id === epoch.id || e.name === epoch.name);
	        if (idx >= 0) {
	                this.store.epochs[idx] = epoch;
	        } else {
	                this.store.epochs.push(epoch);
	        }
	        this.markDirty();
	        this.save();
	}

	/** Get all defined life epochs. */
	getEpochs(): import("../types.js").Epoch[] {
	        return this.store.epochs ?? [];
	}

	// ─── Episodic Memory ──────────────────────────────────────────────────
	episode = {
		store: async (event: Episode): Promise<void> => {
			const existing = this.store.episodes.findIndex((episode) => episode.id === event.id);
			if (existing >= 0) this.store.episodes[existing] = event;
			else this.store.episodes.push(event);
			// Embed content if provider is available (cached to avoid redundant API calls)
			const epVec = await this.embedWithCache(event.content);
			if (epVec) this.store.episodeEmbeddings![event.id] = epVec;
			this.markDirty();
			this.save();
		},

		recall: async (
			query: string,
			context: RecallContext,
		): Promise<Episode[]> => {
			const now = Date.now();
			const topK = context.topK ?? 5;
			const minStrength = context.minStrength ?? 0.05;
			const deepRecall = context.deepRecall ?? false;

			// Vector search path: embed query and use cosine similarity
			// Vector search path: embed query and use cosine similarity
			const queryVec = await this.embedWithCache(query);

			// R5 #28 Part 2 — Episode strict scope (project hard partition).
			// fact 와 같은 logic — strict mode + cross-project 의도 명시 시만
			// cross-project episode 회상.
			const epScopeMode = (context as any)?.scopeMode ?? "soft";
			const epCrossProject = (context as any)?.crossProject ?? false;
			const epProj = context.project;
			const eligibleEpisodes =
				epScopeMode === "strict" && !epCrossProject
					? epProj
						? this.store.episodes.filter(
								(ep) => ep.encodingContext?.project === epProj,
							)
						: this.store.episodes.filter((ep) => !ep.encodingContext?.project)
					: this.store.episodes;
			const scored = eligibleEpisodes
				.map((ep) => {
					// R3 보존 우선 (Step 6 fix): archived episode 는 default recall hide.
					// deepRecall=true 시 archived 도 회상 가능 (오래된 기억 explicit 회상).
					if (!deepRecall && ep.status === "archived") return null;

					// Recalculate strength with current time
					const strength = calculateStrength(
						ep.importance.utility,
						ep.timestamp,
						ep.recallCount,
						ep.lastAccessed,
						now,
					);

					// deepRecall: skip strength filter to retrieve old memories
					if (!deepRecall && strength < minStrength) return null;

					// Relevance: vector similarity when available, else keyword
					const epVec = queryVec ? this.store.episodeEmbeddings?.[ep.id] : null;
					const textScore =
						epVec && queryVec
							? cosineSimilarity(queryVec, epVec)
							: keywordScore(query, `${ep.content} ${ep.summary}`);

					// Context bonus (encoding specificity)
					let contextBonus = 0;
					if (
						context.project &&
						ep.encodingContext.project === context.project
					) {
						contextBonus += 0.2;
					}
					if (
						context.activeFile &&
						ep.encodingContext.activeFile === context.activeFile
					) {
						contextBonus += 0.1;
					}

					// deepRecall: ignore decay in scoring
					const finalScore = deepRecall
						? textScore + contextBonus
						: textScore * strength + contextBonus;
					return { episode: ep, score: finalScore, strength };
				})
				.filter((x): x is NonNullable<typeof x> => x !== null && x.score > 0)
				.sort((a, b) => b.score - a.score)
				.slice(0, topK);

			// Update recall counts (reconsolidation: retrieval strengthens memory)
			for (const { episode } of scored) {
				episode.recallCount++;
				episode.lastAccessed = now;
				episode.strength = calculateStrength(
					episode.importance.utility,
					episode.timestamp,
					episode.recallCount,
					episode.lastAccessed,
					now,
				);
			}
			if (scored.length > 0) {
				this.markDirty();
				this.save();
			}

			return scored.map((s) => s.episode);
		},

		getRecent: async (n: number): Promise<Episode[]> => {
			// R3 보존 우선: archived episode 제외 (default getRecent 의도).
			return this.store.episodes
				.filter((ep) => ep.status !== "archived")
				.sort((a, b) => b.timestamp - a.timestamp)
				.slice(0, n);
		},

		getUnconsolidated: async (): Promise<Episode[]> => {
			return this.store.episodes.filter((ep) => !ep.consolidated);
		},

		markConsolidated: async (ids: string[]): Promise<void> => {
			const idSet = new Set(ids);
			for (const ep of this.store.episodes) {
				if (idSet.has(ep.id)) {
					ep.consolidated = true;
				}
			}
			this.markDirty();
			this.save();
		},
	};

	// ─── Semantic Memory ──────────────────────────────────────────────────

	semantic = {
		upsert: async (fact: Fact): Promise<void> => {
			const now = Date.now();
			const existing = this.store.facts.find((f) => f.id === fact.id);
			const contentChanged = !existing || existing.content !== fact.content;
			if (existing) {
				existing.content = fact.content;
				existing.entities = [
					...new Set([...existing.entities, ...fact.entities]),
				];
				existing.topics = [...new Set([...existing.topics, ...fact.topics])];
				existing.updatedAt = fact.updatedAt;
				existing.importance = Math.max(existing.importance, fact.importance);
				existing.sourceEpisodes = [
					...new Set([...existing.sourceEpisodes, ...fact.sourceEpisodes]),
				];
				existing.status = fact.status ?? existing.status;
			} else {
				this.store.facts.push(fact);
			}

			// Register entities in knowledge graph and strengthen co-occurrence edges
			const entities = existing?.entities ?? fact.entities;
			for (const entity of entities) {
				this.kg.touchNode(entity, now);
			}
			// Strengthen edges between all entity pairs in this fact (Hebbian)
			for (let i = 0; i < entities.length; i++) {
				for (let j = i + 1; j < entities.length; j++) {
					this.kg.strengthen(entities[i], entities[j], 0.05, now);
				}
			}

			// Embed fact content for vector search (only if content changed or new fact)
			// Embed fact content for vector search (only if content changed or new fact)
			if (contentChanged) {
				const fVec = await this.embedWithCache(fact.content);
				if (fVec) this.store.factEmbeddings![fact.id] = fVec;
			}

			this.markDirty();
			this.save();
		},

 		search: async (
 		        query: string,
 		        topK: number,
 		        deepRecall = false,
 		        context?: {
 		                project?: string;
 		                atTimestamp?: number;
 		                /** R2.5 v2 recall mode. default 'latest' (backward compat). */
 		                mode?: "latest" | "history" | "at-time";
 		                /** #27 minimum confidence threshold (default 0). */
 		                minConfidence?: number;
 		                /** #27 HyDE — caller-provided 가상 답. embedding 시 사용. */
 		                queryHint?: string;
 		                /** R5 #28 — privacy scope mode. strict 권장 production. */
 		                scopeMode?: "strict" | "soft";
 		                /** R5 #28 — explicit cross-project recall (strict mode). */
 		                crossProject?: boolean;
 		                /** R4 #220 — Epoch anchor. */
 		                epochAnchor?: string;
 		        },
 		): Promise<Fact[]> => {
 		        const now = Date.now();
 		        const BROAD_FACTOR = 3;			const searchMode = process.env.NAIA_SEARCH_MODE ?? (this.embedder && this.embedder.dims >= 2000 ? "vector-only" : "rrf");

			// #27 HyDE — caller 가 queryHint 주면 그것으로 embedding (가상 답 →
			// fact form 정합). 미설정 시 query 그대로.
			const embedTarget = context?.queryHint ?? query;
			const queryVec = await this.embedWithCache(embedTarget);

			const queryTokens = tokenize(query);
			// Phase B-γ toggle: skip spreading activation entirely when disabled
			// so ranking falls back to vector cosine + BM25 only. The graph
			// itself is preserved (touchNode/strengthen still run on upsert)
			// — only this lookup-side propagation is bypassed.
			const activatedEntities = this.disableKGSpreading
				? []
				: this.kg.spreadingActivation(queryTokens, 2, 0.5);
			const activationMap = new Map<string, number>();
			for (const { entity, activation } of activatedEntities) {
				activationMap.set(entity, activation);
			}

			const broadK = topK * BROAD_FACTOR;
			const RRF_K = 60;
			const useBM25 = searchMode !== "vector-only";

			const proj = context?.project;
			let atT = context?.atTimestamp;
			const epochAnchor = (context as any)?.epochAnchor;
			let epochRange: { start: number; end: number | null } | null = null;

			// R4 #220 — Resolve epoch anchor to range or timestamp
			if (epochAnchor && atT === undefined) {
			        const epochs = this.getEpochs();
			        const matched = epochs.find(e => 
			                e.name.toLowerCase().includes(epochAnchor.toLowerCase()) ||
			                (e.description && e.description.toLowerCase().includes(epochAnchor.toLowerCase()))
			        );
			        if (matched) {
			                epochRange = { start: matched.start, end: matched.end };
			        }
			}

			// R2.5 v2 fix #1: mode='at-time' requires atTimestamp (either explicit or resolved via epoch).
			if (context?.mode === "at-time" && atT === undefined && !epochRange) {
			        throw new Error(
			                "semantic.search: mode='at-time' requires `atTimestamp` or a valid `epochAnchor` to be set",
			        );
			}

			const scopeMode = (context as any)?.scopeMode ?? "soft";                    const crossProject = (context as any)?.crossProject ?? false;

			let baseFacts: Fact[];
			if (epochRange) {
			        baseFacts = this.factsInTimeRange(epochRange.start, epochRange.end);
			} else if (atT !== undefined) {
			        baseFacts = this.factsValidAtTime(atT);
			} else {
			        baseFacts = this.store.facts;
			}

			let allFacts: Fact[];
			if (scopeMode === "strict" && !crossProject) {
			        if (proj) {
			                allFacts = baseFacts.filter(
			                        (f) =>
			                                f.encodingContext?.project === proj ||
			                                (f.topics?.includes(proj) ?? false),
			                );
			        } else {
			                // strict + no project: cross-project leak 방지 → project 없는 fact 만
			                allFacts = baseFacts.filter((f) => !f.encodingContext?.project);
			        }
			} else if (crossProject) {
			        // explicit cross-project recall: no filtering
			        allFacts = baseFacts;
			} else {
			        // soft mode (legacy default).
			        allFacts = proj
			                ? baseFacts.filter(
			                                (f) =>
			                                        f.encodingContext?.project === proj ||
			                                        (f.topics?.includes(proj) ?? false),
			                        )
			                : baseFacts;
			}

			const vectorScores: Map<string, number> = new Map();
			const bm25Scores: Map<string, number> = new Map();
			const entityBonuses: Map<string, number> = new Map();

			let bm25Instance: BM25 | null = null;
			if (useBM25) {
			        bm25Instance = new BM25();
			        const docMap = new Map<string, string>();
			        for (const f of allFacts) {
			                docMap.set(f.id, [f.content, ...f.entities, ...f.topics].join(" "));
			        }
			        bm25Instance.index(docMap);
			}

			for (const fact of allFacts) {
			        const factVec = this.store.factEmbeddings?.[fact.id];
			        const vs = factVec && queryVec ? cosineSimilarity(queryVec, factVec) : 0;
			        vectorScores.set(fact.id, vs);

			        if (bm25Instance) {
			                const bs = bm25Instance.score(query, fact.id);
			                bm25Scores.set(fact.id, bs);
			        }

			        let eb = 0;
			        for (const qt of queryTokens) {
			                if (fact.entities.some((e) => e.toLowerCase().includes(qt))) {
			                        eb += 0.3;
			                }
			        }
			        // R4 #220 — KG spreading activation bonus.
			        for (const ent of fact.entities) {
			                const act = activationMap.get(ent.toLowerCase());
			                if (act && act > 0.01) {
			                        eb += act * 2.0;
			                }
			        }
			        entityBonuses.set(fact.id, eb);			        }

			        const byVector = [...allFacts].sort((a, b) => (vectorScores.get(b.id) ?? 0) - (vectorScores.get(a.id) ?? 0));
			        const vectorRank = new Map<string, number>();
			        for (let i = 0; i < byVector.length; i++) vectorRank.set(byVector[i].id, i + 1);

			        let bm25Rank: Map<string, number> | null = null;
			        if (useBM25) {
			        const byBM25 = [...allFacts].sort((a, b) => (bm25Scores.get(b.id) ?? 0) - (bm25Scores.get(a.id) ?? 0));
			        bm25Rank = new Map<string, number>();
			        for (let i = 0; i < byBM25.length; i++) bm25Rank.set(byBM25[i].id, i + 1);
			        }

			        const candidates = allFacts
			        .map((fact) => {
			                const vs = vectorScores.get(fact.id) ?? 0;
			                const bs = bm25Scores.get(fact.id) ?? 0;
			                const eb = entityBonuses.get(fact.id) ?? 0;

			                // Flashbulb = strong emotional AROUSAL in EITHER valence (grief flashbulbs too),
			                // not positive valence only. arousal = |valence-0.5|*2; threshold 0.6 is the
			                // symmetric form of the previous positive-only 0.8 valence cut (|v-0.5|>=0.3),
			                // so positive behavior is unchanged and strong-negative reactions now qualify.
			                // Default 0.5 (neutral, arousal 0) when maxEmotion absent — NOT 0 (which would
			                // read as max-negative and false-flashbulb an emotionless memory).
			                const isFlashbulb = Math.abs((fact.maxEmotion ?? 0.5) - 0.5) * 2 >= 0.6;
			                const relevanceThreshold = epochRange ? 0.0 : 0.12;

			                const isRelevant = vs >= relevanceThreshold || bs > 0 || eb > 0 || isFlashbulb;

			                if (!isRelevant && !deepRecall) return null;					let relevanceScore: number;
					if (searchMode === "vector-only") {
					        relevanceScore = vs + eb;
					} else {
					        // RRF fusion of the vector + BM25 rank streams. The
					        // entity/KG bonus (eb) MUST also be added here — it is a
					        // strong exact-match / spreading-activation signal and was
					        // previously dropped in RRF mode (only used by vector-only),
					        // so exact entity matches got no credit and RRF ranked below
					        // raw vector similarity. eb lives on the raw score scale
					        // (0.3 per exact entity match) which intentionally dominates
					        // the compressed RRF base (~1/RRF_K) for confident matches.
					        relevanceScore =
					                1 / (RRF_K + (vectorRank.get(fact.id) ?? allFacts.length)) +
					                1 / (RRF_K + (bm25Rank!.get(fact.id) ?? allFacts.length)) +
					                eb;
					}

					// Apply boost to Flashbulb memories to ensure they survive slice(0, broadK)
					if (isFlashbulb) relevanceScore += 0.5;

					return { fact, relevanceScore, vectorScore: vs };
					})				.filter((x): x is NonNullable<typeof x> => x !== null)
				.sort((a, b) => b.relevanceScore - a.relevanceScore)
				.slice(0, broadK);

			// Stage 2: Re-rank with importance/strength only among candidates
			let scored = candidates
				.map(({ fact, relevanceScore, vectorScore }) => {
					const strength = calculateStrength(
						fact.importance,
						fact.createdAt,
						fact.recallCount,
						fact.lastAccessed,
						now,
					);

					const finalScore = deepRecall
						? relevanceScore
						: relevanceScore * 0.7 + strength * 0.3;

					return { fact, score: finalScore, strength, vectorScore };
				})
				.filter((x) => x.score > 0)
				.sort((a, b) => b.score - a.score);

			// R2.5 v2 mode handling. backward compat:
			//  - deepRecall=true 그대로 superseded 포함 (기존 동작)
			//  - mode='latest' (default): only status === 'active' (archived
			//    fact 도 hide — adversarial review fix #2)
			//  - mode='history': superseded 도 포함 — chain 회상
			//  - mode='at-time': atT 가 set 된 path (이미 위 factsValidAtTime 처리)
			const mode = context?.mode ?? "latest";
			const includeSuperseded = mode === "history" || deepRecall || epochRange !== null;
			if (!includeSuperseded && atT === undefined) {
			        if (deepRecall) {
			                // deepRecall + latest mode: 기존 동작 — superseded 만 제외 (loose).
			                scored = scored.filter((f) => f.fact.status !== "superseded");
			        } else {
			                // latest 명시 mode: status === 'active' 만 (strict, archived 제외).
			                scored = scored.filter((f) => (f.fact.status ?? "active") === "active");
			        }
			}
			// #27 confidence threshold — preservation-first 의 짝.
			// score 가 minConfidence 미만인 fact 는 제외. 사용자 directive
			// A09 + mem0 "97.8% junk" 회피.
			//
			// Adversarial review fix: deepRecall=true 시 cutoff 를 0.5배
			// — "오래된 기억 회상" 의도와 충돌 방지. deepRecall 자체가 이미
			// strict mode (decay 무시) 라 추가 strict 는 over-filter.
			let minConfidence = context?.minConfidence ?? 0;
			if (deepRecall && minConfidence > 0) minConfidence *= 0.5;
			if (minConfidence > 0) {
				scored = scored.filter((f) => f.score >= minConfidence);
			}

			// R5 #28 Part 2 — Intent penalty: query 의 intent category 와 fact
			// 의 category 가 mismatch 시 score 감소 (×0.7). irrelevant_isolation
			// 효과 — \"업무 query\" 시 \"개인 fact\" 노출 줄임.
			const queryIntent = (context as any)?.queryIntent;
			if (queryIntent) {
				for (const s of scored) {
					const factCategory = s.fact.encodingContext?.category;
					if (factCategory && factCategory !== queryIntent) {
						s.score *= 0.7;
					}
				}
				scored.sort((a, b) => b.score - a.score);
			}

			// #27 Step 3 — Cross-encoder reranker (caller-injected, optional).
			// final ranking 후 (cosine + BM25 + KG + threshold 모두 적용 후)
			// query-fact relevance 재평가. 진짜 ranking 강화.
			if (this.reranker && scored.length > 0) {
				const reranked = await this.reranker.rerank(
					query,
					scored.map((s) => ({ ...s, content: s.fact.content })),
					Math.min(scored.length, topK * 2),
				);
				const orderMap = new Map(reranked.map((r, i) => [r.fact.id, i]));
				scored.sort((a, b) => {
					const ra = orderMap.get(a.fact.id) ?? scored.length;
					const rb = orderMap.get(b.fact.id) ?? scored.length;
					return ra - rb;
				});
				scored = scored.slice(0, topK * 2); // reranker 가 본 candidate set
			}

			// #27 MMR (Maximal Marginal Relevance) — top-K 의 *유사 fact 중복*
			// 줄임. 같은 attribute key 또는 매우 유사한 content 의 fact 가
			// top-K 에 모두 들어가는 것 방지. λ=0.7 (relevance 우선, diversity
			// 30%).
			const useMMR = process.env.NAIA_MMR !== "off";
			if (useMMR && scored.length > topK) {
				const lambda = 0.7;
				const selected: typeof scored = [];
				const remaining = [...scored];
				while (selected.length < topK && remaining.length > 0) {
					let bestIdx = 0;
					let bestScore = -Infinity;
					for (let i = 0; i < remaining.length; i++) {
						const cand = remaining[i];
						let maxSim = 0;
						for (const s of selected) {
							// Use attribute-key prefix as cheap diversity signal.
							const candKey = cand.fact.content.split(":")[0]?.trim() ?? "";
							const selKey = s.fact.content.split(":")[0]?.trim() ?? "";
							if (candKey && candKey === selKey) maxSim = Math.max(maxSim, 0.8);
						}
						const mmrScore = lambda * cand.score - (1 - lambda) * maxSim;
						if (mmrScore > bestScore) {
							bestScore = mmrScore;
							bestIdx = i;
						}
					}
					selected.push(remaining[bestIdx]);
					remaining.splice(bestIdx, 1);
				}
				scored = selected;
			} else {
				scored = scored.slice(0, topK);
			}

			// Update recall counts
			for (const { fact } of scored) {
			        fact.recallCount++;
			        fact.lastAccessed = now;
			        fact.strength = calculateStrength(
			                fact.importance,
			                fact.createdAt,
			                fact.recallCount,
			                fact.lastAccessed,
			                now,
			        );
			}

			if (epochRange) {
			    console.log(`[LocalAdapter] Final scored count for epoch: ${scored.length}`);
			}

			if (scored.length > 0) {
			        this.markDirty();
			        this.save();
			}

			return scored.map((s) => {
			        s.fact.relevanceScore = s.score;
			        return s.fact;
			});		},

		decay: async (now: number): Promise<number> => {
			// R3 보존 우선 (사용자 directive 2026-05-08, #25):
			// splice X. strength 약한 fact/episode 는 status='archived'.
			// 데이터 영구 보존, default search 에서 hide. 임계 도달 (#29) 시만
			// 별도 망각 logic — 본 decay() 는 *영원히 splice X*.
			let archivedCount = 0;
			for (const fact of this.store.facts) {
				const strength = calculateStrength(
					fact.importance,
					fact.createdAt,
					fact.recallCount,
					fact.lastAccessed,
					now,
				);
				fact.strength = strength;
				if (shouldPrune(strength) && fact.status === "active") {
					fact.status = "archived";
					archivedCount++;
				}
			}

			// Episodes 도 동일 — splice X, status 변경만.
			for (const ep of this.store.episodes) {
				const strength = calculateStrength(
					ep.importance.utility,
					ep.timestamp,
					ep.recallCount,
					ep.lastAccessed,
					now,
				);
				ep.strength = strength;
				// Consolidated episode 는 유지 (semantic memory 에 기여).
				// 그 외 strength 약하면 archived.
				if (shouldPrune(strength) && !ep.consolidated && ep.status !== "archived") {
					ep.status = "archived";
					archivedCount++;
				}
			}

			if (archivedCount > 0) {
				this.markDirty();
				this.save();
			}
			return archivedCount;
		},

		associate: async (
			entityA: string,
			entityB: string,
			weight = 0.1,
		): Promise<void> => {
			const key = assocKey(entityA, entityB);
			const current = this.store.associations[key] ?? 0;
			// Hebbian: strengthen on co-access, cap at 1.0
			this.store.associations[key] = Math.min(1.0, current + weight);
			// Also update knowledge graph
			this.kg.strengthen(entityA, entityB, weight);
			this.markDirty();
			this.save();
		},

		getAll: async (): Promise<Fact[]> => {
			return [...this.store.facts];
		},

		delete: async (id: string): Promise<boolean> => {
			// R3 보존 우선 (사용자 directive 2026-05-08, #25):
			// splice X. archive 로 redirect. 사용자 explicit GC (#29) 후 만
			// 진짜 splice 가능. caller 가 진짜 hard delete 원하면 #29 의
			// forgetSweep API 사용해야 함.
			const fact = this.store.facts.find((f) => f.id === id);
			if (!fact) return false;
			fact.status = "archived";
			this.markDirty();
			this.save();
			return true;
		},
	};

	// ─── Procedural Memory ────────────────────────────────────────────────

	procedural = {
		getSkill: async (name: string): Promise<Skill | null> => {
			return this.store.skills.find((s) => s.name === name) ?? null;
		},

		recordOutcome: async (name: string, success: boolean): Promise<void> => {
			const skill = this.store.skills.find((s) => s.name === name);
			if (skill) {
				if (success) skill.successCount++;
				else skill.failureCount++;
				skill.confidence =
					skill.successCount / (skill.successCount + skill.failureCount);
			} else {
				this.store.skills.push({
					id: randomUUID(),
					name,
					description: "",
					learnedAt: Date.now(),
					successCount: success ? 1 : 0,
					failureCount: success ? 0 : 1,
					confidence: success ? 1.0 : 0.0,
				});
			}
			this.markDirty();
			this.save();
		},

		learnFromFailure: async (reflection: Reflection): Promise<void> => {
			this.store.reflections.push(reflection);
			this.markDirty();
			this.save();
		},

		getReflections: async (
			task: string,
			topK: number,
		): Promise<Reflection[]> => {
			return this.store.reflections
				.map((r) => ({
					reflection: r,
					score: keywordScore(task, `${r.task} ${r.failure} ${r.analysis}`),
				}))
				.filter((x) => x.score > 0)
				.sort((a, b) => b.score - a.score)
				.slice(0, topK)
				.map((x) => x.reflection);
		},
	};

	// ─── Consolidation ────────────────────────────────────────────────────

	async consolidate(): Promise<ConsolidationResult> {
		const result: ConsolidationResult = {
			episodesProcessed: 0,
			factsCreated: 0,
			factsUpdated: 0,
			memoriesPruned: 0,
			associationsUpdated: 0,
		};

		const now = Date.now();

		// 1. Decay sweep
		result.memoriesPruned = await this.semantic.decay(now);

		// 2. Association decay (Hebbian: unused associations weaken)
		// R3 보존 우선 (사용자 directive 2026-05-08, #25):
		// association 영구 보존. weight 만 약화 — 0.01 미만이어도 *delete X*.
		// recall 시 weight 가중치라 자연 무시. 임계 도달 (#29) 시만 explicit
		// forget 가능.
		for (const [key, weight] of Object.entries(this.store.associations)) {
			const decayed = weight * 0.95;
			this.store.associations[key] = decayed;
			result.associationsUpdated++;
		}

		// 3. Knowledge graph edge decay
		result.associationsUpdated += this.kg.decayEdges(0.95, 0.01);

		// 4. Mark unconsolidated episodes older than 1 hour as ready for extraction
		// (actual fact extraction requires LLM — done by MemorySystem, not adapter)
		const unconsolidated = this.store.episodes.filter(
			(ep) => !ep.consolidated && now - ep.timestamp > 60 * 60 * 1000,
		);
		result.episodesProcessed = unconsolidated.length;

		this.markDirty();
		this.save();

		return result;
	}

	// ─── Backup / Restore (E2E Encrypted Blob) ───────────────────────────

	/**
	 * Export all memory as an AES-256-GCM encrypted blob.
	 *
	 * Blob layout:
	 *   4 bytes  magic    "NAIA"
	 *   1 byte   version  0x01
	 *   16 bytes salt     (PBKDF2 input)
	 *   12 bytes iv       (AES-GCM nonce)
	 *   16 bytes authTag  (AES-GCM authentication tag)
	 *   N bytes  ciphertext
	 *
	 * Total fixed header: 49 bytes. Integrity is provided by AES-GCM authTag —
	 * a separate SHA-256 over plaintext is not included because GCM already
	 * authenticates the ciphertext under the derived key.
	 *
	 * Key derivation: PBKDF2-SHA256, 200_000 iterations, 32-byte key.
	 * Password never leaves the client. Only the encrypted blob is transported.
	 *
	 * @param password  User-supplied passphrase (never stored)
	 * @returns         Encrypted blob as Uint8Array
	 */
	async export(password: string): Promise<Uint8Array> {
		if (!password) throw new Error("Password must not be empty");
		const plaintext = Buffer.from(JSON.stringify(this.store), "utf-8");
		const salt = randomBytes(16);
		const iv = randomBytes(12);

		// Derive key
		const key = await pbkdf2Async(password, salt, 200_000, 32, "sha256");

		// AES-256-GCM encrypt — authTag provides authenticated integrity
		const cipher = createCipheriv("aes-256-gcm", key, iv, {
			authTagLength: 16,
		});
		const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
		const authTag = cipher.getAuthTag(); // 16 bytes

		// Assemble: magic(4) + version(1) + salt(16) + iv(12) + authTag(16) + ciphertext
		const magic = Buffer.from("NAIA", "ascii");
		const version = Buffer.from([0x01]);
		return new Uint8Array(
			Buffer.concat([magic, version, salt, iv, authTag, encrypted]),
		);
	}

	/**
	 * Import memory from an encrypted blob created by `export()`.
	 * Replaces current memory entirely after successful decryption.
	 * Rolls back in-memory state if the disk write fails (crash safety).
	 *
	 * @param blob      Encrypted blob from export()
	 * @param password  User-supplied passphrase
	 * @throws          If decryption fails, JSON is invalid, or disk write fails
	 */
	async import(blob: Uint8Array, password: string): Promise<void> {
		if (!password) throw new Error("Password must not be empty");
		const buf = Buffer.from(blob);

		// Parse header: magic(4) + version(1) + salt(16) + iv(12) + authTag(16) = 49 bytes
		const HEADER_SIZE = 4 + 1 + 16 + 12 + 16;
		if (buf.length <= HEADER_SIZE) {
			throw new Error("Invalid backup blob: too short");
		}

		const magic = buf.subarray(0, 4).toString("ascii");
		if (magic !== "NAIA") {
			throw new Error("Invalid backup blob: bad magic");
		}

		const blobVersion = buf[4];
		if (blobVersion !== 0x01) {
			throw new Error(`Unsupported backup version: ${blobVersion}`);
		}

		const salt = buf.subarray(5, 21);
		const iv = buf.subarray(21, 33);
		const authTag = buf.subarray(33, 49);
		const ciphertext = buf.subarray(HEADER_SIZE);

		// Derive key
		const key = await pbkdf2Async(password, salt, 200_000, 32, "sha256");

		// AES-256-GCM decrypt — decipher.final() throws if authTag is invalid
		let plaintext: Buffer;
		try {
			const decipher = createDecipheriv("aes-256-gcm", key, iv, {
				authTagLength: 16,
			});
			decipher.setAuthTag(authTag);
			plaintext = Buffer.concat([
				decipher.update(ciphertext),
				decipher.final(),
			]);
		} catch {
			throw new Error("Decryption failed: wrong password or corrupted blob");
		}

		// Parse and validate store
		let parsed: MemoryStore;
		try {
			parsed = JSON.parse(plaintext.toString("utf-8")) as MemoryStore;
		} catch {
			throw new Error("Invalid backup: JSON parse failed");
		}
		if (parsed.version !== 1) {
			throw new Error(`Unsupported store version: ${parsed.version}`);
		}
		// Minimal shape guard — ensures downstream operations don't encounter missing arrays/objects
		if (
			!Array.isArray(parsed.episodes) ||
			!Array.isArray(parsed.facts) ||
			!Array.isArray(parsed.skills) ||
			!Array.isArray(parsed.reflections) ||
			typeof parsed.associations !== "object" ||
			Array.isArray(parsed.associations) ||
			parsed.associations === null
		) {
			throw new Error("Invalid backup: store shape mismatch");
		}

		// Replace memory — roll back in-memory state if disk write fails
		const previousStore = this.store;
		const previousKg = this.kg;
		// Ensure knowledgeGraph is always present before constructing KnowledgeGraph
		const importedKgState = parsed.knowledgeGraph ?? emptyKGState();
		parsed.knowledgeGraph = importedKgState;
		this.store = parsed;
		// Re-point KG to the newly imported state so all subsequent KG operations
		// operate on the imported KGState, not the old one.
		this.kg = new KnowledgeGraph(importedKgState);
		try {
			this.markDirty();
			// saveImmediate (not the debounced save) so a disk-write failure throws
			// synchronously here and triggers the rollback below — a scheduled save
			// would write later, outside this try, leaving state diverged on failure.
			this.saveImmediate();
		} catch (err) {
			// Disk write failed — restore both store and KG to avoid divergence
			this.store = previousStore;
			this.kg = previousKg;
			throw err;
		}
	}

	// ─── Lifecycle ────────────────────────────────────────────────────────

	async close(): Promise<void> {
		// Force a synchronous flush — `save()` only *schedules* a debounced write,
		// which can lose data if the process tears down (or a new adapter opens the
		// same store) before the timer fires. close() must durably persist.
		this.saveImmediate();
	}

	// ─── Testing Helpers ──────────────────────────────────────────────────

	/** Get raw store for testing/debugging */
	getStore(): Readonly<MemoryStore> {
		return this.store;
	}

	/** Get knowledge graph for direct queries */
	getKnowledgeGraph(): KnowledgeGraph {
		return this.kg;
	}

	/** Reset all memory (testing only) */
	reset(): void {
		this.store = emptyStore();
		this.markDirty();
		this.save();
	}
}
