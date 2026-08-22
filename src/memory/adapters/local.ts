import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { EmbeddingProvider } from "../embeddings.js";
import { createLocalEpisodeMemory } from "./local-episode.js";
import { getLocalEpochs, upsertLocalEpoch } from "./local-epoch.js";
import type { LocalAdapterOptions } from "./local-options.js";
export type { LocalAdapterOptions } from "./local-options.js";
import { KnowledgeGraph, emptyKGState } from "../knowledge-graph.js";
import type {
	BackupCapable,
	ConsolidationResult,
	MemoryAdapter,
} from "../types.js";
import {
	AtomicReplaceCommittedError,
	atomicReplaceFileSync,
} from "./atomic-file-replace.js";
import { decodeLocalBackup, encodeLocalBackup } from "./local-backup.js";
import {
	type MemoryStore,
	emptyStore,
	factsInTimeRange,
	factsValidAtTime,
} from "./local-model.js";
import { createLocalProceduralMemory } from "./local-procedural.js";
import {
	type LocalSemanticSearchHost,
	searchLocalSemanticMemory,
} from "./local-semantic-search.js";
import { createLocalSemanticMemory } from "./local-semantic.js";

export class LocalAdapter implements MemoryAdapter, BackupCapable {
	private store: MemoryStore;
	private readonly storePath: string;
	private dirty = false;
	private saveTimer: NodeJS.Timeout | null = null;
	private readonly SAVE_DEBOUNCE_MS = 2000;
	private kg: KnowledgeGraph;
	private readonly embedder: EmbeddingProvider | null;
	private readonly disableKGSpreading: boolean;
	private readonly reranker: import("../reranker.js").RerankerProvider | null;
	private readonly onPersistenceError: ((error: unknown) => void) | null;
	private readonly embedCache = new Map<string, number[]>();
	private embeddingSpaceMismatch: string | null = null;
	private storeGeneration = 0;

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
		this.onPersistenceError =
			typeof options === "object" ? (options?.onPersistenceError ?? null) : null;
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
		this.checkEmbeddingSpace();
		this.kg = new KnowledgeGraph(this.store.knowledgeGraph);
	}

	private checkEmbeddingSpace(): void {
		this.embeddingSpaceMismatch = null;
		const current = this.embedder?.embeddingSpaceId;
		const hasVectors =
			Object.keys(this.store.factEmbeddings ?? {}).length > 0 ||
			Object.keys(this.store.episodeEmbeddings ?? {}).length > 0;
		if (this.embedder && !current) {
			this.embeddingSpaceMismatch = hasVectors
				? "persisted vectors require an identified embedding provider"
				: "embedding provider has no embedding-space identity";
			return;
		}
		if (!current) return;
		if (!hasVectors) {
			this.store.embeddingSpaceId = current;
			return;
		}
		const stored = this.store.embeddingSpaceId;
		if (stored !== current) {
			this.embeddingSpaceMismatch = stored
				? `embedding space changed (stored=${stored} current=${current})`
				: `legacy vectors have no embedding-space identity (current=${current})`;
		}
	}

	/** Explicitly rebuild all persisted vectors after an embedding-model change. */
	async reindexEmbeddings(): Promise<void> {
		if (!this.embedder)
			throw new Error("Cannot reindex without an embedding provider");
		if (!this.embedder.embeddingSpaceId) {
			throw new Error("Cannot reindex with an unidentified embedding provider");
		}
		const generation = this.storeGeneration;
		const facts = this.store.facts.map((fact) => ({
				id: fact.id,
				content: fact.content,
			})),
			episodes = this.store.episodes.map((episode) => ({
				id: episode.id,
				content: episode.content,
			}));
		const factTexts = facts.map((fact) => fact.content);
		const episodeTexts = episodes.map((episode) => episode.content);
		const factVectors = factTexts.length
			? await this.embedder.embedBatch(factTexts)
			: [];
		const episodeVectors = episodeTexts.length
			? await this.embedder.embedBatch(episodeTexts)
			: [];
		const validateVectors = (
			vectors: number[][],
			expected: number,
			label: string,
		) => {
			if (vectors.length !== expected) {
				throw new Error(
					`${label} embedding count mismatch: expected ${expected}, got ${vectors.length}`,
				);
			}
			for (const vector of vectors) {
				if (!this.validEmbedding(vector)) {
					throw new Error(
						`${label} embedding is invalid for ${this.embedder!.dims} dimensions`,
					);
				}
			}
		};
		validateVectors(factVectors, factTexts.length, "fact");
		validateVectors(episodeVectors, episodeTexts.length, "episode");
		if (this.storeGeneration !== generation) {
			throw new Error(
				"Memory changed while reindexing embeddings; retry reindexEmbeddings()",
			);
		}
		const previousFactEmbeddings = this.store.factEmbeddings;
		const previousEpisodeEmbeddings = this.store.episodeEmbeddings;
		const previousSpaceId = this.store.embeddingSpaceId;
		const previousMismatch = this.embeddingSpaceMismatch;
		this.store.factEmbeddings = Object.fromEntries(
			facts.map((fact, index) => [fact.id, factVectors[index]!]),
		);
		this.store.episodeEmbeddings = Object.fromEntries(
			episodes.map((episode, index) => [episode.id, episodeVectors[index]!]),
		);
		this.store.embeddingSpaceId = this.embedder.embeddingSpaceId;
		this.embeddingSpaceMismatch = null;
		this.embedCache.clear();
		try {
			this.markDirty();
			this.saveImmediate();
		} catch (error) {
			if (error instanceof AtomicReplaceCommittedError) throw error;
			this.store.factEmbeddings = previousFactEmbeddings;
			this.store.episodeEmbeddings = previousEpisodeEmbeddings;
			this.store.embeddingSpaceId = previousSpaceId;
			this.embeddingSpaceMismatch = previousMismatch;
			this.embedCache.clear();
			throw error;
		}
	}

	/** Live retrieval view; imports replace the underlying store and graph. */
	private semanticSearchHost(): LocalSemanticSearchHost {
		const adapter = this;
		return {
			get facts() {
				return adapter.store.facts;
			},
			get factEmbeddings() {
				return adapter.store.factEmbeddings;
			},
			get embedder() {
				return adapter.embedder;
			},
			get disableKGSpreading() {
				return adapter.disableKGSpreading;
			},
			get kg() {
				return adapter.kg;
			},
			get reranker() {
				return adapter.reranker;
			},
			embedWithCache: (text) => adapter.embedWithCache(text),
			factsInTimeRange: (start, end) =>
				factsInTimeRange(adapter.store.facts, start, end),
			factsValidAtTime: (timestamp) =>
				factsValidAtTime(adapter.store.facts, timestamp),
			getEpochs: () => adapter.getEpochs(),
			markDirty: () => adapter.markDirty(),
			save: () => adapter.save(),
		};
	}

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
			try {
				this.saveImmediate();
			} catch (error) {
				// A timer callback has no caller to receive persistence failures. Keep
				// the store dirty so a later mutation or explicit flush can retry,
				// instead of turning a recoverable I/O error into an uncaught exception.
				if (this.onPersistenceError) {
					try {
						this.onPersistenceError(error);
					} catch {
						// Observer failures must not replace the persistence failure or crash
						// the host from a timer callback.
					}
				} else {
					process.emitWarning(
						error instanceof Error ? error : String(error),
						{ code: "NAIA_MEMORY_DELAYED_SAVE_FAILED" },
					);
				}
			}
		}, this.SAVE_DEBOUNCE_MS);
	}

	saveImmediate(): void {
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		if (!this.dirty) return;
		atomicReplaceFileSync(
			this.storePath,
			JSON.stringify(this.store, null, "\t"),
		);
		this.dirty = false;
	}

	async flush(): Promise<void> {
		this.saveImmediate();
	}

	/** Embed text with in-memory cache to avoid redundant API calls. */
	private validEmbedding(vec: number[] | undefined): vec is number[] {
		if (vec === undefined || vec.length !== this.embedder?.dims) return false;
		for (let index = 0; index < vec.length; index++) {
			if (!Object.hasOwn(vec, index) || !Number.isFinite(vec[index]))
				return false;
		}
		return true;
	}

	private async embedWithCache(text: string): Promise<number[] | null> {
		if (this.embeddingSpaceMismatch) {
			throw new Error(
				`LocalAdapter: ${this.embeddingSpaceMismatch}; call reindexEmbeddings()`,
			);
		}
		if (!this.embedder) return null;
		const cacheKey = `query:${text}`;
		const cached = this.embedCache.get(cacheKey);
		if (cached) return cached;
		try {
			const vec = await this.embedder.embed(text);
			if (!this.validEmbedding(vec)) return null;
			this.embedCache.set(cacheKey, vec);
			return vec;
		} catch {
			return null; // Non-fatal — keyword fallback still works
		}
	}

	/** Embed persisted corpus text with document/passage preprocessing. */
	private async embedDocumentWithCache(text: string): Promise<number[] | null> {
		if (this.embeddingSpaceMismatch) {
			throw new Error(
				`LocalAdapter: ${this.embeddingSpaceMismatch}; call reindexEmbeddings()`,
			);
		}
		if (!this.embedder) return null;
		const cacheKey = `document:${text}`;
		const cached = this.embedCache.get(cacheKey);
		if (cached) return cached;
		try {
			const vec = (await this.embedder.embedBatch([text]))[0];
			if (!this.validEmbedding(vec)) return null;
			this.embedCache.set(cacheKey, vec);
			return vec;
		} catch {
			return null;
		}
	}

	private markDirty(): void {
		this.storeGeneration++;
		this.dirty = true;
	}

	// ─── Epoch Memory (R4 #220) ───────────────────────────────────────────

	/** Register or update a life epoch (e.g., 'Before moving to Seoul'). */
	async upsertEpoch(epoch: import("../types.js").Epoch): Promise<void> {
		upsertLocalEpoch(this.store, epoch);
		this.markDirty();
		this.save();
	}

	/** Get all defined life epochs. */
	getEpochs(): import("../types.js").Epoch[] {
		return getLocalEpochs(this.store);
	}

	episode = createLocalEpisodeMemory({
		getStore: () => this.store,
		embedQuery: (text) => this.embedWithCache(text),
		embedDocument: (text) => this.embedDocumentWithCache(text),
		markDirty: () => this.markDirty(),
		save: () => this.save(),
	});

	semantic = createLocalSemanticMemory({
		getStore: () => this.store,
		getKnowledgeGraph: () => this.kg,
		embedDocument: (text) => this.embedDocumentWithCache(text),
		search: (query, topK, deepRecall, context) =>
			searchLocalSemanticMemory(
				this.semanticSearchHost(),
				query,
				topK,
				deepRecall,
				context,
			),
		markDirty: () => this.markDirty(),
		save: () => this.save(),
	});

	procedural = createLocalProceduralMemory({
		getStore: () => this.store,
		markDirty: () => this.markDirty(),
		save: () => this.save(),
	});
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
		return encodeLocalBackup(this.store, password);
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
		const parsed = await decodeLocalBackup(blob, password);

		// Replace memory — roll back in-memory state if disk write fails
		const previousStore = this.store;
		const previousKg = this.kg;
		const previousEmbeddingSpaceMismatch = this.embeddingSpaceMismatch;
		// Ensure knowledgeGraph is always present before constructing KnowledgeGraph
		const importedKgState = parsed.knowledgeGraph ?? emptyKGState();
		parsed.knowledgeGraph = importedKgState;
		parsed.factEmbeddings ??= {};
		parsed.episodeEmbeddings ??= {};
		this.store = parsed;
		// Re-point KG to the newly imported state so all subsequent KG operations
		// operate on the imported KGState, not the old one.
		this.kg = new KnowledgeGraph(importedKgState);
		this.embedCache.clear();
		this.checkEmbeddingSpace();
		try {
			this.markDirty();
			// saveImmediate (not the debounced save) so a disk-write failure throws
			// synchronously here and triggers the rollback below — a scheduled save
			// would write later, outside this try, leaving state diverged on failure.
			this.saveImmediate();
		} catch (err) {
			if (err instanceof AtomicReplaceCommittedError) throw err;
			// Disk write failed — restore both store and KG to avoid divergence
			this.store = previousStore;
			this.kg = previousKg;
			this.embeddingSpaceMismatch = previousEmbeddingSpaceMismatch;
			this.embedCache.clear();
			throw err;
		}
	}

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
		const knowledgeGraph = emptyKGState();
		this.store.knowledgeGraph = knowledgeGraph;
		this.kg = new KnowledgeGraph(knowledgeGraph);
		this.checkEmbeddingSpace();
		this.embedCache.clear();
		this.markDirty();
		this.saveImmediate();
	}
}
