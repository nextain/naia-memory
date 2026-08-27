import { Worker } from "node:worker_threads";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, existsSync } from "node:fs";
import {
    createCipheriv,
    createDecipheriv,
    pbkdf2,
    randomBytes,
} from "node:crypto";
import { promisify } from "node:util";
import { calculateStrength } from "../decay.js";
import type { EmbeddingProvider } from "../embeddings.js";
import { tokenize, normalize } from "../ko-normalize.js";
import { KnowledgeGraph, emptyKGState } from "../knowledge-graph.js";
import type {
    BackupCapable,
    ConsolidationResult,
    Episode,
    Fact,
    MemoryAdapter,
    RecallContext,
    Reflection,
    Skill,
    Epoch,
    StructuredFact,
} from "../types.js";

const pbkdf2Async = promisify(pbkdf2);
const __dirname = dirname(fileURLToPath(import.meta.url));
const MAX_FACT_UPSERT_BATCH = 1000;

export interface SqliteAdapterOptions {
    dbPath: string;
    embeddingProvider?: EmbeddingProvider | null;
    /** Explicitly rebuild persisted vectors when their embedding identity differs. */
    reindexEmbeddingsOnMismatch?: boolean;
}

export class SqliteAdapter implements MemoryAdapter, BackupCapable {
    private readonly worker: Worker;
    private readonly embedder: EmbeddingProvider | null;
    private kgCache: any = null;
    private kgDirty = true;
    private nextMsgId = 1;
    private pendingMsgs = new Map<number, { resolve: (res: any) => void; reject: (err: any) => void }>();
    private readonly initialization: Promise<void>;
    private readonly reindexEmbeddingsOnMismatch: boolean;
    private closed = false;
    private pendingFactUpserts: Array<{
        payload: any;
        resolve: () => void;
        reject: (error: unknown) => void;
    }> = [];
    private factUpsertFlushScheduled = false;

    constructor(options: SqliteAdapterOptions) {
        const dir = dirname(options.dbPath);
        if (dir !== "." && !existsSync(dir)) mkdirSync(dir, { recursive: true });
        this.embedder = options.embeddingProvider ?? null;
        this.reindexEmbeddingsOnMismatch = options.reindexEmbeddingsOnMismatch ?? false;
        
        // Initialize Background Worker.
        // The built package ships sqlite-worker.js next to this file. In dev/tests we
        // run from .ts source where that .js doesn't exist yet, so fall back to the
        // .ts worker loaded through tsx (a devDependency).
        const jsWorker = new URL("./sqlite-worker.js", import.meta.url);
        const useTsWorker = !existsSync(fileURLToPath(jsWorker));
        const workerUrl = useTsWorker
            ? new URL("./sqlite-worker.ts", import.meta.url)
            : jsWorker;
        this.worker = new Worker(workerUrl, {
            workerData: { dbPath: options.dbPath },
            ...(useTsWorker ? { execArgv: ["--import", "tsx/esm"] } : {}),
        });
        
        this.worker.on("message", (msg) => {
            const { id, result, error } = msg;
            const pending = this.pendingMsgs.get(id);
            if (pending) {
                this.pendingMsgs.delete(id);
                if (error) pending.reject(new Error(error));
                else pending.resolve(result);
            }
        });
        const rejectPending = (reason: unknown) => {
            this.closed = true;
            const error = reason instanceof Error ? reason : new Error(String(reason));
            for (const pending of this.pendingMsgs.values()) pending.reject(error);
            this.pendingMsgs.clear();
        };
        this.worker.on("error", rejectPending);
        this.worker.on("exit", (code) => rejectPending(new Error(`SQLite worker exited with code ${code}`)));

        this.initialization = this.initSchema();
    }

    private async rawCallWorker(type: string, payload: any): Promise<any> {
        if (this.closed) throw new Error("SQLite adapter is closed");
        const id = this.nextMsgId++;
        return new Promise((resolve, reject) => {
            this.pendingMsgs.set(id, { resolve, reject });
            try { this.worker.postMessage({ id, type, payload }); }
            catch (error) { this.pendingMsgs.delete(id); reject(error); }
        });
    }

    private async callWorker(type: string, payload: any): Promise<any> {
        await this.initialization;
        return this.rawCallWorker(type, payload);
    }

