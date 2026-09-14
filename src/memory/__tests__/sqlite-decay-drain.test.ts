import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { calculateStrength } from "../decay.js";
import type { EmbeddingProvider } from "../embeddings.js";
import { SqliteAdapter } from "../adapters/sqlite.js";
import type { Episode, Fact } from "../types.js";

const testTmpRoot = process.env.TMPDIR
    ?? join(process.cwd(), ".tmp", "naia-memory-stage5-20260906");
const liveAdapters: SqliteAdapter[] = [];
const liveDirs: string[] = [];

function makeTempDb(prefix: string): { dbPath: string; tempDir: string } {
    mkdirSync(testTmpRoot, { recursive: true });
    const tempDir = mkdtempSync(join(testTmpRoot, prefix));
    liveDirs.push(tempDir);
    return { tempDir, dbPath: join(tempDir, "memory.db") };
}

function track<T extends SqliteAdapter>(adapter: T): T {
    liveAdapters.push(adapter);
    return adapter;
}

function makeProvider(
    batchImpl?: (texts: string[]) => Promise<number[][]>,
): EmbeddingProvider {
    return {
        name: "stage5b-decay-drain",
        dims: 2,
        embeddingSpaceId: "stage5b-decay-drain-v1",
        async embed() {
            return [1, 0];
        },
        async embedBatch(texts) {
            // initSchema probes an empty population while it creates the
            // vector tables. Controlled tests reserve their latch for actual
            // accepted work so initialization cannot consume it.
            if (texts.length === 0) return [];
            return batchImpl
                ? batchImpl(texts)
                : texts.map(() => [1, 0]);
        },
    };
}

function makeFact(
    id: string,
    now: number,
    overrides: Partial<Fact> = {},
): Fact {
    return {
        id,
        content: `decay fact ${id}`,
        entities: ["alpha", "beta"],
        topics: ["stage5b"],
        createdAt: now,
        updatedAt: now,
        importance: 1,
        recallCount: 0,
        lastAccessed: now,
        strength: 1,
        status: "active",
        sourceEpisodes: [],
        ...overrides,
    };
}

function makeEpisode(
    id: string,
    now: number,
    overrides: Partial<Episode> = {},
): Episode {
    return {
        id,
        content: `decay episode ${id}`,
        summary: `summary ${id}`,
        timestamp: now,
        role: "user",
        importance: {
            importance: 0.5,
            surprise: 0.5,
            emotion: 0.5,
            utility: 0.5,
        },
        encodingContext: { project: "stage5b" },
        consolidated: false,
        recallCount: 0,
        lastAccessed: now,
        strength: 1,
        status: "active",
        ...overrides,
    };
}

type WorkerCall = (type: string, payload: unknown) => Promise<unknown>;

function holdRecallUpdate(
    adapter: SqliteAdapter,
    onCompleted: () => void = () => undefined,
): { started: Promise<void>; release: () => void } {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const updateStarted = new Promise<void>((resolve) => {
        started = resolve;
    });
    const worker = (adapter as unknown as { rawCallWorker: WorkerCall });
    const original = worker.rawCallWorker;
    worker.rawCallWorker = async function(type, payload) {
        if (type === "recall-episodes") {
            started();
            await gate;
            const result = await original.call(adapter, type, payload);
            onCompleted();
            return result;
        }
        return original.call(adapter, type, payload);
    };
    return { started: updateStarted, release };
}

async function closeTracked(adapter: SqliteAdapter | undefined): Promise<void> {
    if (!adapter) return;
    await adapter.close();
    const index = liveAdapters.indexOf(adapter);
    if (index >= 0) liveAdapters.splice(index, 1);
}

afterEach(async () => {
    for (const adapter of [...liveAdapters].reverse()) {
        await adapter.close();
    }
    liveAdapters.splice(0);
    for (const tempDir of liveDirs.splice(0)) {
        rmSync(tempDir, { recursive: true, force: true });
    }
});

