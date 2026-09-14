import { Worker } from "node:worker_threads";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, existsSync } from "node:fs";
import { calculateStrength } from "../decay.js";
import type { EmbeddingProvider } from "../embeddings.js";
import { tokenize, normalize } from "../ko-normalize.js";
import { keywordScore } from "./local-search.js";
import { decodeLocalBackup, encodeLocalBackup } from "./local-backup.js";
import { normalizeMemoryStore, type MemoryStore } from "./local-model.js";
import { KnowledgeGraph, type KGState } from "../knowledge-graph.js";
import type {
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAX_FACT_UPSERT_BATCH = 1000;
const FLASHBULB_SQL = "ABS((COALESCE(max_emotion, 0.5) - 0.5) * 2) >= 0.6";

type SqliteBackupVectorRow = {
    factId: string;
    embedding: number[];
    hot: boolean;
};

type SqliteBackupSnapshot = {
    schemaVersion: number;
    factsGeneration: number;
    episodes: Array<Record<string, unknown>>;
    facts: Array<Record<string, unknown>>;
    epochs: Array<Record<string, unknown>>;
    skills: Array<Record<string, unknown>>;
    reflections: Array<Record<string, unknown>>;
    kgNodes: Array<Record<string, unknown>>;
    kgEdges: Array<Record<string, unknown>>;
    associations: Array<Record<string, unknown>>;
    vectors: {
        dimensions: number | null;
        embeddingSpaceId?: string;
        facts: SqliteBackupVectorRow[];
    };
};

type SqliteBackupTarget = {
    schemaVersion: number;
    schemaDimensions: number | null;
    embeddingDimensions: number | null;
    embeddingSpaceId?: string;
};

type SqliteBackupExport = {
    snapshot: SqliteBackupSnapshot;
    target: SqliteBackupTarget;
};

type SqliteBackupStore = MemoryStore & {
    sqliteBackup: {
        version: 1;
        target: SqliteBackupTarget;
        snapshot: SqliteBackupSnapshot;
    };
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonRoundtrip<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

/** Compare persisted public state independently of JSON object key order. */
function canonicalJson(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (isRecord(value)) {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

function isPositiveSafeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validateOptionalDimension(value: unknown, name: string): number | null {
    if (value === null) return null;
    if (!isPositiveSafeInteger(value)) {
        throw new Error(`SQLite backup ${name} is invalid`);
    }
    return value;
}

function validateSqliteBackupEnvelope(
    store: MemoryStore,
    projectSnapshot: (snapshot: SqliteBackupSnapshot) => MemoryStore,
): SqliteBackupExport {
    const sidecar = (store as MemoryStore & { sqliteBackup?: unknown }).sqliteBackup;
    if (!isRecord(sidecar) || sidecar.version !== 1) {
        throw new Error("Invalid SQLite backup sidecar");
    }
    if (!isRecord(sidecar.target) || !isRecord(sidecar.snapshot)) {
        throw new Error("Invalid SQLite backup sidecar");
    }

    const targetRecord = sidecar.target;
    if (!isPositiveSafeInteger(targetRecord.schemaVersion)) {
        throw new Error("SQLite backup target schema version is invalid");
    }
    const target: SqliteBackupTarget = {
        schemaVersion: targetRecord.schemaVersion,
        schemaDimensions: validateOptionalDimension(
            targetRecord.schemaDimensions,
            "target schema dimensions",
        ),
        embeddingDimensions: validateOptionalDimension(
            targetRecord.embeddingDimensions,
            "target embedding dimensions",
        ),
        ...(targetRecord.embeddingSpaceId === undefined
            ? {}
            : typeof targetRecord.embeddingSpaceId === "string" && targetRecord.embeddingSpaceId.length > 0
                ? { embeddingSpaceId: targetRecord.embeddingSpaceId }
                : (() => { throw new Error("SQLite backup target embedding space is invalid"); })()),
    };

    const snapshotRecord = sidecar.snapshot;
    if (snapshotRecord.schemaVersion !== target.schemaVersion) {
        throw new Error("SQLite backup snapshot and target schema versions differ");
    }
    for (const collection of [
        "episodes",
        "facts",
        "epochs",
        "skills",
        "reflections",
        "kgNodes",
        "kgEdges",
        "associations",
    ]) {
        const rows = snapshotRecord[collection];
        if (!Array.isArray(rows) || rows.some((row) => !isRecord(row))) {
            throw new Error(`SQLite backup ${collection} are invalid`);
        }
    }
    if (!isRecord(snapshotRecord.vectors) || !Array.isArray(snapshotRecord.vectors.facts)) {
        throw new Error("SQLite backup vectors are invalid");
    }
    if (snapshotRecord.vectors.facts.some((row) => !isRecord(row))) {
        throw new Error("SQLite backup vector rows are invalid");
    }
    const snapshotDimensions = validateOptionalDimension(
        snapshotRecord.vectors.dimensions,
        "vector dimensions",
    );
    const snapshotSpace = snapshotRecord.vectors.embeddingSpaceId;
    if (snapshotSpace !== undefined && (typeof snapshotSpace !== "string" || snapshotSpace.length === 0)) {
        throw new Error("SQLite backup vector embedding space is invalid");
    }
    if (snapshotDimensions !== target.embeddingDimensions || snapshotSpace !== target.embeddingSpaceId) {
        throw new Error("SQLite backup vector identity does not match target");
    }

    const rawStore = store as MemoryStore & {
        episodeEmbeddings?: unknown;
    };
    if (
        rawStore.episodeEmbeddings !== undefined
        && (!isRecord(rawStore.episodeEmbeddings)
            || Object.keys(rawStore.episodeEmbeddings).length > 0)
    ) {
        throw new Error("SQLite backup episode embeddings are unsupported");
    }

    // The authenticated sidecar is the source of truth for SQLite's raw
    // rows. Verify that its public projection is exactly the public store
    // carried alongside it before any worker transaction can mutate data.
    try {
        const projected = normalizeMemoryStore(
            jsonRoundtrip(projectSnapshot(snapshotRecord as unknown as SqliteBackupSnapshot)),
        );
        const publicStore = { ...rawStore } as MemoryStore & { sqliteBackup?: unknown };
        delete publicStore.sqliteBackup;
        const decodedPublic = normalizeMemoryStore(jsonRoundtrip(publicStore));
        if (!projected || !decodedPublic || canonicalJson(projected) !== canonicalJson(decodedPublic)) {
            throw new Error("SQLite backup public projection does not match authenticated snapshot");
        }
    } catch (error) {
        if (error instanceof Error && error.message === "SQLite backup public projection does not match authenticated snapshot") {
            throw error;
        }
        throw new Error("SQLite backup public projection is invalid");
    }

    return {
        snapshot: snapshotRecord as unknown as SqliteBackupSnapshot,
        target,
    };
}

function sameSqliteBackupTarget(left: SqliteBackupTarget, right: SqliteBackupTarget): boolean {
    return left.schemaVersion === right.schemaVersion
        && left.schemaDimensions === right.schemaDimensions
        && left.embeddingDimensions === right.embeddingDimensions
        && left.embeddingSpaceId === right.embeddingSpaceId;
}

function isFlashbulbRow(row: any): boolean {
    return Math.abs((row.max_emotion ?? 0.5) - 0.5) * 2 >= 0.6;
}

export interface SqliteAdapterOptions {
    dbPath: string;
    embeddingProvider?: EmbeddingProvider | null;
    /** Explicitly rebuild persisted vectors when their embedding identity differs. */
    reindexEmbeddingsOnMismatch?: boolean;
    /**
     * Optional SQLite read mapping size in bytes. Zero (the default) leaves
     * SQLite's mmap setting disabled; platforms may clamp an enabled value.
     */
    mmapSizeBytes?: number;
}

function validateMmapSizeBytes(value: number | undefined): number {
    if (value === undefined) return 0;
    if (
        typeof value !== "number"
        || !Number.isFinite(value)
        || !Number.isSafeInteger(value)
        || value < 0
    ) {
        throw new RangeError(
            "SQLite mmapSizeBytes must be a finite, non-negative safe integer",
        );
    }
    return value;
}

export class SqliteAdapter implements MemoryAdapter {
    private readonly worker: Worker;
    private readonly embedder: EmbeddingProvider | null;
    private kgCache: any = null;
    private kgCacheGeneration = 0;
    private kgDirty = true;
    private nextMsgId = 1;
    private pendingMsgs = new Map<number, { resolve: (res: any) => void; reject: (err: any) => void }>();
    private readonly initialization: Promise<void>;
    private readonly reindexEmbeddingsOnMismatch: boolean;
    private closed = false;
    private closing = false;
    private closePromise: Promise<void> | null = null;
    /** Promises for writes accepted before close() began. */
    private acceptedOperations = new Set<Promise<unknown>>();
    private pendingFactUpserts: Array<{
        payload: any;
        resolve: () => void;
        reject: (error: unknown) => void;
    }> = [];
    private factUpsertFlushScheduled = false;
    private factUpsertFlushInFlight: Promise<void> | null = null;
    private admissionBarrier: Promise<void> = Promise.resolve();
    readonly backupSupported = true;

    constructor(options: SqliteAdapterOptions) {
        // Validate before creating directories or starting the worker. This
        // keeps malformed performance options from causing any SQLite side
        // effects, including on a path whose parent does not yet exist.
        const mmapSizeBytes = validateMmapSizeBytes(options.mmapSizeBytes);
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
            workerData: { dbPath: options.dbPath, mmapSizeBytes },
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
            for (const pending of this.pendingFactUpserts.splice(0)) pending.reject(error);
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

    private ensureAccepting(): void {
        if (this.closed || this.closing) throw new Error("SQLite adapter is closed");
    }

    /** Start a caller-visible operation and retain it until it settles. */
    private startAccepted<T>(operationFactory: () => Promise<T>): Promise<T> {
        this.ensureAccepting();
        const admission = this.admissionBarrier;
        const operation = (async () => {
            await admission;
            return operationFactory();
        })();
        this.acceptedOperations.add(operation);
        void operation.then(
            () => this.acceptedOperations.delete(operation),
            () => this.acceptedOperations.delete(operation),
        );
        return operation;
    }

    private enqueueFactUpsert(payload: any, allowClosing = false): Promise<void> {
        // A fact operation accepted before close() may still be waiting for
        // embeddings. Let that operation cross the close barrier and drain;
        // public operations started after the barrier are rejected by
        // startAccepted/ensureAccepting before reaching this queue.
        if (this.closed || (this.closing && !allowClosing)) {
            return Promise.reject(new Error("SQLite adapter is closed"));
        }
        const queued = new Promise<void>((resolve, reject) => {
            this.pendingFactUpserts.push({ payload, resolve, reject });
        });
        this.scheduleFactUpsertFlush();
        return queued;
    }

    private scheduleFactUpsertFlush(): void {
        if (this.factUpsertFlushScheduled || this.factUpsertFlushInFlight) return;
        this.factUpsertFlushScheduled = true;
        queueMicrotask(() => {
            this.factUpsertFlushScheduled = false;
            const run = this.flushFactUpserts();
            this.factUpsertFlushInFlight = run;
            void run.catch(() => undefined).finally(() => {
                if (this.factUpsertFlushInFlight === run) this.factUpsertFlushInFlight = null;
                if (this.pendingFactUpserts.length > 0) this.scheduleFactUpsertFlush();
            });
        });
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
    }

    /** Drain all writes accepted before a close/flush barrier. */
    private async drainAcceptedOperations(scope?: ReadonlySet<Promise<unknown>>): Promise<void> {
        let firstError: unknown;
        const scopedOperations = scope ? new Set(scope) : null;
        for (;;) {
            if (this.pendingFactUpserts.length > 0 && !this.factUpsertFlushScheduled && !this.factUpsertFlushInFlight) {
                this.scheduleFactUpsertFlush();
            }
            const operations = [...(scopedOperations ?? this.acceptedOperations)];
            const flush = this.factUpsertFlushInFlight;
            if (flush) operations.push(flush);
            if (operations.length === 0) {
                if (this.pendingFactUpserts.length === 0 && !this.factUpsertFlushScheduled) {
                    if (firstError !== undefined) throw firstError;
                    return;
                }
                await Promise.resolve();
                continue;
            }
            const settled = await Promise.allSettled(operations);
            for (const [index, result] of settled.entries()) {
                if (result.status === "rejected" && firstError === undefined) firstError = result.reason;
                if (scopedOperations && index < operations.length - (flush ? 1 : 0)) {
                    scopedOperations.delete(operations[index]);
                }
            }
        }
    }

    /**
     * Hold admission while a backup operation drains the operations already
     * accepted. Calls arriving after this point remain accepted, but start only
     * after the authenticated snapshot or replacement has completed.
     */
    private startBackupOperation<T>(operationFactory: () => Promise<T>): Promise<T> {
        this.ensureAccepting();
        const previousAdmission = this.admissionBarrier;
        let release!: () => void;
        const hold = new Promise<void>((resolve) => {
            release = resolve;
        });
        this.admissionBarrier = previousAdmission.then(() => hold);
        const priorOperations = new Set(this.acceptedOperations);
        const operation = (async () => {
            try {
                await previousAdmission;
                await this.initialization;
                await this.drainAcceptedOperations(priorOperations);
                return await operationFactory();
            } finally {
                release();
            }
        })();
        this.acceptedOperations.add(operation);
        void operation.then(
            () => this.acceptedOperations.delete(operation),
            () => this.acceptedOperations.delete(operation),
        );
        return operation;
    }

    private async initSchema() {
        await this.rawCallWorker("initialize-schema", {});
        const dimensions = this.embedder?.dims ?? 3072;
        const vectorSchema = await this.rawCallWorker("prepare-get", { sql: "SELECT sql FROM sqlite_master WHERE name = 'vec_facts'", params: [] });
        if (!vectorSchema) {
            await this.rawCallWorker("exec", { sql: `CREATE VIRTUAL TABLE IF NOT EXISTS vec_facts USING vec0(fact_id TEXT PRIMARY KEY, embedding float[${dimensions}]); CREATE VIRTUAL TABLE IF NOT EXISTS vec_facts_hot USING vec0(fact_id TEXT PRIMARY KEY, embedding float[${dimensions}]);` });
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

    private factPayload(fact: Fact, vector: number[] | undefined): any {
        const baseId = fact.id.replace(/(-v\d+)+$/, "");
        return {
            factId: fact.id,
            minTs: fact.validFrom ?? fact.createdAt,
            maxTs: fact.validTo ?? 253402300799000,
            content: fact.content,
            entities: fact.entities.join(" "),
            topics: fact.topics.join(" "),
            kgEntities: fact.entities,
            hot: fact.strength > 0.6 && fact.status === "active",
            vector: vector ? Buffer.from(new Float32Array(vector).buffer) : null,
            factSql: `INSERT OR REPLACE INTO facts (id, base_id, content, entities, topics, importance, max_emotion, strength, status, created_at, updated_at, last_accessed, recall_count, valid_from, valid_to, successor_id, supersedes, source_episodes, encoding_context, structured_fact) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            factParams: [
                fact.id,
                baseId,
                fact.content,
                JSON.stringify(fact.entities),
                JSON.stringify(fact.topics),
                fact.importance,
                fact.maxEmotion,
                fact.strength,
                fact.status,
                fact.createdAt,
                fact.updatedAt,
                fact.lastAccessed,
                fact.recallCount,
                fact.validFrom ?? fact.createdAt,
                fact.validTo,
                fact.successorId,
                fact.supersedes,
                JSON.stringify(fact.sourceEpisodes || []),
                JSON.stringify(fact.encodingContext),
                JSON.stringify(fact.structured ?? null),
            ],
        };
    }

    private async upsertFacts(facts: Fact[]): Promise<void> {
        if (facts.length === 0) return;
        const incoming = facts.map((fact) => structuredClone(fact));
        if (new Set(incoming.map((fact) => fact.id)).size !== incoming.length) {
            throw new Error("Semantic batch upsert requires unique fact IDs");
        }
        const vectors = this.embedder
            ? await this.embedder.embedBatch(incoming.map((fact) => fact.content))
            : incoming.map(() => undefined);
        if (this.embedder && (vectors.length !== incoming.length || vectors.some((vector) =>
            !vector || vector.length !== this.embedder!.dims || vector.some((value) => !Number.isFinite(value))))) {
            throw new Error("SQLite fact embedding returned an invalid vector");
        }
        await Promise.all(incoming.map((fact, index) =>
            this.enqueueFactUpsert(this.factPayload(fact, vectors[index]), true),
        ));
        this.kgDirty = true;
    }

    episode = {
        store: (event: Episode): Promise<void> => this.startAccepted(async () => {
            const summary = event.summary ?? event.content;
            const recallCount = event.recallCount ?? 0;
            const lastAccessed = event.lastAccessed ?? event.timestamp;
            const strength = event.strength ?? calculateStrength(
                event.importance?.utility ?? 0,
                event.timestamp,
                recallCount,
                lastAccessed,
                lastAccessed,
            );
            await this.callWorker("store-episode", {
                id: event.id,
                content: event.content,
                timestamp: event.timestamp,
                role: event.role ?? "",
                consolidated: event.consolidated ? 1 : 0,
                importanceImportance: event.importance?.importance ?? null,
                importanceSurprise: event.importance?.surprise ?? null,
                importanceEmotion: event.importance?.emotion ?? null,
                importanceUtility: event.importance?.utility ?? null,
                encodingContext: JSON.stringify(event.encodingContext ?? {}),
                summary,
                recallCount,
                lastAccessed,
                strength,
                status: event.status ?? "active",
            });
        }),
        recall: (query: string, context: RecallContext): Promise<Episode[]> => this.startAccepted(async () => {
            const strictProjectScope = context.scopeMode === "strict" && !context.crossProject;
            const scopeSql = strictProjectScope
                ? context.project
                    ? " AND json_extract(encoding_context, '$.project') = ?"
                    : " AND json_extract(encoding_context, '$.project') IS NULL"
                : "";
            const rows = await this.callWorker("prepare-all", {
                sql: `SELECT * FROM episodes WHERE 1=1${scopeSql}`,
                params: [
                    ...(strictProjectScope && context.project ? [context.project] : []),
                ],
            });
            const now = Date.now();
            const topK = context.topK ?? 5;
            const minStrength = context.minStrength ?? 0.05;
            const deepRecall = context.deepRecall ?? false;
            const scored: Array<{ episode: Episode; score: number }> = rows
                .map((row: any): { episode: Episode; score: number } | null => {
                    const episode = this.rowToEpisode(row);
                    if (!deepRecall && episode.status === "archived") return null;
                    const strength = calculateStrength(
                        episode.importance.utility,
                        episode.timestamp,
                        episode.recallCount,
                        episode.lastAccessed,
                        now,
                    );
                    if (!deepRecall && strength < minStrength) return null;
                    const textScore = keywordScore(query, `${episode.content} ${episode.summary}`);
                    let contextBonus = 0;
                    if (
                        context.project
                        && episode.encodingContext.project === context.project
                    ) contextBonus += 0.2;
                    if (
                        context.activeFile
                        && episode.encodingContext.activeFile === context.activeFile
                    ) contextBonus += 0.1;
                    const score = deepRecall
                        ? textScore + contextBonus
                        : textScore * strength + contextBonus;
                    return { episode, score };
                })
                .filter((candidate: { episode: Episode; score: number } | null): candidate is { episode: Episode; score: number } =>
                    candidate !== null && candidate.score > 0)
                .sort((a: { episode: Episode; score: number }, b: { episode: Episode; score: number }) => b.score - a.score)
                .slice(0, topK);
            if (scored.length === 0) return [];

            const updatedRows = await this.callWorker("recall-episodes", {
                ids: scored.map(({ episode }) => episode.id),
                now,
            });
            const byId = new Map(updatedRows.map((row: any) => [String(row.id), row]));
            return scored
                .map(({ episode }) => byId.get(episode.id))
                .filter((row: any): row is any => row !== undefined)
                .map((row: any) => this.rowToEpisode(row));
        }),
        getRecent: async (n: number): Promise<Episode[]> => {
            const rows = await this.callWorker("prepare-all", {
                sql: "SELECT * FROM episodes WHERE status IS NULL OR status <> 'archived' ORDER BY timestamp DESC LIMIT ?",
                params: [n],
            });
            return rows.map((r: any) => this.rowToEpisode(r));
        },
        getUnconsolidated: async (): Promise<Episode[]> => {
            const rows = await this.callWorker("prepare-all", { sql: "SELECT * FROM episodes WHERE consolidated = 0 ORDER BY timestamp ASC", params: [] });
            return rows.map((r: any) => this.rowToEpisode(r));
        },
        markConsolidated: (ids: string[]): Promise<void> => this.startAccepted(async () => {
            await this.callWorker("transaction", {
                ops: ids.map(id => ({ sql: "UPDATE episodes SET consolidated = 1 WHERE id = ?", params: [id] }))
            });
        })
    };

    semantic = {

        upsert: (fact: Fact): Promise<void> => this.startAccepted(() => this.upsertFacts([fact])),
        upsertMany: (facts: Fact[]): Promise<void> => this.startAccepted(() => this.upsertFacts(facts)),
		search: async (query: string, topK: number, deepRecall = false, context?: RecallContext): Promise<Fact[]> => {
            const start = performance.now();
            const searchNow = Date.now();
            const explicitAtTimestamp = context?.atTimestamp;
            let epochRange: { start: number; end: number | null } | null = null;
            // An explicit timestamp is authoritative. Resolve an epoch anchor
            // only when the caller did not provide one, matching LocalAdapter's
            // temporal policy and keeping anchor lookup out of normal searches.
            if (explicitAtTimestamp === undefined && context?.epochAnchor) {
                const epochRows = await this.callWorker("prepare-all", {
                    sql: "SELECT id, name, description, start_time, end_time FROM epochs ORDER BY rowid",
                    params: [],
                });
                const anchor = context.epochAnchor.toLowerCase();
                const epoch = epochRows.find((row: any) =>
                    String(row.name ?? "").toLowerCase().includes(anchor)
                    || String(row.description ?? "").toLowerCase().includes(anchor),
                );
                if (epoch) {
                    epochRange = {
                        start: Number(epoch.start_time),
                        end: epoch.end_time === null || epoch.end_time === undefined
                            ? null
                            : Number(epoch.end_time),
                    };
                }
            }
            if (
                context?.mode === "at-time"
                && explicitAtTimestamp === undefined
                && epochRange === null
            ) {
                throw new Error(
                    "semantic.search: mode='at-time' requires `atTimestamp` or a valid `epochAnchor` to be set",
                );
            }
            const queryVec = query.length > 0 && this.embedder ? await this.embedder.embed(query) : null;
            
			const isBiTemporal = explicitAtTimestamp !== undefined
                || context?.mode === "at-time"
                || epochRange !== null;
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
				vecRows = await this.callWorker("search-exact-vectors", {
					// A global ANN window cannot guarantee strict project recall: enough
					// foreign or newer scoped rows can starve an older valid match. Exact
					// search over the already project/lifecycle-filtered partition keeps
					// strict scope a correctness contract rather than a 1,000-row heuristic.
					sql: `SELECT v.fact_id, v.embedding FROM ${vecTable} v JOIN facts f ON f.id = v.fact_id WHERE 1=1${candidateScopeSql}${candidateLifecycleSql}`,
					params: candidateScopeParams,
					query: queryVec,
					limit,
				});
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

            // Expand the candidate set through the persisted association graph.
            // This mirrors LocalAdapter's spreading activation while retaining
            // weak two-hop paths so a shared entity can surface a related fact
            // even when it has no direct FTS/vector hit. Scope and lifecycle
            // predicates are applied before graph scores are merged.
            if (query.length > 0) {
                const kgState = await this.getKGState();
                const graph = new KnowledgeGraph(kgState);
                const seedSet = new Set(tokenize(normalize(query)));
                const activation = new Map<string, number>();
                for (const seed of seedSet) {
                    if (kgState.nodes[seed]) activation.set(seed, 1);
                }
                for (let depth = 0; depth < 2; depth++) {
                    const current = new Map(activation);
                    for (const [entity, level] of current) {
                        for (const { neighbor, weight } of graph.getNeighbors(entity)) {
                            const propagated = level * Number(weight) * 0.8;
                            if (propagated > (activation.get(neighbor) ?? 0)) {
                                activation.set(neighbor, propagated);
                            }
                        }
                    }
                }
                const expanded = [...activation.entries()]
                    .filter(([entity, level]) => !seedSet.has(entity) && level > 0)
                    .sort((a, b) => b[1] - a[1]);
                if (expanded.length > 0) {
                    const kgRows = await this.callWorker("prepare-all", {
                        sql: `SELECT f.id, f.entities FROM facts f WHERE 1=1${candidateLifecycleSql}${candidateScopeSql}`,
                        params: candidateScopeParams,
                    });
                    const entityScores = new Map(expanded);
                    for (const row of kgRows) {
                        let score = 0;
                        for (const entity of JSON.parse(row.entities || "[]")) {
                            score = Math.max(score, entityScores.get(String(entity).toLowerCase()) ?? 0);
                        }
                        if (score > 0) {
                            rrfMap.set(row.id, (rrfMap.get(row.id) || 0) + score);
                        }
                    }
                }
            }

			const hasMatches = rrfMap.size > 0;

            let gate = "WHERE 1=1";
            const gateParams: any[] = [];
            if (hasMatches && !isBiTemporal) {
                const ids = Array.from(rrfMap.entries()).sort((a, b) => b[1] - a[1])
					.slice(0, Math.max(50, topK)).map(([id]) => id);
				gate += ` AND (id IN (${ids.map(() => "?").join(",")}) OR ${FLASHBULB_SQL})`;
				gateParams.push(...ids);
			} else if (query.length > 0 && !isBiTemporal && !deepRecall) {
				// A high or low emotion fact is a recallable flashbulb even when
				// the query produced no FTS/vector candidate.
				gate += ` AND ${FLASHBULB_SQL}`;
			}
			if (isBiTemporal) {
				const rangeStart = epochRange?.start ?? explicitAtTimestamp!;
				// An open-ended epoch covers facts through one consistent observation
				// point for this search. Explicit point lookups remain authoritative.
				const rangeEnd = epochRange?.end ?? (epochRange ? searchNow : rangeStart);
				// RTree bounds are floats, so use them as a coarse candidate index
				// and re-check the persisted INTEGER bounds on the fact row. Join
				// through id_map because facts uses a TEXT primary key, whose rowid
				// is unrelated to the RTree identifier.
				gate += " AND id IN (SELECT m.fact_id FROM facts_time_idx ti JOIN id_map m ON m.fid = ti.id WHERE ti.min_ts <= ? AND ti.max_ts >= ?)";
				gateParams.push(rangeEnd, rangeStart);
				gate += " AND valid_from <= ? AND (valid_to IS NULL OR valid_to >= ?)";
				gateParams.push(rangeEnd, rangeStart);
			}
			// Hot indexes only contain active facts. Re-applying this predicate makes
			// SQLite scan idx_facts_status instead of fetching the small ID set by PK.
			if (!includeHistorical) gate += " AND status = 'active'";
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
			let selectedRows = rows;
			if (isBiTemporal) {
				const rangeStart = epochRange?.start ?? explicitAtTimestamp!;
				// Keep the same open-epoch semantics during version selection as in
				// the SQL coarse gate: an ongoing epoch extends through now.
				const rangeEnd = epochRange?.end ?? (epochRange ? searchNow : rangeStart);
				const groups = new Map<string, any[]>();
				for (const row of rows) {
					const key = String(row.base_id ?? row.id);
					const group = groups.get(key);
					if (group) group.push(row);
					else groups.set(key, [row]);
				}
				selectedRows = [];
				for (const group of groups.values()) {
					group.sort((a, b) => Number(b.created_at) - Number(a.created_at));
					const selected = group.find((row) => {
						const validFrom = Number(row.valid_from ?? row.created_at);
						const validTo = row.valid_to === null || row.valid_to === undefined
							? Number.POSITIVE_INFINITY
							: Number(row.valid_to);
						return validFrom <= rangeEnd && validTo >= rangeStart;
					});
					if (!selected) continue;
					// Epoch ranges intentionally return every selected version. Point
					// lookups retain LocalAdapter's relevance/flashbulb behavior.
					if (
						query.length > 0
						&& !deepRecall
						&& epochRange === null
						&& !rrfMap.has(selected.id)
						&& !isFlashbulbRow(selected)
					) continue;
					selectedRows.push(selected);
				}
			}

			return selectedRows.map((r: any) => this.rowToFact(
				r,
				(rrfMap.get(r.id) ?? 0) + (isFlashbulbRow(r) ? 0.5 : 0),
			))
                .sort((a: any, b: any) => (b.relevanceScore || 0) - (a.relevanceScore || 0)).slice(0, topK);
        },
        decay: (now: number): Promise<number> => this.startAccepted(async () => {
            const result = await this.callWorker("decay", { now });
            this.kgDirty = true;
            return Number(result?.factsArchived ?? 0) + Number(result?.episodesArchived ?? 0);
        }),
        associate: (entityA: string, entityB: string, weight = 0.1): Promise<void> => this.startAccepted(async () => {
            await this.callWorker("associate", { entityA, entityB, weight });
            this.kgDirty = true;
        }),
        getAll: async (): Promise<Fact[]> => {
            const rows = await this.callWorker("prepare-all", { sql: "SELECT * FROM facts", params: [] });
            return rows.map((r: any) => this.rowToFact(r));
        },
        delete: (id: string): Promise<boolean> => this.startAccepted(() => this.callWorker("archive-fact", { factId: id }))
    };

    procedural = {
        getSkill: async (name: string): Promise<Skill | null> => {
            const row = await this.callWorker("prepare-get", {
                sql: "SELECT id, name, description, learned_at, success_count, failure_count, confidence FROM skills WHERE name = ?",
                params: [name],
            });
            return row ? this.rowToSkill(row) : null;
        },
        recordOutcome: (name: string, success: boolean): Promise<void> => this.startAccepted(async () => {
            await this.callWorker("record-outcome", {
                name,
                success,
                now: Date.now(),
            });
        }),
        learnFromFailure: (reflection: Reflection): Promise<void> => this.startAccepted(async () => {
            await this.callWorker("insert-reflection", reflection);
        }),
        getReflections: async (task: string, topK: number): Promise<Reflection[]> => {
            const rows = await this.callWorker("prepare-all", {
                sql: "SELECT id, task, failure, analysis, correction, timestamp, content, importance FROM reflections ORDER BY rowid",
                params: [],
            });
            return rows
                .map((row: any) => ({
                    reflection: this.rowToReflection(row),
                    score: keywordScore(
                        task,
                        `${row.task ?? ""} ${row.failure ?? ""} ${row.analysis ?? row.content ?? ""}`,
                    ),
                }))
                .filter((candidate: { score: number }) => candidate.score > 0)
                .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
                .slice(0, topK)
                .map((candidate: { reflection: Reflection }) => candidate.reflection);
        },
    };

    async upsertEpoch(epoch: Epoch): Promise<void> {
        return this.startAccepted(async () => {
        await this.callWorker("upsert-epoch", {
            id: epoch.id,
            name: epoch.name,
            description: epoch.description ?? null,
            start: epoch.start,
            end: epoch.end ?? null,
            sourceEpisodeId: epoch.sourceEpisodeId ?? null,
        });
        });
    }
    async getEpochs(): Promise<Epoch[]> {
        const rows = await this.callWorker("prepare-all", {
            sql: "SELECT id, name, description, start_time, end_time, source_episode_id FROM epochs ORDER BY rowid",
            params: [],
        });
        return rows.map((row: any) => ({
            id: row.id,
            name: row.name,
            description: row.description ?? undefined,
            start: Number(row.start_time),
            end: row.end_time === null || row.end_time === undefined
                ? null
                : Number(row.end_time),
            sourceEpisodeId: row.source_episode_id ?? undefined,
        }));
    }
    async getHubs(): Promise<Record<string, { frequency: number }>> {
        const state = await this.getKGState();
        return Object.fromEntries(Object.entries(state.nodes).map(([name, node]) => [name, {
            frequency: Number(node.frequency ?? 0),
        }]));
    }
    async getKGState(): Promise<KGState> {
        if (!this.kgDirty && this.kgCache) return structuredClone(this.kgCache) as KGState;
        const generation = this.kgCacheGeneration;
        const state = await this.callWorker("read-kg", {}) as KGState;
        if (generation === this.kgCacheGeneration) {
            this.kgCache = state;
            this.kgDirty = false;
        }
        return structuredClone(state) as KGState;
    }
    async consolidate(): Promise<ConsolidationResult> {
        return {
            factsCreated: 0,
            factsUpdated: 0,
            episodesProcessed: 0,
            memoriesPruned: 0,
            associationsUpdated: 0,
        };
    }
    async export(password: string): Promise<Uint8Array> {
        return this.startBackupOperation(async () => {
            const exported = await this.callWorker("backup-snapshot", {}) as SqliteBackupExport;
            const { snapshot, target } = exported;
            const store = this.snapshotToMemoryStore(snapshot) as SqliteBackupStore;
            store.sqliteBackup = { version: 1, target, snapshot };
            return encodeLocalBackup(store, password);
        });
    }
    async import(blob: Uint8Array, password: string): Promise<void> {
        return this.startBackupOperation(async () => {
            const decoded = await decodeLocalBackup(blob, password);
            const { snapshot, target } = validateSqliteBackupEnvelope(
                decoded,
                (candidate) => this.snapshotToMemoryStore(candidate),
            );
            const currentTarget = await this.callWorker("backup-target", {}) as SqliteBackupTarget;
            if (!sameSqliteBackupTarget(currentTarget, target)) {
                throw new Error("SQLite backup target does not match current adapter");
            }
            await this.callWorker("replace-backup", {
                snapshot,
                expectedTarget: currentTarget,
            });
            this.kgCacheGeneration += 1;
            this.kgCache = null;
            this.kgDirty = true;
        });
    }
    async flush(): Promise<void> {
        await this.initialization.catch(() => undefined);
        await this.drainAcceptedOperations();
    }
    async close(): Promise<void> {
        if (this.closePromise) return this.closePromise;
        if (this.closed) return;
        this.closing = true;
        this.closePromise = (async () => {
            await this.initialization.catch(() => undefined);
            await this.drainAcceptedOperations().catch(() => undefined);
            this.closed = true;
            const error = new Error("SQLite adapter is closed");
            for (const pending of this.pendingMsgs.values()) pending.reject(error);
            this.pendingMsgs.clear();
            for (const pending of this.pendingFactUpserts.splice(0)) pending.reject(error);
            await this.worker.terminate();
        })();
        return this.closePromise;
    }
    private snapshotToMemoryStore(snapshot: SqliteBackupSnapshot): MemoryStore {
        const knowledgeGraph: KGState = {
            nodes: Object.fromEntries(snapshot.kgNodes.map((row) => {
                const name = String(row.name ?? "");
                return [name, {
                    name,
                    frequency: Number(row.frequency ?? 0),
                    lastSeen: Number(row.last_seen ?? 0),
                }];
            })),
            edges: Object.fromEntries(snapshot.kgEdges.map((row) => {
                const from = String(row.source ?? "");
                const to = String(row.target ?? "");
                return [`${from}::${to}`, {
                    from,
                    to,
                    weight: Number(row.weight ?? 0),
                    coOccurrences: Number(row.co_occurrences ?? 0),
                }];
            })),
        };
        const associations = Object.fromEntries(snapshot.associations.map((row) => [
            String(row.association_key ?? ""),
            Number(row.weight ?? 0),
        ]));
        const epochs: Epoch[] = snapshot.epochs.map((row) => ({
            id: String(row.id ?? ""),
            name: String(row.name ?? ""),
            ...(row.description === null || row.description === undefined
                ? {}
                : { description: String(row.description) }),
            start: Number(row.start_time ?? 0),
            end: row.end_time === null || row.end_time === undefined
                ? null
                : Number(row.end_time),
            ...(row.source_episode_id === null || row.source_episode_id === undefined
                ? {}
                : { sourceEpisodeId: String(row.source_episode_id) }),
        }));
        return {
            version: 1,
            episodes: snapshot.episodes.map((row) => this.rowToEpisode(row)),
            facts: snapshot.facts.map((row) => this.rowToFact(row)),
            epochs,
            skills: snapshot.skills.map((row) => this.rowToSkill(row)),
            reflections: snapshot.reflections.map((row) => this.rowToReflection(row)),
            associations,
            knowledgeGraph,
            factEmbeddings: Object.fromEntries(snapshot.vectors.facts.map((vector) => [
                vector.factId,
                vector.embedding,
            ])),
            episodeEmbeddings: {},
            ...(snapshot.vectors.embeddingSpaceId === undefined
                ? {}
                : { embeddingSpaceId: snapshot.vectors.embeddingSpaceId }),
        };
    }
    private rowToEpisode(r: any): Episode {
        let encodingContext: Episode["encodingContext"] = {};
        try {
            encodingContext = JSON.parse(r.encoding_context || "{}");
        } catch {
            encodingContext = {};
        }
        return {
            id: r.id,
            content: r.content,
            summary: r.summary ?? r.content,
            timestamp: Number(r.timestamp),
            ...(r.role ? { role: r.role as Episode["role"] } : {}),
            consolidated: !!r.consolidated,
            recallCount: Number(r.recall_count ?? 0),
            lastAccessed: Number(r.last_accessed ?? r.timestamp),
            strength: Number(r.strength ?? 1),
            importance: {
                importance: Number(r.importance_importance ?? 0),
                surprise: Number(r.importance_surprise ?? 0),
                emotion: Number(r.importance_emotion ?? 0),
                utility: Number(r.importance_utility ?? 0),
            },
            encodingContext,
            ...(r.status ? { status: r.status as Episode["status"] } : {}),
        };
    }
    private rowToSkill(r: any): Skill {
        return {
            id: String(r.id ?? `legacy-skill:${r.name}`),
            name: String(r.name),
            description: String(r.description ?? ""),
            learnedAt: Number(r.learned_at ?? 0),
            successCount: Number(r.success_count ?? 0),
            failureCount: Number(r.failure_count ?? 0),
            confidence: Number(r.confidence ?? 0),
        };
    }
    private rowToReflection(r: any): Reflection {
        return {
            task: String(r.task ?? ""),
            failure: String(r.failure ?? ""),
            analysis: String(r.analysis ?? r.content ?? ""),
            correction: String(r.correction ?? ""),
            timestamp: Number(r.timestamp),
        };
    }
    private rowToFact(r: any, score?: number): Fact { return { id: r.id, content: r.content, entities: JSON.parse(r.entities || "[]"), topics: JSON.parse(r.topics || "[]"), importance: r.importance, ...(r.max_emotion === null || r.max_emotion === undefined ? {} : { maxEmotion: r.max_emotion }), strength: r.strength, status: r.status as any, createdAt: r.created_at, updatedAt: r.updated_at, lastAccessed: r.last_accessed, recallCount: r.recall_count, validFrom: r.valid_from, validTo: r.valid_to, successorId: r.successor_id, supersedes: r.supersedes, sourceEpisodes: JSON.parse(r.source_episodes || "[]"), encodingContext: JSON.parse(r.encoding_context || "{}"), ...(r.structured_fact === null || r.structured_fact === undefined || r.structured_fact === "null" ? {} : { structured: JSON.parse(r.structured_fact) as StructuredFact }), relevanceScore: score }; }
}