    private enqueueFactUpsert(payload: any): Promise<void> {
        if (this.closed) return Promise.reject(new Error("SQLite adapter is closed"));
        const queued = new Promise<void>((resolve, reject) => {
            this.pendingFactUpserts.push({ payload, resolve, reject });
        });
        if (!this.factUpsertFlushScheduled) {
            this.factUpsertFlushScheduled = true;
            queueMicrotask(() => void this.flushFactUpserts());
        }
        return queued;
    }

    private async flushFactUpserts(): Promise<void> {
        this.factUpsertFlushScheduled = false;
        const batch = this.pendingFactUpserts.splice(0, MAX_FACT_UPSERT_BATCH);
        if (batch.length === 0) return;
        try {
            await this.callWorker("upsert-facts", { facts: batch.map(({ payload }) => payload) });
            for (const item of batch) item.resolve();
        } catch (error) {
            for (const item of batch) item.reject(error);
        }
        if (this.pendingFactUpserts.length > 0 && !this.factUpsertFlushScheduled) {
            this.factUpsertFlushScheduled = true;
            queueMicrotask(() => void this.flushFactUpserts());
        }
    }

    private async initSchema() {
        await this.rawCallWorker("exec", { sql: `
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA cache_size = -64000;
            CREATE TABLE IF NOT EXISTS episodes (id TEXT PRIMARY KEY, content TEXT NOT NULL, timestamp INTEGER NOT NULL, role TEXT NOT NULL, consolidated BOOLEAN DEFAULT 0, importance_importance REAL, importance_surprise REAL, importance_emotion REAL, importance_utility REAL, encoding_context TEXT);
            CREATE INDEX IF NOT EXISTS idx_episodes_timestamp ON episodes(timestamp);
            CREATE TABLE IF NOT EXISTS facts (id TEXT PRIMARY KEY, base_id TEXT NOT NULL, content TEXT NOT NULL, entities TEXT, topics TEXT, importance REAL, max_emotion REAL, strength REAL, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_accessed INTEGER NOT NULL, recall_count INTEGER DEFAULT 0, valid_from INTEGER NOT NULL, valid_to INTEGER, successor_id TEXT, supersedes TEXT, source_episodes TEXT, encoding_context TEXT, structured_fact TEXT);
            CREATE INDEX IF NOT EXISTS idx_facts_base_id ON facts(base_id);
            CREATE INDEX IF NOT EXISTS idx_facts_status ON facts(status);
            CREATE VIRTUAL TABLE IF NOT EXISTS facts_time_idx USING rtree(id, min_ts, max_ts);
            CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(content, entities, topics);
            CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts_hot USING fts5(content, entities, topics);
            CREATE TABLE IF NOT EXISTS id_map (fid INTEGER PRIMARY KEY, fact_id TEXT UNIQUE);
            CREATE TABLE IF NOT EXISTS epochs (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, start_time INTEGER NOT NULL, end_time INTEGER, source_episode_id TEXT);
            CREATE TABLE IF NOT EXISTS kg_nodes (name TEXT PRIMARY KEY, frequency INTEGER DEFAULT 1, last_seen INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS kg_edges (source TEXT NOT NULL, target TEXT NOT NULL, weight REAL DEFAULT 0.05, last_strengthened INTEGER NOT NULL, PRIMARY KEY (source, target));
            CREATE TABLE IF NOT EXISTS skills (name TEXT PRIMARY KEY, description TEXT, usage_count INTEGER DEFAULT 0, success_count INTEGER DEFAULT 0, last_used INTEGER);
            CREATE TABLE IF NOT EXISTS reflections (id TEXT PRIMARY KEY, content TEXT NOT NULL, timestamp INTEGER NOT NULL, importance REAL);
            CREATE TABLE IF NOT EXISTS memory_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            INSERT OR IGNORE INTO memory_metadata (key, value) VALUES ('facts_generation', '0');
        `});
        const dimensions = this.embedder?.dims ?? 3072;
        const vectorSchema = await this.rawCallWorker("prepare-get", { sql: "SELECT sql FROM sqlite_master WHERE name = 'vec_facts'", params: [] });
        if (!vectorSchema) {
            await this.rawCallWorker("exec", { sql: `CREATE VIRTUAL TABLE vec_facts USING vec0(fact_id TEXT PRIMARY KEY, embedding float[${dimensions}]); CREATE VIRTUAL TABLE vec_facts_hot USING vec0(fact_id TEXT PRIMARY KEY, embedding float[${dimensions}]);` });
        }
        const factColumns = await this.rawCallWorker("prepare-all", { sql: "PRAGMA table_info(facts)", params: [] });
        if (!factColumns.some((column: { name: string }) => column.name === "structured_fact")) {
            await this.rawCallWorker("exec", { sql: "ALTER TABLE facts ADD COLUMN structured_fact TEXT" });
        }
        if (this.embedder) {
            if (!this.embedder.embeddingSpaceId) {
                throw new Error("SQLite embedding provider must declare an immutable embeddingSpaceId");
            }
            const stored = await this.rawCallWorker("prepare-get", {
                sql: "SELECT value FROM memory_metadata WHERE key = 'embedding_space_id'", params: [],
            });
            const population = await this.rawCallWorker("prepare-get", {
                sql: "SELECT count(*) AS count FROM vec_facts", params: [],
            });
            const factPopulation = await this.rawCallWorker("prepare-get", { sql: "SELECT count(*) AS count FROM facts", params: [] });
            const storedDimensions = await this.rawCallWorker("prepare-get", { sql: "SELECT value FROM memory_metadata WHERE key = 'embedding_dimensions'", params: [] });
            const schemaDimensions = Number(String(vectorSchema?.sql ?? "").match(/embedding float\[(\d+)\]/i)?.[1] ?? dimensions);
            const vectorsIncomplete = Number(population?.count ?? 0) !== Number(factPopulation?.count ?? 0);
            const needsReindex = (
                vectorsIncomplete || !stored || stored.value !== this.embedder.embeddingSpaceId
                || Number(storedDimensions?.value ?? schemaDimensions) !== this.embedder.dims
                || schemaDimensions !== this.embedder.dims
            );
            const populatedMigration = Number(factPopulation?.count ?? 0) > 0 && needsReindex;
            if (populatedMigration && !this.reindexEmbeddingsOnMismatch) {
                throw new Error(stored
                    ? `SQLite embedding-space mismatch: stored=${stored.value}, configured=${this.embedder.embeddingSpaceId}`
                    : "SQLite vectors have no embedding-space identity; explicit reindex is required");
            }
            if (needsReindex) {
                const generationRow = await this.rawCallWorker("prepare-get", { sql: "SELECT value FROM memory_metadata WHERE key = 'facts_generation'", params: [] });
                const facts = await this.rawCallWorker("prepare-all", {
                    sql: "SELECT id, content, strength, status FROM facts ORDER BY id", params: [],
                });
                const vectors = await this.embedder.embedBatch(facts.map((fact: any) => fact.content));
                if (vectors.length !== facts.length || vectors.some((vector) => vector.length !== this.embedder!.dims || vector.some((value) => !Number.isFinite(value)))) {
                    throw new Error("SQLite embedding reindex returned invalid vectors");
                }
                await this.rawCallWorker("replace-vectors", {
                    expectedGeneration: Number(generationRow?.value ?? 0), dims: this.embedder.dims,
                    embeddingSpaceId: this.embedder.embeddingSpaceId,
                    vectors: facts.map((fact: any, index: number) => ({ factId: fact.id, hot: fact.strength > 0.6 && fact.status === "active", embedding: Buffer.from(new Float32Array(vectors[index]).buffer) })),
                });
            }
            if (!stored && !needsReindex) {
                await this.rawCallWorker("transaction", { ops: [
                    { sql: "INSERT OR REPLACE INTO memory_metadata (key, value) VALUES ('embedding_space_id', ?)", params: [this.embedder.embeddingSpaceId] },
                    { sql: "INSERT OR REPLACE INTO memory_metadata (key, value) VALUES ('embedding_dimensions', ?)", params: [String(this.embedder.dims)] },
                ]
                });
            }
        }
    }