describe("SQLite Stage5B decay and close drain", () => {
    it("persists local-consistent decay, hot eligibility, graph decay, and reopen state", async () => {
        const { dbPath } = makeTempDb("sqlite-decay-state-");
        const now = 2_000_000_000_000;
        const day = 24 * 60 * 60 * 1000;
        const provider = makeProvider();
        const hot = makeFact("decay-hot", now, { entities: ["alpha", "beta"] });
        const aging = makeFact("decay-aging", now, {
            entities: ["gamma"],
            lastAccessed: now - 50 * day,
        });
        const archived = makeFact("decay-archived", now, {
            entities: ["delta"],
            importance: 0.5,
            lastAccessed: now - 200 * day,
        });
        const archivedEpisode = makeEpisode("decay-episode-archived", now, {
            lastAccessed: now - 200 * day,
        });
        const weakConsolidatedEpisode = makeEpisode("decay-episode-consolidated", now, {
            consolidated: true,
            lastAccessed: now - 200 * day,
        });
        let adapter: SqliteAdapter | undefined = track(new SqliteAdapter({
            dbPath,
            embeddingProvider: provider,
        }));

        try {
            await Promise.all([
                adapter.semantic.upsert(hot),
                adapter.semantic.upsert(aging),
                adapter.semantic.upsert(archived),
            ]);
            await adapter.episode.store(archivedEpisode);
            await adapter.episode.store(weakConsolidatedEpisode);
            await adapter.semantic.associate("alpha", "beta", 0.4);
            const beforeKg = await adapter.getKGState();
            const beforeEdge = beforeKg.edges["alpha::beta"];
            expect(beforeEdge).toBeDefined();

            await expect(adapter.semantic.decay(now)).resolves.toBe(2);
            const afterFacts = await adapter.semantic.getAll();
            const byFactId = new Map(afterFacts.map((fact) => [fact.id, fact]));
            expect(byFactId.get(hot.id)).toMatchObject({
                status: "active",
                strength: calculateStrength(1, now, 0, now, now),
            });
            expect(byFactId.get(aging.id)).toMatchObject({ status: "active" });
            expect(byFactId.get(aging.id)?.strength).toBeCloseTo(
                calculateStrength(1, now, 0, now - 50 * day, now),
                8,
            );
            expect(byFactId.get(archived.id)).toMatchObject({ status: "archived" });
            expect(byFactId.get(archived.id)?.strength).toBeCloseTo(0.01, 8);

            const recentEpisodes = await adapter.episode.getRecent(10);
            expect(recentEpisodes.map((episode) => episode.id)).toEqual([
                weakConsolidatedEpisode.id,
            ]);
            expect(await adapter.episode.getUnconsolidated()).toEqual([
                expect.objectContaining({
                    id: archivedEpisode.id,
                    status: "archived",
                    strength: 0.01,
                }),
            ]);

            const afterKg = await adapter.getKGState();
            expect(afterKg.edges["alpha::beta"]?.weight).toBeCloseTo(
                Number(beforeEdge?.weight) * 0.95,
                8,
            );

            const queryWorker = (adapter as unknown as {
                rawCallWorker(type: string, payload: unknown): Promise<unknown>;
            }).rawCallWorker.bind(adapter);
            const fullVectorCount = await queryWorker("prepare-get", {
                sql: "SELECT count(*) AS count FROM vec_facts",
                params: [],
            }) as { count?: number };
            const hotVectorCount = await queryWorker("prepare-get", {
                sql: "SELECT count(*) AS count FROM vec_facts_hot",
                params: [],
            }) as { count?: number };
            expect(Number(fullVectorCount.count)).toBe(3);
            expect(Number(hotVectorCount.count)).toBe(1);

            await closeTracked(adapter);
            adapter = undefined;
            const db = new Database(dbPath, { readonly: true });
            try {
                const fullFtsCount = (db.prepare("SELECT count(*) AS count FROM facts_fts").get() as { count: number }).count;
                const hotFtsCount = (db.prepare("SELECT count(*) AS count FROM facts_fts_hot").get() as { count: number }).count;
                expect(fullFtsCount).toBe(3);
                expect(hotFtsCount).toBe(1);
                const association = db.prepare(
                    "SELECT weight FROM semantic_associations WHERE association_key = 'alpha::beta'",
                ).get() as { weight?: number } | undefined;
                expect(association?.weight).toBeCloseTo(0.38, 8);
                const kgEdge = db.prepare(
                    "SELECT weight FROM kg_edges WHERE source = 'alpha' AND target = 'beta'",
                ).get() as { weight?: number } | undefined;
                expect(kgEdge?.weight).toBeCloseTo(Number(beforeEdge?.weight) * 0.95, 8);
            } finally {
                db.close();
            }

            adapter = track(new SqliteAdapter({
                dbPath,
                embeddingProvider: provider,
            }));
            const reopenedFacts = await adapter.semantic.getAll();
            expect(reopenedFacts).toEqual(expect.arrayContaining([
                expect.objectContaining({ id: archived.id, status: "archived", strength: 0.01 }),
                expect.objectContaining({ id: aging.id, status: "active" }),
            ]));
            expect((await adapter.episode.getRecent(10)).map((episode) => episode.id)).toEqual([
                weakConsolidatedEpisode.id,
            ]);
            expect((await adapter.getKGState()).edges["alpha::beta"]?.weight).toBeCloseTo(
                Number(beforeEdge?.weight) * 0.95,
                8,
            );
        } finally {
            await closeTracked(adapter);
        }
    });

    it("drains an admitted episode recall before close and persists the update", async () => {
        const { dbPath } = makeTempDb("sqlite-drain-episode-recall-");
        const provider = makeProvider();
        let adapter: SqliteAdapter | undefined = track(new SqliteAdapter({
            dbPath,
            embeddingProvider: provider,
        }));
        let releaseRecall: (() => void) | undefined;
        try {
            const episode = makeEpisode("drain-episode-recall", Date.now());
            await adapter.episode.store(episode);
            const latch = holdRecallUpdate(adapter);
            releaseRecall = latch.release;
            const recallIssuedAt = Date.now();
            const admittedRecall = adapter.episode.recall("decay", { topK: 1 });
            await latch.started;

            let closeResolved = false;
            const closePromise = adapter.close().then(() => {
                closeResolved = true;
            });
            expect(() => adapter!.episode.recall("decay", { topK: 1 }))
                .toThrow(/SQLite adapter is closed/);
            await Promise.resolve();
            expect(closeResolved).toBe(false);

            releaseRecall();
            await expect(admittedRecall).resolves.toEqual([
                expect.objectContaining({
                    id: episode.id,
                    recallCount: 1,
                    lastAccessed: expect.any(Number),
                    strength: expect.any(Number),
                }),
            ]);
            await expect(closePromise).resolves.toBeUndefined();
            liveAdapters.splice(liveAdapters.indexOf(adapter), 1);
            adapter = undefined;

            adapter = track(new SqliteAdapter({
                dbPath,
                embeddingProvider: provider,
            }));
            const persisted = (await adapter.episode.getUnconsolidated())
                .find((candidate) => candidate.id === episode.id);
            expect(persisted).toEqual(expect.objectContaining({
                id: episode.id,
                recallCount: 1,
                lastAccessed: expect.any(Number),
                strength: expect.any(Number),
            }));
            expect(persisted?.lastAccessed).toBeGreaterThanOrEqual(recallIssuedAt);
            expect(persisted?.strength).toBeCloseTo(
                calculateStrength(
                    persisted?.importance.utility ?? 0,
                    persisted?.timestamp ?? 0,
                    persisted?.recallCount ?? 0,
                    persisted?.lastAccessed ?? 0,
                    persisted?.lastAccessed ?? 0,
                ),
                8,
            );
        } finally {
            releaseRecall?.();
            await closeTracked(adapter);
        }
    });

    it("waits for an admitted episode recall before flush resolves", async () => {
        const { dbPath } = makeTempDb("sqlite-flush-episode-recall-");
        const provider = makeProvider();
        let adapter: SqliteAdapter | undefined = track(new SqliteAdapter({
            dbPath,
            embeddingProvider: provider,
        }));
        let releaseRecall: (() => void) | undefined;
        try {
            const episode = makeEpisode("flush-episode-recall", Date.now());
            await adapter.episode.store(episode);
            const events: string[] = [];
            const latch = holdRecallUpdate(adapter, () => {
                events.push("recall-persisted");
            });
            releaseRecall = latch.release;
            const admittedRecall = adapter.episode.recall("decay", { topK: 1 });
            await latch.started;

            let flushResolved = false;
            const flushPromise = adapter.flush().then(() => {
                events.push("flush-resolved");
                flushResolved = true;
            });
            await Promise.resolve();
            expect(flushResolved).toBe(false);

            releaseRecall();
            await expect(admittedRecall).resolves.toEqual([
                expect.objectContaining({ id: episode.id, recallCount: 1 }),
            ]);
            await expect(flushPromise).resolves.toBeUndefined();
            expect(events.indexOf("recall-persisted")).toBeGreaterThanOrEqual(0);
            expect(events.indexOf("flush-resolved")).toBeGreaterThanOrEqual(0);
            expect(events.indexOf("recall-persisted")).toBeLessThan(
                events.indexOf("flush-resolved"),
            );

            await expect(adapter.episode.getUnconsolidated()).resolves.toEqual([
                expect.objectContaining({
                    id: episode.id,
                    recallCount: 1,
                    lastAccessed: expect.any(Number),
                    strength: expect.any(Number),
                }),
            ]);
        } finally {
            releaseRecall?.();
            await closeTracked(adapter);
        }
    });

    it("drains a pre-enqueue embedding while rejecting work after close begins", async () => {
        const { dbPath } = makeTempDb("sqlite-drain-pre-enqueue-");
        let releaseBatch!: () => void;
        let startedBatch!: () => void;
        const batchGate = new Promise<void>((resolve) => {
            releaseBatch = resolve;
        });
        const batchStarted = new Promise<void>((resolve) => {
            startedBatch = resolve;
        });
        const provider = makeProvider(async (texts) => {
            startedBatch();
            await batchGate;
            return texts.map(() => [1, 0]);
        });
        let adapter: SqliteAdapter | undefined = track(new SqliteAdapter({
            dbPath,
            embeddingProvider: provider,
        }));
        try {
            const acceptedFact = makeFact("pre-enqueue-fact", Date.now());
            const accepted = adapter.semantic.upsert(acceptedFact);
            await batchStarted;
            const closePromise = adapter.close();
            expect(() => adapter?.semantic.upsert(makeFact("rejected-after-close", Date.now())))
                .toThrow(/SQLite adapter is closed/);
            releaseBatch();
            await expect(accepted).resolves.toBeUndefined();
            await expect(closePromise).resolves.toBeUndefined();
            liveAdapters.splice(liveAdapters.indexOf(adapter), 1);
            adapter = undefined;

            adapter = track(new SqliteAdapter({ dbPath, embeddingProvider: provider }));
            await expect(adapter.semantic.getAll()).resolves.toEqual([
                expect.objectContaining({ id: acceptedFact.id }),
            ]);
        } finally {
            await closeTracked(adapter);
        }
    });

    it("settles a failed embedding before close and leaves no partial fact", async () => {
        const { dbPath } = makeTempDb("sqlite-drain-embedding-error-");
        const provider = makeProvider(async () => {
            throw new Error("controlled embedding failure");
        });
        let adapter: SqliteAdapter | undefined = track(new SqliteAdapter({
            dbPath,
            embeddingProvider: provider,
        }));
        try {
            const rejected = adapter.semantic.upsert(makeFact("failed-embedding", Date.now()));
            await expect(rejected).rejects.toThrow("controlled embedding failure");
            await expect(adapter.close()).resolves.toBeUndefined();
            liveAdapters.splice(liveAdapters.indexOf(adapter), 1);
            adapter = undefined;

            adapter = track(new SqliteAdapter({ dbPath, embeddingProvider: provider }));
            await expect(adapter.semantic.getAll()).resolves.toEqual([]);
        } finally {
            await closeTracked(adapter);
        }
    });

    it("drains queued microbatch writes and settles a worker transaction error", async () => {
        const { dbPath } = makeTempDb("sqlite-drain-queue-worker-error-");
        const provider = makeProvider();
        let adapter: SqliteAdapter | undefined = track(new SqliteAdapter({
            dbPath,
            embeddingProvider: provider,
        }));
        try {
            const queuedFacts = ["queued-a", "queued-b", "queued-c"].map((id) =>
                makeFact(id, Date.now(), { entities: [id] }));
            const acceptedWrites = queuedFacts.map((fact) => adapter!.semantic.upsert(fact));
            const closePromise = adapter.close();
            await expect(Promise.all(acceptedWrites)).resolves.toEqual([undefined, undefined, undefined]);
            await expect(closePromise).resolves.toBeUndefined();
            liveAdapters.splice(liveAdapters.indexOf(adapter), 1);
            adapter = undefined;

            adapter = track(new SqliteAdapter({ dbPath, embeddingProvider: provider }));
            await expect(adapter.semantic.getAll()).resolves.toHaveLength(3);

            const workerCall = (adapter as unknown as {
                rawCallWorker(type: string, payload: unknown): Promise<unknown>;
            }).rawCallWorker;
            const accepted = (adapter as unknown as {
                startAccepted<T>(factory: () => Promise<T>): Promise<T>;
            }).startAccepted;
            const workerError = accepted.call(adapter, () => workerCall.call(
                adapter,
                "transaction",
                { ops: [{ sql: "INSERT INTO missing_stage5b_table VALUES (1)", params: [] }] },
            ));
            await expect(workerError).rejects.toThrow(/missing_stage5b_table/);
            await expect(adapter.close()).resolves.toBeUndefined();
        } finally {
            await closeTracked(adapter);
        }
    });
});
