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
} from "../types.js";

const pbkdf2Async = promisify(pbkdf2);
const __dirname = dirname(fileURLToPath(import.meta.url));

export interface SqliteAdapterOptions {
    dbPath: string;
    embeddingProvider?: EmbeddingProvider | null;
}

export class SqliteAdapter implements MemoryAdapter, BackupCapable {
    private readonly worker: Worker;
    private readonly embedder: EmbeddingProvider | null;
    private kgCache: any = null;
    private kgDirty = true;
    private nextMsgId = 1;
    private pendingMsgs = new Map<number, { resolve: (res: any) => void; reject: (err: any) => void }>();

    constructor(options: SqliteAdapterOptions) {
        const dir = dirname(options.dbPath);
        if (dir !== "." && !existsSync(dir)) mkdirSync(dir, { recursive: true });
        this.embedder = options.embeddingProvider ?? null;
        
        // Initialize Background Worker
        this.worker = new Worker(new URL("./sqlite-worker.js", import.meta.url), {
            workerData: { dbPath: options.dbPath }
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

        this.initSchema();
    }

    private async callWorker(type: string, payload: any): Promise<any> {
        const id = this.nextMsgId++;
        return new Promise((resolve, reject) => {
            this.pendingMsgs.set(id, { resolve, reject });
            this.worker.postMessage({ id, type, payload });
        });
    }

    private async initSchema() {
        await this.callWorker("exec", { sql: `
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA cache_size = -64000;
            CREATE TABLE IF NOT EXISTS episodes (id TEXT PRIMARY KEY, content TEXT NOT NULL, timestamp INTEGER NOT NULL, role TEXT NOT NULL, consolidated BOOLEAN DEFAULT 0, importance_importance REAL, importance_surprise REAL, importance_emotion REAL, importance_utility REAL, encoding_context TEXT);
            CREATE INDEX IF NOT EXISTS idx_episodes_timestamp ON episodes(timestamp);
            CREATE TABLE IF NOT EXISTS facts (id TEXT PRIMARY KEY, base_id TEXT NOT NULL, content TEXT NOT NULL, entities TEXT, topics TEXT, importance REAL, max_emotion REAL, strength REAL, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_accessed INTEGER NOT NULL, recall_count INTEGER DEFAULT 0, valid_from INTEGER NOT NULL, valid_to INTEGER, successor_id TEXT, supersedes TEXT, source_episodes TEXT, encoding_context TEXT);
            CREATE INDEX IF NOT EXISTS idx_facts_base_id ON facts(base_id);
            CREATE INDEX IF NOT EXISTS idx_facts_status ON facts(status);
            CREATE VIRTUAL TABLE IF NOT EXISTS facts_time_idx USING rtree(id, min_ts, max_ts);
            CREATE VIRTUAL TABLE IF NOT EXISTS vec_facts USING vec0(fact_id TEXT PRIMARY KEY, embedding float[${this.embedder?.dims ?? 3072}]);
            CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(content, entities, topics);
            CREATE VIRTUAL TABLE IF NOT EXISTS vec_facts_hot USING vec0(fact_id TEXT PRIMARY KEY, embedding float[${this.embedder?.dims ?? 3072}]);
            CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts_hot USING fts5(content, entities, topics);
            CREATE TABLE IF NOT EXISTS id_map (fid INTEGER PRIMARY KEY, fact_id TEXT UNIQUE);
            CREATE TABLE IF NOT EXISTS epochs (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, start_time INTEGER NOT NULL, end_time INTEGER, source_episode_id TEXT);
            CREATE TABLE IF NOT EXISTS kg_nodes (name TEXT PRIMARY KEY, frequency INTEGER DEFAULT 1, last_seen INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS kg_edges (source TEXT NOT NULL, target TEXT NOT NULL, weight REAL DEFAULT 0.05, last_strengthened INTEGER NOT NULL, PRIMARY KEY (source, target));
            CREATE TABLE IF NOT EXISTS skills (name TEXT PRIMARY KEY, description TEXT, usage_count INTEGER DEFAULT 0, success_count INTEGER DEFAULT 0, last_used INTEGER);
            CREATE TABLE IF NOT EXISTS reflections (id TEXT PRIMARY KEY, content TEXT NOT NULL, timestamp INTEGER NOT NULL, importance REAL);
        `});
    }

    episode = {
        store: async (event: Episode): Promise<void> => {
            await this.callWorker("prepare-run", {
                sql: "INSERT INTO episodes (id, content, timestamp, role, consolidated, importance_importance, importance_surprise, importance_emotion, importance_utility, encoding_context) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params: [event.id, event.content, event.timestamp, event.role, event.consolidated ? 1 : 0, event.importance?.importance, event.importance?.surprise, event.importance?.emotion, event.importance?.utility, JSON.stringify(event.encodingContext)]
            });
        },
        recall: async (query: string, context: RecallContext): Promise<Episode[]> => {
            const rows = await this.callWorker("prepare-all", {
                sql: "SELECT * FROM episodes WHERE content LIKE ? ORDER BY timestamp DESC LIMIT ?",
                params: [`%${query}%`, context.topK ?? 10]
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
            const now = Date.now();
            const baseId = fact.id.replace(/(-v\d+)+$/, "");
            const ops = [];
            
            // P1-1 Fix: Consistent rowid removal
            ops.push({ sql: "DELETE FROM id_map WHERE fact_id = ?", params: [fact.id] }); // Will be re-added
            
            ops.push({ 
                sql: `INSERT OR REPLACE INTO facts (id, base_id, content, entities, topics, importance, max_emotion, strength, status, created_at, updated_at, last_accessed, recall_count, valid_from, valid_to, successor_id, supersedes, source_episodes, encoding_context) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                params: [fact.id, baseId, fact.content, JSON.stringify(fact.entities), JSON.stringify(fact.topics), fact.importance, fact.maxEmotion, fact.strength, fact.status, fact.createdAt, fact.updatedAt, fact.lastAccessed, fact.recallCount, fact.validFrom ?? fact.createdAt, fact.validTo, fact.successorId, fact.supersedes, JSON.stringify(fact.sourceEpisodes || []), JSON.stringify(fact.encodingContext)]
            });
            
            // KG update ops would go here but we simplify for worker POC
            await this.callWorker("transaction", { ops });
            
            const lastRow = await this.callWorker("prepare-get", { sql: "SELECT last_insert_rowid() as rowid", params: [] });
            const rowid = lastRow.rowid;
            
            await this.callWorker("transaction", { ops: [
                { sql: "INSERT OR REPLACE INTO id_map (fid, fact_id) VALUES (?, ?)", params: [rowid, fact.id] },
                { sql: "INSERT OR REPLACE INTO facts_time_idx (id, min_ts, max_ts) VALUES (?, ?, ?)", params: [rowid, fact.validFrom ?? fact.createdAt, fact.validTo ?? 253402300799000] },
                { sql: "INSERT OR REPLACE INTO facts_fts (rowid, content, entities, topics) VALUES (?, ?, ?, ?)", params: [rowid, fact.content, fact.entities.join(" "), fact.topics.join(" ")] }
            ]});

            if (this.embedder) {
                const vector = await this.embedder.embed(fact.content);
                if (vector) {
                    const vBlob = Buffer.from(new Float32Array(vector).buffer);
                    await this.callWorker("prepare-run", { sql: "INSERT OR REPLACE INTO vec_facts (fact_id, embedding) VALUES (?, ?)", params: [fact.id, vBlob] });
                    if (fact.strength > 0.6) await this.callWorker("prepare-run", { sql: "INSERT OR REPLACE INTO vec_facts_hot (fact_id, embedding) VALUES (?, ?)", params: [fact.id, vBlob] });
                }
            }
            this.kgDirty = true;
        },
        search: async (query: string, topK: number, deepRecall = false, context?: RecallContext): Promise<Fact[]> => {
            const start = performance.now();
            const queryVec = query.length > 0 && this.embedder ? await this.embedder.embed(query) : null;
            
            const isBiTemporal = context?.mode === "at-time" || context?.atTimestamp !== undefined;
            const useHot = !deepRecall && !context?.epochAnchor && !isBiTemporal && query.length > 0;
            const limit = topK * 10;
            
            const ftsTable = useHot ? "facts_fts_hot" : "facts_fts";
            const vecTable = useHot ? "vec_facts_hot" : "vec_facts";

            const ftsRows = query.length > 0 ? await this.callWorker("prepare-all", { 
                sql: `SELECT rowid, bm25(${ftsTable}) as score FROM ${ftsTable} WHERE ${ftsTable} MATCH ? ORDER BY bm25(${ftsTable}) LIMIT ?`, 
                params: [query.replace(/[^\w\s]/g, " ").trim().split(/\s+/).map(t => `${t}*`).join(" OR "), limit] 
            }) : [];

            const vecRows = queryVec ? await this.callWorker("prepare-all", {
                sql: `SELECT fact_id, distance FROM ${vecTable} WHERE embedding MATCH ? AND k = ?`,
                params: [Buffer.from(new Float32Array(queryVec).buffer), limit]
            }) : [];

            // Application-level RRF merge
            const rrfMap = new Map<string, number>();
            if (ftsRows.length > 0) {
                const resolved = await this.callWorker("prepare-all", { 
                    sql: `SELECT rowid, fact_id FROM id_map WHERE fid IN (${ftsRows.map((r: any) => r.rowid).join(",")})`, 
                    params: [] 
                });
                resolved.forEach((r: any, i: number) => rrfMap.set(r.fact_id, 1.0 / (60 + (i + 1))));
            }
            vecRows.forEach((r: any, i: number) => rrfMap.set(r.fact_id, (rrfMap.get(r.fact_id) || 0) + 1.0 / (60 + (i + 1))));

            const hasMatches = rrfMap.size > 0;
            if (query.length > 0 && !hasMatches && !isBiTemporal) return [];

            let gate = "WHERE 1=1";
            const gateParams: any[] = [];
            if (hasMatches) {
                const ids = Array.from(rrfMap.keys()).slice(0, 50);
                gate += ` AND id IN (${ids.map(() => "?").join(",")})`;
                gateParams.push(...ids);
            }
            if (isBiTemporal) {
                const t = context?.atTimestamp ?? Date.now();
                gate += " AND rowid IN (SELECT id FROM facts_time_idx WHERE min_ts <= ? AND max_ts >= ?)";
                gateParams.push(t, t);
            }

            const rows = await this.callWorker("prepare-all", { sql: `SELECT * FROM facts ${gate} LIMIT ?`, params: [...gateParams, topK * 2] });
            
            // KG state would be loaded from worker here...
            
            return rows.map((r: any) => this.rowToFact(r, rrfMap.get(r.id) || 0))
                .sort((a: any, b: any) => (b.relevanceScore || 0) - (a.relevanceScore || 0)).slice(0, topK);
        },
        decay: async (now: number): Promise<number> => { return 0; /* Decay implementation in worker */ },
        associate: async (entityA: string, entityB: string, weight = 0.05): Promise<void> => {},
        getAll: async (): Promise<Fact[]> => { return []; },
        delete: async (id: string): Promise<boolean> => { return true; }
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
    async close(): Promise<void> { await this.worker.terminate(); }
    // NOTE(WIP): SqliteAdapter episode 스키마는 summary/recall_count/last_accessed/strength 미저장 → 기본값 복원(비손실 round-trip은 후속). LocalAdapter 가 완전한 기본 경로.
    private rowToEpisode(r: any): Episode { return { id: r.id, content: r.content, summary: r.summary ?? r.content, timestamp: r.timestamp, role: r.role as any, consolidated: !!r.consolidated, recallCount: r.recall_count ?? 0, lastAccessed: r.last_accessed ?? r.timestamp, strength: r.strength ?? 1, importance: { importance: r.importance_importance ?? 0, surprise: r.importance_surprise ?? 0, emotion: r.importance_emotion ?? 0, utility: r.importance_utility ?? 0 }, encodingContext: JSON.parse(r.encoding_context || "{}") }; }
    private rowToFact(r: any, score?: number): Fact { return { id: r.id, content: r.content, entities: JSON.parse(r.entities || "[]"), topics: JSON.parse(r.topics || "[]"), importance: r.importance, maxEmotion: r.max_emotion, strength: r.strength, status: r.status as any, createdAt: r.created_at, updatedAt: r.updated_at, lastAccessed: r.last_accessed, recallCount: r.recall_count, validFrom: r.valid_from, validTo: r.valid_to, successorId: r.successor_id, supersedes: r.supersedes, sourceEpisodes: JSON.parse(r.source_episodes || "[]"), encodingContext: JSON.parse(r.encoding_context || "{}"), relevanceScore: score }; }
}