    episode = {
        store: async (event: Episode): Promise<void> => {
            await this.callWorker("prepare-run", {
                sql: "INSERT OR REPLACE INTO episodes (id, content, timestamp, role, consolidated, importance_importance, importance_surprise, importance_emotion, importance_utility, encoding_context) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params: [event.id, event.content, event.timestamp, event.role, event.consolidated ? 1 : 0, event.importance?.importance, event.importance?.surprise, event.importance?.emotion, event.importance?.utility, JSON.stringify(event.encodingContext)]
            });
        },
        recall: async (query: string, context: RecallContext): Promise<Episode[]> => {
            const strictProjectScope = context.scopeMode === "strict" && !context.crossProject;
            const scopeSql = strictProjectScope
                ? context.project
                    ? " AND json_extract(encoding_context, '$.project') = ?"
                    : " AND json_extract(encoding_context, '$.project') IS NULL"
                : "";
            const rows = await this.callWorker("prepare-all", {
                sql: `SELECT * FROM episodes WHERE content LIKE ?${scopeSql} ORDER BY timestamp DESC LIMIT ?`,
                params: [
                    `%${query}%`,
                    ...(strictProjectScope && context.project ? [context.project] : []),
                    context.topK ?? 10,
                ]
            });
            return rows.map((r: any) => this.rowToEpisode(r));
        },
        getRecent: async (n: number): Promise<Episode[]> => {
            const rows = await this.callWorker("prepare-all", { sql: "SELECT * FROM episodes ORDER BY timestamp DESC LIMIT ?", params: [n] });
            return rows.map((r: any) => this.rowToEpisode(r));
        },
        getUnconsolidated: async (): Promise<Episode[]> => {
            const rows = await this.callWorker("prepare-all", { sql: "SELECT * FROM episodes WHERE consolidated = 0 ORDER BY timestamp ASC", params: [] });
            return rows.map((r: any) => this.rowToEpisode(r));
        },
        markConsolidated: async (ids: string[]): Promise<void> => {
            await this.callWorker("transaction", {
                ops: ids.map(id => ({ sql: "UPDATE episodes SET consolidated = 1 WHERE id = ?", params: [id] }))
            });
        }
    };

    semantic = {
        upsert: async (fact: Fact): Promise<void> => {
            const baseId = fact.id.replace(/(-v\d+)+$/, "");
            const vector = this.embedder ? (await this.embedder.embedBatch([fact.content]))[0] : undefined;
            if (this.embedder && (!vector || vector.length !== this.embedder.dims || vector.some((value) => !Number.isFinite(value)))) throw new Error("SQLite fact embedding returned an invalid vector");
            await this.enqueueFactUpsert({
                factId: fact.id, minTs: fact.validFrom ?? fact.createdAt, maxTs: fact.validTo ?? 253402300799000,
                content: fact.content, entities: fact.entities.join(" "), topics: fact.topics.join(" "),
				hot: fact.strength > 0.6 && fact.status === "active",
                vector: vector ? Buffer.from(new Float32Array(vector).buffer) : null,
                factSql: `INSERT OR REPLACE INTO facts (id, base_id, content, entities, topics, importance, max_emotion, strength, status, created_at, updated_at, last_accessed, recall_count, valid_from, valid_to, successor_id, supersedes, source_episodes, encoding_context, structured_fact) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                factParams: [fact.id, baseId, fact.content, JSON.stringify(fact.entities), JSON.stringify(fact.topics), fact.importance, fact.maxEmotion, fact.strength, fact.status, fact.createdAt, fact.updatedAt, fact.lastAccessed, fact.recallCount, fact.validFrom ?? fact.createdAt, fact.validTo, fact.successorId, fact.supersedes, JSON.stringify(fact.sourceEpisodes || []), JSON.stringify(fact.encodingContext), JSON.stringify(fact.structured ?? null)],
            });
            this.kgDirty = true;
        },
        search: async (query: string, topK: number, deepRecall = false, context?: RecallContext): Promise<Fact[]> => {
            const start = performance.now();
            const queryVec = query.length > 0 && this.embedder ? await this.embedder.embed(query) : null;
            
            const isBiTemporal = context?.mode === "at-time" || context?.atTimestamp !== undefined;
			const isHistoricalMode = context?.mode === "history";
            const useHot = !deepRecall && !context?.epochAnchor && !isBiTemporal && !isHistoricalMode && query.length > 0;
            const limit = topK * 10;
            
            const ftsTable = useHot ? "facts_fts_hot" : "facts_fts";
            const vecTable = useHot ? "vec_facts_hot" : "vec_facts";
			const strictScope = context?.scopeMode === "strict" && !context.crossProject;
			const includeHistorical = isHistoricalMode || deepRecall || isBiTemporal;
			const candidateLifecycleSql = includeHistorical ? "" : " AND f.status = 'active'";
			const candidateScopeSql = strictScope
				? context?.project
					? " AND json_extract(f.encoding_context, '$.project') = ?"
					: " AND json_extract(f.encoding_context, '$.project') IS NULL"
				: "";
			const candidateScopeParams = strictScope && context?.project ? [context.project] : [];

            const ftsRows = query.length > 0 ? await this.callWorker("prepare-all", { 
				sql: `SELECT ft.rowid, bm25(${ftsTable}) as score
					FROM ${ftsTable} ft
					JOIN id_map m ON m.fid = ft.rowid
					JOIN facts f ON f.id = m.fact_id
						WHERE ${ftsTable} MATCH ?${candidateScopeSql}${candidateLifecycleSql}
					ORDER BY bm25(${ftsTable}) LIMIT ?`,
				params: [tokenize(normalize(query)).filter(Boolean).map(t => `"${t.replace(/"/g, '""')}"*`).join(" OR "), ...candidateScopeParams, limit]
            }) : [];

			let vecRows: Array<{ fact_id: string; distance: number }> = [];
			if (queryVec && strictScope) {
				const scopedVectors = await this.callWorker("prepare-all", {
					// A global ANN window cannot guarantee strict project recall: enough
					// foreign or newer scoped rows can starve an older valid match. Exact
					// search over the already project/lifecycle-filtered partition keeps
					// strict scope a correctness contract rather than a 1,000-row heuristic.
					sql: `SELECT v.fact_id, v.embedding FROM ${vecTable} v JOIN facts f ON f.id = v.fact_id WHERE 1=1${candidateScopeSql}${candidateLifecycleSql}`,
					params: candidateScopeParams,
				});
				vecRows = scopedVectors.map((row: any) => {
					const bytes = Buffer.isBuffer(row.embedding) ? row.embedding : Buffer.from(row.embedding);
					const vector = Array.from(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4));
					const squared = vector.reduce((sum, value, index) => sum + (value - queryVec[index]) ** 2, 0);
					return { fact_id: row.fact_id, distance: Math.sqrt(squared) };
				}).sort((a: { distance: number }, b: { distance: number }) => a.distance - b.distance).slice(0, limit);
			} else if (queryVec) vecRows = await this.callWorker("prepare-all", {
				sql: `SELECT v.fact_id, v.distance FROM ${vecTable} v
					WHERE v.embedding MATCH ? AND v.k = ?
					ORDER BY v.distance`,
				params: [Buffer.from(new Float32Array(queryVec).buffer), limit]
			});

            // Application-level RRF merge
            const rrfMap = new Map<string, number>();
            if (ftsRows.length > 0) {
                const resolved = await this.callWorker("prepare-all", { 
                    sql: `SELECT rowid, fact_id FROM id_map WHERE fid IN (${ftsRows.map((r: any) => r.rowid).join(",")})`, 
                    params: [] 
                });
                const ranks = new Map<number, number>(ftsRows.map((row: any, index: number) => [Number(row.rowid), index + 1]));
                resolved.forEach((r: any) => rrfMap.set(r.fact_id, 1.0 / (60 + (ranks.get(r.rowid) ?? limit))));
            }
            vecRows.forEach((r: any, i: number) => rrfMap.set(r.fact_id, (rrfMap.get(r.fact_id) || 0) + 1.0 / (60 + (i + 1))));

            const hasMatches = rrfMap.size > 0;
            if (query.length > 0 && !hasMatches && !isBiTemporal) return [];

            let gate = "WHERE 1=1";
            const gateParams: any[] = [];
            if (hasMatches) {
                const ids = Array.from(rrfMap.entries()).sort((a, b) => b[1] - a[1])
					.slice(0, Math.max(50, topK)).map(([id]) => id);
                gate += ` AND id IN (${ids.map(() => "?").join(",")})`;
                gateParams.push(...ids);
            }
			if (isBiTemporal) {
                const t = context?.atTimestamp ?? Date.now();
                gate += " AND rowid IN (SELECT id FROM facts_time_idx WHERE min_ts <= ? AND max_ts >= ?)";
                gateParams.push(t, t);
			}
			// Hot indexes only contain active facts. Re-applying this predicate makes
			// SQLite scan idx_facts_status instead of fetching the small ID set by PK.
			if (!includeHistorical && !useHot) gate += " AND status = 'active'";
            if (context?.scopeMode === "strict" && !context.crossProject) {
                if (context.project) {
                    gate += " AND json_extract(encoding_context, '$.project') = ?";
                    gateParams.push(context.project);
                } else {
                    gate += " AND json_extract(encoding_context, '$.project') IS NULL";
                }
            }

            const rows = await this.callWorker("prepare-all", { sql: `SELECT * FROM facts ${gate}`, params: gateParams });
            
            // KG state would be loaded from worker here...
            
            return rows.map((r: any) => this.rowToFact(r, rrfMap.get(r.id) || 0))
                .sort((a: any, b: any) => (b.relevanceScore || 0) - (a.relevanceScore || 0)).slice(0, topK);
        },
        decay: async (now: number): Promise<number> => { return 0; /* Decay implementation in worker */ },
        associate: async (entityA: string, entityB: string, weight = 0.05): Promise<void> => {},
        getAll: async (): Promise<Fact[]> => {
            const rows = await this.callWorker("prepare-all", { sql: "SELECT * FROM facts", params: [] });
            return rows.map((r: any) => this.rowToFact(r));
        },
        delete: async (id: string): Promise<boolean> => this.callWorker("archive-fact", { factId: id })
    };

    procedural = {
        getSkill: async (name: string): Promise<Skill | null> => { return null; },
        recordOutcome: async (name: string, success: boolean): Promise<void> => {},
        learnFromFailure: async (reflection: Reflection): Promise<void> => {},
        getReflections: async (task: string, topK: number): Promise<Reflection[]> => { return []; }
    };

    async upsertEpoch(epoch: Epoch): Promise<void> {}
    async getEpochs(): Promise<Epoch[]> { return []; }
    async getHubs(): Promise<Record<string, { frequency: number }>> { return {}; }
    async getKGState(): Promise<any> { return emptyKGState(); }
    async consolidate(): Promise<ConsolidationResult> { return { episodesProcessed: 0, factsCreated: 0, factsUpdated: 0, memoriesPruned: 0, associationsUpdated: 0 }; }
    async export(password: string): Promise<Uint8Array> { return new Uint8Array(0); }
    async import(blob: Uint8Array, password: string): Promise<void> {}
    async close(): Promise<void> { if (this.closed) return; await this.initialization.catch(() => undefined); this.closed = true; for (const pending of this.pendingMsgs.values()) pending.reject(new Error("SQLite adapter is closed")); this.pendingMsgs.clear(); await this.worker.terminate(); }
    // NOTE(WIP): SqliteAdapter episode 스키마는 summary/recall_count/last_accessed/strength 미저장 → 기본값 복원(비손실 round-trip은 후속). LocalAdapter 가 완전한 기본 경로.
    private rowToEpisode(r: any): Episode { return { id: r.id, content: r.content, summary: r.summary ?? r.content, timestamp: r.timestamp, role: r.role as any, consolidated: !!r.consolidated, recallCount: r.recall_count ?? 0, lastAccessed: r.last_accessed ?? r.timestamp, strength: r.strength ?? 1, importance: { importance: r.importance_importance ?? 0, surprise: r.importance_surprise ?? 0, emotion: r.importance_emotion ?? 0, utility: r.importance_utility ?? 0 }, encodingContext: JSON.parse(r.encoding_context || "{}") }; }
    private rowToFact(r: any, score?: number): Fact { return { id: r.id, content: r.content, entities: JSON.parse(r.entities || "[]"), topics: JSON.parse(r.topics || "[]"), importance: r.importance, maxEmotion: r.max_emotion, strength: r.strength, status: r.status as any, createdAt: r.created_at, updatedAt: r.updated_at, lastAccessed: r.last_accessed, recallCount: r.recall_count, validFrom: r.valid_from, validTo: r.valid_to, successorId: r.successor_id, supersedes: r.supersedes, sourceEpisodes: JSON.parse(r.source_episodes || "[]"), encodingContext: JSON.parse(r.encoding_context || "{}"), structured: r.structured_fact ? JSON.parse(r.structured_fact) as StructuredFact : undefined, relevanceScore: score }; }
}
