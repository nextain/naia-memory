import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeLocalBackup, encodeLocalBackup } from "../adapters/local-backup.js";
import type { MemoryStore } from "../adapters/local-model.js";
import { SqliteAdapter } from "../adapters/sqlite.js";
import { NaiaMemoryProvider } from "../provider.js";
import type { EmbeddingProvider } from "../embeddings.js";
import type { Episode, Fact, Reflection } from "../types.js";

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function makeFact(content: string): Fact {
    const now = Date.now();
    return {
        id: randomUUID(),
        content,
        entities: ["sqlite"],
        topics: ["backup"],
        createdAt: now,
        updatedAt: now,
        importance: 0.8,
        recallCount: 0,
        lastAccessed: now,
        strength: 0.8,
        status: "active",
        sourceEpisodes: [],
    };
}

function makeVectorProvider(
    embeddingSpaceId: string,
    dims = 2,
): EmbeddingProvider {
    const vectors: Record<string, number[]> = {
        "vector-hot-anchor": [1, 0],
        "vector-main-anchor": [0, 1],
        "vector-query": [1, 0],
    };
    const vectorFor = (text: string): number[] => {
        const known = dims === 2 ? vectors[text] : undefined;
        if (known) return known.slice();
        return Array.from({ length: dims }, (_, index) => index === 0 ? 1 : 0);
    };
    return {
        name: "sqlite-backup-import-vectors",
        dims,
        embeddingSpaceId,
        async embed(text) {
            return vectorFor(text);
        },
        async embedBatch(texts) {
            return texts.map(vectorFor);
        },
    };
}

function makeAdmissionVectorProvider(
    embeddingSpaceId: string,
    delayedContent: string,
    delayedStarted: { resolve: (value: void | PromiseLike<void>) => void },
    delayedGate: { promise: Promise<void> },
    futureContent: string,
    futureStarted: { value: boolean },
): EmbeddingProvider {
    const base = makeVectorProvider(embeddingSpaceId);
    let delayed = false;
    return {
        ...base,
        async embedBatch(texts) {
            if (!delayed && texts.includes(delayedContent)) {
                delayed = true;
                delayedStarted.resolve(undefined);
                await delayedGate.promise;
            }
            if (texts.includes(futureContent)) futureStarted.value = true;
            return base.embedBatch(texts);
        },
    };
}

async function exactVectorMatches(
    adapter: SqliteAdapter,
    table: "vec_facts" | "vec_facts_hot",
): Promise<Array<{ fact_id: string; distance: number }>> {
    return callRawWorker(adapter, "search-exact-vectors", {
        sql: `SELECT fact_id, embedding FROM ${table} ORDER BY fact_id`,
        params: [],
        query: [1, 0],
        limit: 10,
    });
}

function makeFixture() {
    const tempDir = mkdtempSync(join(tmpdir(), "naia-memory-sqlite-import-"));
    return { tempDir, dbPath: join(tempDir, "memory.db") };
}

type RawWorkerCall = (type: string, payload: unknown) => Promise<unknown>;

async function callRawWorker(
    adapter: SqliteAdapter,
    type: string,
    payload: unknown,
): Promise<any> {
    const rawCallWorker = (adapter as unknown as {
        rawCallWorker: RawWorkerCall;
    }).rawCallWorker;
    return rawCallWorker.call(adapter, type, payload);
}

function holdOneCompletedKgRead(adapter: SqliteAdapter) {
    const readStarted = deferred<void>();
    const readGate = deferred<void>();
    const internals = adapter as unknown as {
        rawCallWorker: RawWorkerCall;
    };
    const original = internals.rawCallWorker;
    let held = false;
    internals.rawCallWorker = async (type, payload) => {
        const result = await original.call(adapter, type, payload);
        if (type === "read-kg" && !held) {
            held = true;
            readStarted.resolve(undefined);
            await readGate.promise;
        }
        return result;
    };
    return {
        readStarted: readStarted.promise,
        release: () => readGate.resolve(undefined),
        restore: () => {
            internals.rawCallWorker = original;
        },
    };
}

async function executeSql(
    adapter: SqliteAdapter,
    sql: string,
    params: unknown[] = [],
): Promise<void> {
    await callRawWorker(adapter, "prepare-run", { sql, params });
}

function jsonSnapshot(value: unknown): any {
    return JSON.parse(JSON.stringify(value));
}

function publicBackupStore(value: unknown): Record<string, unknown> {
    const store = jsonSnapshot(value) as Record<string, unknown>;
    delete store.sqliteBackup;
    return store;
}

function backupSnapshot(value: unknown): Record<string, any> {
    const sidecar = (value as { sqliteBackup?: { snapshot?: unknown } })
        .sqliteBackup;
    if (!sidecar?.snapshot || typeof sidecar.snapshot !== "object") {
        throw new Error("Decoded SQLite backup is missing its snapshot");
    }
    return sidecar.snapshot as Record<string, any>;
}

function rawStateWithoutGeneration(snapshot: Record<string, any>): Record<string, any> {
    const { factsGeneration: _factsGeneration, ...rawState } = jsonSnapshot(snapshot);
    return rawState;
}

async function seedAtomicState(
    adapter: SqliteAdapter,
    prefix: string,
): Promise<{ factId: string; query: string; atTimestamp: number }> {
    const timestamp = 1_700_100_000_000;
    const episodeId = `${prefix}-episode`;
    const factId = `${prefix}-fact`;
    const episode: Episode = {
        id: episodeId,
        content: `${prefix} atomic episode`,
        summary: `${prefix} atomic summary`,
        timestamp,
        role: "assistant",
        importance: {
            importance: 0.9,
            surprise: 0.4,
            emotion: 0.3,
            utility: 0.8,
        },
        encodingContext: { project: `${prefix}-project` },
        consolidated: false,
        recallCount: 2,
        lastAccessed: timestamp + 1,
        strength: 0.9,
        status: "active",
    };
    const fact: Fact = {
        id: factId,
        content: `${prefix} atomic searchable fact`,
        entities: [`${prefix}-entity`, "atomic"],
        topics: ["atomic-backup"],
        createdAt: timestamp + 2,
        updatedAt: timestamp + 3,
        importance: 0.9,
        recallCount: 1,
        lastAccessed: timestamp + 4,
        strength: 0.9,
        status: "active",
        validFrom: timestamp,
        validTo: timestamp + 1_000,
        sourceEpisodes: [episodeId],
        encodingContext: { project: `${prefix}-project` },
        structured: {
            subject: "atomic",
            property: "state",
            value: prefix,
            polarity: "affirmed",
            cardinality: "single",
        },
    };
    await adapter.episode.store(episode);
    await adapter.semantic.upsert(fact);
    await adapter.upsertEpoch({
        id: `${prefix}-epoch`,
        name: "",
        description: `${prefix} atomic epoch`,
        start: timestamp,
        end: timestamp + 1_000,
        sourceEpisodeId: episodeId,
    });
    await adapter.procedural.recordOutcome(`${prefix}-skill`, true);
    await adapter.procedural.recordOutcome(`${prefix}-skill`, false);
    await adapter.procedural.learnFromFailure({
        task: `${prefix} atomic task`,
        failure: `${prefix} atomic failure`,
        analysis: `${prefix} atomic analysis`,
        correction: `${prefix} atomic correction`,
        timestamp: timestamp + 5,
    });
    await adapter.semantic.associate(
        `${prefix} Entity A`,
        `${prefix} Entity B`,
        0.37,
    );
    return {
        factId,
        query: `${prefix} atomic searchable`,
        atTimestamp: timestamp + 500,
    };
}

async function captureAtomicDerivedState(
    adapter: SqliteAdapter,
    query: string,
    atTimestamp: number,
): Promise<Record<string, any>> {
    const surface = await adapter.semantic.search(query, 10, false);
    const deep = await adapter.semantic.search(query, 10, true);
    const atTime = await adapter.semantic.search("", 10, false, {
        mode: "at-time",
        atTimestamp,
    });
    const fts = await callRawWorker(adapter, "prepare-all", {
        sql: "SELECT rowid, content, entities, topics FROM facts_fts ORDER BY rowid",
        params: [],
    });
    const hotFts = await callRawWorker(adapter, "prepare-all", {
        sql: "SELECT rowid, content, entities, topics FROM facts_fts_hot ORDER BY rowid",
        params: [],
    });
    const rtree = await callRawWorker(adapter, "prepare-all", {
        sql: "SELECT id, min_ts, max_ts FROM facts_time_idx ORDER BY id",
        params: [],
    });
    const idMap = await callRawWorker(adapter, "prepare-all", {
        sql: "SELECT fid, fact_id FROM id_map ORDER BY fid",
        params: [],
    });
    return {
        surface: surface.map(({ id }) => id),
        deep: deep.map(({ id }) => id),
        atTime: atTime.map(({ id }) => id),
        fts,
        hotFts,
        rtree,
        idMap,
        hotVectors: await exactVectorMatches(adapter, "vec_facts_hot"),
        mainVectors: await exactVectorMatches(adapter, "vec_facts"),
    };
}

describe("SqliteAdapter backup import", () => {
    it("replaces target data through the public provider and survives reopen", async () => {
        const sourceFixture = makeFixture();
        const targetFixture = makeFixture();
        const sourceAdapter = new SqliteAdapter({ dbPath: sourceFixture.dbPath });
        const targetAdapter = new SqliteAdapter({ dbPath: targetFixture.dbPath });
        const sourceProvider = new NaiaMemoryProvider({ adapter: sourceAdapter });
        const targetProvider = new NaiaMemoryProvider({ adapter: targetAdapter });
        let reopenedAdapter: SqliteAdapter | undefined;
        try {
            const sourceFact = makeFact("SQLite public import source fact");
            const targetOnlyFact = makeFact("SQLite target data is replaced");
            await sourceAdapter.semantic.upsert(sourceFact);
            await targetAdapter.semantic.upsert(targetOnlyFact);

            expect(sourceProvider.supportsBackup()).toBe(true);
            const blob = await sourceProvider.exportBackup("roundtrip-password");
            expect(blob).toBeInstanceOf(Uint8Array);
            await targetProvider.importBackup(blob, "roundtrip-password");

            expect(
                (await targetAdapter.semantic.getAll()).map((fact) => fact.content),
            ).toEqual([sourceFact.content]);

            await targetProvider.close();
            reopenedAdapter = new SqliteAdapter({ dbPath: targetFixture.dbPath });
            expect(
                (await reopenedAdapter.semantic.getAll()).map((fact) => fact.content),
            ).toEqual([sourceFact.content]);
        } finally {
            await reopenedAdapter?.close();
            await sourceProvider.close();
            await targetProvider.close();
            rmSync(sourceFixture.tempDir, { recursive: true, force: true });
            rmSync(targetFixture.tempDir, { recursive: true, force: true });
        }
    });

    it("rejects a wrong password without changing target data across reopen", async () => {
        const sourceFixture = makeFixture();
        const targetFixture = makeFixture();
        const sourceAdapter = new SqliteAdapter({ dbPath: sourceFixture.dbPath });
        const targetAdapter = new SqliteAdapter({ dbPath: targetFixture.dbPath });
        const sourceProvider = new NaiaMemoryProvider({ adapter: sourceAdapter });
        const targetProvider = new NaiaMemoryProvider({ adapter: targetAdapter });
        let reopenedAdapter: SqliteAdapter | undefined;
        try {
            const sourceFact = makeFact("SQLite authenticated import source");
            const targetOnlyFact = makeFact("SQLite wrong password keeps target");
            await sourceAdapter.semantic.upsert(sourceFact);
            await targetAdapter.semantic.upsert(targetOnlyFact);
            const blob = await sourceProvider.exportBackup("correct-password");

            await expect(
                targetProvider.importBackup(blob, "wrong-password"),
            ).rejects.toThrow("Decryption failed: wrong password or corrupted blob");
            expect(
                (await targetAdapter.semantic.getAll()).map((fact) => fact.content),
            ).toEqual([targetOnlyFact.content]);

            await targetProvider.close();
            reopenedAdapter = new SqliteAdapter({ dbPath: targetFixture.dbPath });
            expect(
                (await reopenedAdapter.semantic.getAll()).map((fact) => fact.content),
            ).toEqual([targetOnlyFact.content]);
        } finally {
            await reopenedAdapter?.close();
            await sourceProvider.close();
            await targetProvider.close();
            rmSync(sourceFixture.tempDir, { recursive: true, force: true });
            rmSync(targetFixture.tempDir, { recursive: true, force: true });
        }
    });

    it("rejects tampered or truncated encrypted blobs without changing target data across reopen", async () => {
        const sourceFixture = makeFixture();
        const targetFixture = makeFixture();
        const sourceAdapter = new SqliteAdapter({ dbPath: sourceFixture.dbPath });
        const targetAdapter = new SqliteAdapter({ dbPath: targetFixture.dbPath });
        const sourceProvider = new NaiaMemoryProvider({ adapter: sourceAdapter });
        const targetProvider = new NaiaMemoryProvider({ adapter: targetAdapter });
        let reopenedAdapter: SqliteAdapter | undefined;
        try {
            const sourceFact = makeFact("SQLite corrupted import source");
            const targetOnlyFact = makeFact("SQLite corrupted blob keeps target");
            await sourceAdapter.semantic.upsert(sourceFact);
            await targetAdapter.semantic.upsert(targetOnlyFact);
            const blob = await sourceProvider.exportBackup("tamper-password");

            const tamperedHeader = new Uint8Array(blob);
            tamperedHeader[0] ^= 0xff;
            const tamperedVersion = new Uint8Array(blob);
            tamperedVersion[4] = 0x02;
            const tamperedCiphertext = new Uint8Array(blob);
            tamperedCiphertext[tamperedCiphertext.length - 1] ^= 0xff;
            const cases = [
                {
                    name: "header magic",
                    blob: tamperedHeader,
                    error: "Invalid backup blob: bad magic",
                },
                {
                    name: "header version",
                    blob: tamperedVersion,
                    error: "Unsupported backup version: 2",
                },
                {
                    name: "ciphertext",
                    blob: tamperedCiphertext,
                    error: "Decryption failed: wrong password or corrupted blob",
                },
                {
                    name: "truncated ciphertext",
                    blob: blob.slice(0, -1),
                    error: "Decryption failed: wrong password or corrupted blob",
                },
            ];

            for (const testCase of cases) {
                await expect(
                    targetProvider.importBackup(testCase.blob, "tamper-password"),
                    testCase.name,
                ).rejects.toThrow(testCase.error);
                expect(
                    (await targetAdapter.semantic.getAll()).map(
                        (fact) => fact.content,
                    ),
                ).toEqual([targetOnlyFact.content]);
            }

            await targetProvider.close();
            reopenedAdapter = new SqliteAdapter({ dbPath: targetFixture.dbPath });
            expect(
                (await reopenedAdapter.semantic.getAll()).map(
                    (fact) => fact.content,
                ),
            ).toEqual([targetOnlyFact.content]);
        } finally {
            await reopenedAdapter?.close();
            await sourceProvider.close();
            await targetProvider.close();
            rmSync(sourceFixture.tempDir, { recursive: true, force: true });
            rmSync(targetFixture.tempDir, { recursive: true, force: true });
        }
    });

    it("round-trips complete raw and public state through export, import, and reopen", async () => {
        const sourceFixture = makeFixture();
        const targetFixture = makeFixture();
        const sourceAdapter = new SqliteAdapter({ dbPath: sourceFixture.dbPath });
        const targetAdapter = new SqliteAdapter({ dbPath: targetFixture.dbPath });
        const sourceProvider = new NaiaMemoryProvider({ adapter: sourceAdapter });
        const targetProvider = new NaiaMemoryProvider({ adapter: targetAdapter });
        let reopenedAdapter: SqliteAdapter | undefined;
        const timestamp = 1_700_000_000_000;
        const episode: Episode = {
            id: "raw-roundtrip-episode",
            content: "raw episode content",
            summary: "raw episode summary",
            timestamp: timestamp + 1,
            role: "tool",
            importance: {
                importance: 0.91,
                surprise: 0.37,
                emotion: 0.82,
                utility: 0.73,
            },
            encodingContext: {
                project: "raw-project",
                activeFile: "raw.ts",
                taskDescription: "raw roundtrip",
                sessionId: "raw-session",
                category: "engineering",
            },
            consolidated: false,
            recallCount: 4,
            lastAccessed: timestamp + 2,
            strength: 0.73,
            status: "archived",
        };
        const fact: Fact = {
            id: "raw-roundtrip-fact-v7",
            content: "raw fact content",
            entities: ["Raw Entity", "Backup Anchor"],
            topics: ["raw-topic"],
            createdAt: timestamp + 3,
            updatedAt: timestamp + 4,
            importance: 0.81,
            recallCount: 3,
            lastAccessed: timestamp + 5,
            strength: 0.71,
            maxEmotion: 0.94,
            status: "superseded",
            validFrom: timestamp - 10,
            validTo: timestamp + 500,
            successorId: "raw-roundtrip-fact-v8",
            supersedes: "raw-roundtrip-fact-v6",
            sourceEpisodes: [episode.id],
            encodingContext: {
                project: "raw-project",
                activeFile: "raw.ts",
                taskDescription: "raw fact",
                sessionId: "raw-session",
                category: "engineering",
            },
            structured: {
                subject: "user",
                subjectId: "user:raw",
                property: "status",
                propertyId: "status:raw",
                value: "ready",
                polarity: "negated",
                cardinality: "single",
                provenance: "caller",
            },
        };
        const reflection: Reflection = {
            task: "raw roundtrip task",
            failure: "raw roundtrip failure",
            analysis: "raw roundtrip analysis",
            correction: "raw roundtrip correction",
            timestamp: timestamp + 6,
        };
        const associationEntityA = "Association A";
        const associationEntityB = "Association B";
        const associationKey = [
            associationEntityA.toLowerCase(),
            associationEntityB.toLowerCase(),
        ].sort().join("::");
        try {
            await sourceAdapter.episode.store(episode);
            await sourceAdapter.semantic.upsert(fact);
            await sourceAdapter.upsertEpoch({
                id: "raw-roundtrip-epoch",
                name: "",
                description: "zero-time epoch",
                start: 0,
                end: null,
                sourceEpisodeId: episode.id,
            });
            await sourceAdapter.procedural.recordOutcome("raw-roundtrip-skill", true);
            await sourceAdapter.procedural.recordOutcome("raw-roundtrip-skill", false);
            await sourceAdapter.procedural.learnFromFailure(reflection);
            await sourceAdapter.semantic.associate(
                associationEntityA,
                associationEntityB,
                0.37,
            );

            // Exercise nullable/legacy raw columns that have no public Local
            // field while keeping the public projection deterministic.
            await executeSql(
                sourceAdapter,
                "UPDATE skills SET id = NULL, learned_at = 0, usage_count = 7, last_used = 0 WHERE name = ?",
                ["raw-roundtrip-skill"],
            );
            await executeSql(
                sourceAdapter,
                "UPDATE reflections SET id = ?, content = ?, importance = ? WHERE task = ?",
                [
                    "raw-roundtrip-reflection",
                    "raw reflection payload",
                    0.42,
                    reflection.task,
                ],
            );
            const normalizedA = associationEntityA.toLowerCase().trim();
            const normalizedB = associationEntityB.toLowerCase().trim();
            await executeSql(
                sourceAdapter,
                "UPDATE kg_edges SET last_strengthened = 0 WHERE source = ? AND target = ?",
                [
                    ...[normalizedA, normalizedB].sort(),
                ],
            );

            const sourceDerived = await captureAtomicDerivedState(
                sourceAdapter,
                fact.content,
                timestamp + 100,
            );
            const sourceBlob = await sourceProvider.exportBackup("raw-state-password");
            const decodedSource = await decodeLocalBackup(
                sourceBlob,
                "raw-state-password",
            );
            const sourceRaw = backupSnapshot(decodedSource);
            const sourcePublic = publicBackupStore(decodedSource);

            const rawFact = sourceRaw.facts.find((row: any) => row.id === fact.id);
            expect(rawFact).toEqual(expect.objectContaining({
                base_id: "raw-roundtrip-fact",
                valid_from: timestamp - 10,
                valid_to: timestamp + 500,
                successor_id: "raw-roundtrip-fact-v8",
                supersedes: "raw-roundtrip-fact-v6",
                structured_fact: JSON.stringify(fact.structured),
            }));
            expect(sourceRaw.episodes).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    id: episode.id,
                    timestamp: timestamp + 1,
                    consolidated: 0,
                    status: "archived",
                }),
            ]));
            expect(sourceRaw.epochs).toEqual(expect.arrayContaining([
                expect.objectContaining({ id: "raw-roundtrip-epoch", name: "", start_time: 0 }),
            ]));
            expect(sourceRaw.skills).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    id: null,
                    name: "raw-roundtrip-skill",
                    learned_at: 0,
                    usage_count: 7,
                    last_used: 0,
                }),
            ]));
            expect(sourceRaw.reflections).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    id: "raw-roundtrip-reflection",
                    content: "raw reflection payload",
                    importance: 0.42,
                }),
            ]));
            expect(sourceRaw.associations).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    association_key: associationKey,
                    entity_a: associationEntityA,
                    entity_b: associationEntityB,
                    weight: 0.37,
                }),
            ]));
            expect(sourceRaw.kgEdges).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    source: normalizedA,
                    target: normalizedB,
                    last_strengthened: 0,
                }),
            ]));

            expect(sourcePublic.facts).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    id: fact.id,
                    status: fact.status,
                    validFrom: fact.validFrom,
                    validTo: fact.validTo,
                    structured: fact.structured,
                }),
            ]));
            expect(sourcePublic.episodes).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    id: episode.id,
                    summary: episode.summary,
                    status: episode.status,
                }),
            ]));
            expect(sourcePublic.epochs).toEqual(expect.arrayContaining([
                expect.objectContaining({ id: "raw-roundtrip-epoch", name: "", start: 0, end: null }),
            ]));
            expect(sourcePublic.skills).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    id: "legacy-skill:raw-roundtrip-skill",
                    learnedAt: 0,
                    successCount: 1,
                    failureCount: 1,
                }),
            ]));
            expect(sourcePublic.reflections).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    task: reflection.task,
                    analysis: reflection.analysis,
                    correction: reflection.correction,
                }),
            ]));
            expect((sourcePublic.associations as Record<string, number>)[associationKey])
                .toBeCloseTo(0.37, 10);

            const targetState = await seedAtomicState(targetAdapter, "raw-target");
            const targetBeforeDerived = await captureAtomicDerivedState(
                targetAdapter,
                targetState.query,
                targetState.atTimestamp,
            );
            const targetBeforeDecoded = await decodeLocalBackup(
                await targetProvider.exportBackup("target-state-password"),
                "target-state-password",
            );
            const targetBeforeRaw = backupSnapshot(targetBeforeDecoded);
            const targetBeforePublic = publicBackupStore(targetBeforeDecoded);
            const targetBeforeIdentity = await callRawWorker(
                targetAdapter,
                "backup-target",
                {},
            );
            const tamperedBlob = sourceBlob.slice();
            tamperedBlob[tamperedBlob.length - 1] ^= 0x01;
            const authenticationFailures = [
                {
                    name: "wrong password",
                    blob: sourceBlob,
                    password: "wrong-password",
                },
                {
                    name: "tampered ciphertext",
                    blob: tamperedBlob,
                    password: "raw-state-password",
                },
                {
                    name: "truncated blob",
                    blob: sourceBlob.slice(0, -1),
                    password: "raw-state-password",
                },
            ];
            for (const failure of authenticationFailures) {
                await expect(
                    targetProvider.importBackup(failure.blob, failure.password),
                    failure.name,
                ).rejects.toThrow(/Decryption failed: wrong password or corrupted blob/);
                const afterFailure = await decodeLocalBackup(
                    await targetProvider.exportBackup("target-state-password"),
                    "target-state-password",
                );
                expect(backupSnapshot(afterFailure)).toEqual(targetBeforeRaw);
                expect(publicBackupStore(afterFailure)).toEqual(targetBeforePublic);
                expect(await captureAtomicDerivedState(
                    targetAdapter,
                    targetState.query,
                    targetState.atTimestamp,
                )).toEqual(targetBeforeDerived);
                expect(await callRawWorker(targetAdapter, "backup-target", {}))
                    .toEqual(targetBeforeIdentity);
            }

            await targetProvider.close();
            reopenedAdapter = new SqliteAdapter({ dbPath: targetFixture.dbPath });
            const preservedReopen = await decodeLocalBackup(
                await reopenedAdapter.export("target-state-password"),
                "target-state-password",
            );
            expect(backupSnapshot(preservedReopen)).toEqual(targetBeforeRaw);
            expect(publicBackupStore(preservedReopen)).toEqual(targetBeforePublic);
            expect(await captureAtomicDerivedState(
                reopenedAdapter,
                targetState.query,
                targetState.atTimestamp,
            )).toEqual(targetBeforeDerived);
            expect(await callRawWorker(reopenedAdapter, "backup-target", {}))
                .toEqual(targetBeforeIdentity);

			await reopenedAdapter.import(sourceBlob, "raw-state-password");
			await reopenedAdapter.close();
			reopenedAdapter = new SqliteAdapter({ dbPath: targetFixture.dbPath });
			expect(await captureAtomicDerivedState(
				reopenedAdapter,
                fact.content,
                timestamp + 100,
            )).toEqual(sourceDerived);

            const reopenedBlob = await reopenedAdapter.export("raw-state-password");
            const decodedTarget = await decodeLocalBackup(
                reopenedBlob,
                "raw-state-password",
            );
            const targetRaw = backupSnapshot(decodedTarget);
            expect(rawStateWithoutGeneration(targetRaw)).toEqual(
                rawStateWithoutGeneration(sourceRaw),
            );
            expect(targetRaw.factsGeneration).toBeGreaterThan(sourceRaw.factsGeneration);
            expect(publicBackupStore(decodedTarget)).toEqual(sourcePublic);
        } finally {
            await reopenedAdapter?.close();
            await sourceProvider.close();
            await targetProvider.close();
            rmSync(sourceFixture.tempDir, { recursive: true, force: true });
            rmSync(targetFixture.tempDir, { recursive: true, force: true });
        }
    });

    it("round-trips same-space vectors and hot/cold exact search across reopen", async () => {
        const sourceFixture = makeFixture();
        const targetFixture = makeFixture();
        const sourceEmbeddingProvider = makeVectorProvider("sqlite-backup-vectors-v1");
        const targetEmbeddingProvider = makeVectorProvider("sqlite-backup-vectors-v1");
        const sourceAdapter = new SqliteAdapter({
            dbPath: sourceFixture.dbPath,
            embeddingProvider: sourceEmbeddingProvider,
        });
        const targetAdapter = new SqliteAdapter({
            dbPath: targetFixture.dbPath,
            embeddingProvider: targetEmbeddingProvider,
        });
        const sourceProvider = new NaiaMemoryProvider({ adapter: sourceAdapter });
        const targetProvider = new NaiaMemoryProvider({ adapter: targetAdapter });
        let reopenedAdapter: SqliteAdapter | undefined;
        try {
            const hotFact = {
                ...makeFact("vector-hot-anchor"),
                id: "vector-hot-fact",
                strength: 0.9,
            };
            const mainFact = {
                ...makeFact("vector-main-anchor"),
                id: "vector-main-fact",
                strength: 0.4,
            };
            await sourceAdapter.semantic.upsert(hotFact);
            await sourceAdapter.semantic.upsert(mainFact);

            const sourceBlob = await sourceProvider.exportBackup("vector-password");
            const sourceDecoded = await decodeLocalBackup(sourceBlob, "vector-password");
            const sourceSnapshot = backupSnapshot(sourceDecoded);
            expect(sourceSnapshot.vectors).toEqual(expect.objectContaining({
                dimensions: 2,
                embeddingSpaceId: "sqlite-backup-vectors-v1",
                facts: expect.arrayContaining([
                    expect.objectContaining({
                        factId: hotFact.id,
                        embedding: [1, 0],
                        hot: true,
                    }),
                    expect.objectContaining({
                        factId: mainFact.id,
                        embedding: [0, 1],
                        hot: false,
                    }),
                ]),
            }));

            const sourceSurface = await sourceAdapter.semantic.search(
                "vector-query",
                10,
                false,
            );
            const sourceDeep = await sourceAdapter.semantic.search(
                "vector-query",
                10,
                true,
            );
            expect(sourceSurface.map(({ id }) => id)).toEqual([hotFact.id]);
            expect(sourceDeep.map(({ id }) => id)).toEqual([hotFact.id, mainFact.id]);

            const sourceHotExact = await exactVectorMatches(sourceAdapter, "vec_facts_hot");
            const sourceMainExact = await exactVectorMatches(sourceAdapter, "vec_facts");
            expect(sourceHotExact.map(({ fact_id }) => fact_id)).toEqual([hotFact.id]);
            expect(sourceHotExact[0]?.distance).toBeCloseTo(0, 10);
            expect(sourceMainExact.map(({ fact_id }) => fact_id)).toEqual([
                hotFact.id,
                mainFact.id,
            ]);
            expect(sourceMainExact[0]?.distance).toBeCloseTo(0, 10);
            expect(sourceMainExact[1]?.distance).toBeCloseTo(Math.SQRT2, 6);

            await targetProvider.importBackup(sourceBlob, "vector-password");
            const targetDecoded = await decodeLocalBackup(
                await targetProvider.exportBackup("vector-password"),
                "vector-password",
            );
            expect(backupSnapshot(targetDecoded).vectors).toEqual(sourceSnapshot.vectors);
            expect(
                (await targetAdapter.semantic.search("vector-query", 10, false))
                    .map(({ id }) => id),
            ).toEqual(sourceSurface.map(({ id }) => id));
            expect(
                (await targetAdapter.semantic.search("vector-query", 10, true))
                    .map(({ id }) => id),
            ).toEqual(sourceDeep.map(({ id }) => id));
            expect(await exactVectorMatches(targetAdapter, "vec_facts_hot"))
                .toEqual(sourceHotExact);
            const targetMainExact = await exactVectorMatches(targetAdapter, "vec_facts");
            expect(targetMainExact.map(({ fact_id }) => fact_id)).toEqual(
                sourceMainExact.map(({ fact_id }) => fact_id),
            );
            targetMainExact.forEach((match, index) => {
                expect(match.distance).toBeCloseTo(sourceMainExact[index]!.distance, 6);
            });

            await targetProvider.close();
            reopenedAdapter = new SqliteAdapter({
                dbPath: targetFixture.dbPath,
                embeddingProvider: targetEmbeddingProvider,
            });
            expect(
                (await reopenedAdapter.semantic.search("vector-query", 10, false))
                    .map(({ id }) => id),
            ).toEqual(sourceSurface.map(({ id }) => id));
            expect(
                (await reopenedAdapter.semantic.search("vector-query", 10, true))
                    .map(({ id }) => id),
            ).toEqual(sourceDeep.map(({ id }) => id));
            expect(await exactVectorMatches(reopenedAdapter, "vec_facts_hot"))
                .toEqual(sourceHotExact);
            const reopenedMainExact = await exactVectorMatches(reopenedAdapter, "vec_facts");
            expect(reopenedMainExact.map(({ fact_id }) => fact_id)).toEqual(
                sourceMainExact.map(({ fact_id }) => fact_id),
            );
            reopenedMainExact.forEach((match, index) => {
                expect(match.distance).toBeCloseTo(sourceMainExact[index]!.distance, 6);
            });
            const reopenedDecoded = await decodeLocalBackup(
                await reopenedAdapter.export("vector-password"),
                "vector-password",
            );
            expect(backupSnapshot(reopenedDecoded).vectors).toEqual(sourceSnapshot.vectors);
        } finally {
            await reopenedAdapter?.close();
            await sourceProvider.close();
            await targetProvider.close();
            rmSync(sourceFixture.tempDir, { recursive: true, force: true });
            rmSync(targetFixture.tempDir, { recursive: true, force: true });
        }
    });

    it("preserves vectorless identity and rejects incompatible vector targets before mutation", async () => {
        const vectorlessSourceFixture = makeFixture();
        const vectorlessTargetFixture = makeFixture();
        const vectorlessSourceAdapter = new SqliteAdapter({
            dbPath: vectorlessSourceFixture.dbPath,
        });
        const vectorlessTargetAdapter = new SqliteAdapter({
            dbPath: vectorlessTargetFixture.dbPath,
        });
        const vectorlessSourceProvider = new NaiaMemoryProvider({
            adapter: vectorlessSourceAdapter,
        });
        const vectorlessTargetProvider = new NaiaMemoryProvider({
            adapter: vectorlessTargetAdapter,
        });
        let vectorlessReopenedAdapter: SqliteAdapter | undefined;
        try {
            const vectorlessSourceFact = {
                ...makeFact("vectorless source identity"),
                id: "vectorless-source-fact",
            };
            const vectorlessTargetFact = {
                ...makeFact("vectorless target remains"),
                id: "vectorless-target-fact",
            };
            await vectorlessSourceAdapter.semantic.upsert(vectorlessSourceFact);
            await vectorlessTargetAdapter.semantic.upsert(vectorlessTargetFact);
            const vectorlessSourceBlob = await vectorlessSourceProvider.exportBackup(
                "vectorless-password",
            );
            const vectorlessSourceDecoded = await decodeLocalBackup(
                vectorlessSourceBlob,
                "vectorless-password",
            );
            const vectorlessSourceSnapshot = backupSnapshot(vectorlessSourceDecoded);
            expect(vectorlessSourceSnapshot.vectors).toEqual({
                dimensions: null,
                facts: [],
            });

            await vectorlessTargetProvider.importBackup(
                vectorlessSourceBlob,
                "vectorless-password",
            );
            const vectorlessTargetDecoded = await decodeLocalBackup(
                await vectorlessTargetProvider.exportBackup("vectorless-password"),
                "vectorless-password",
            );
            expect(publicBackupStore(vectorlessTargetDecoded)).toEqual(
                publicBackupStore(vectorlessSourceDecoded),
            );
            await vectorlessTargetProvider.close();
            vectorlessReopenedAdapter = new SqliteAdapter({
                dbPath: vectorlessTargetFixture.dbPath,
            });
            const vectorlessReopenedDecoded = await decodeLocalBackup(
                await vectorlessReopenedAdapter.export("vectorless-password"),
                "vectorless-password",
            );
            expect(backupSnapshot(vectorlessReopenedDecoded).vectors).toEqual(
                vectorlessSourceSnapshot.vectors,
            );
            expect(publicBackupStore(vectorlessReopenedDecoded)).toEqual(
                publicBackupStore(vectorlessSourceDecoded),
            );
        } finally {
            await vectorlessReopenedAdapter?.close();
            await vectorlessSourceProvider.close();
            await vectorlessTargetProvider.close();
            rmSync(vectorlessSourceFixture.tempDir, { recursive: true, force: true });
            rmSync(vectorlessTargetFixture.tempDir, { recursive: true, force: true });
        }

        const sourceFixture = makeFixture();
        const sourceEmbeddingProvider = makeVectorProvider("sqlite-backup-vectors-v1");
        const sourceAdapter = new SqliteAdapter({
            dbPath: sourceFixture.dbPath,
            embeddingProvider: sourceEmbeddingProvider,
        });
        const sourceProvider = new NaiaMemoryProvider({ adapter: sourceAdapter });
        try {
            const sourceFact = {
                ...makeFact("incompatible vector source"),
                id: "incompatible-source-fact",
            };
            await sourceAdapter.semantic.upsert(sourceFact);
            const sourceBlob = await sourceProvider.exportBackup("mismatch-password");

            const mismatches = [
                {
                    label: "space",
                    embeddingProvider: makeVectorProvider("sqlite-backup-vectors-other-v1"),
                },
                {
                    label: "dimensions",
                    embeddingProvider: makeVectorProvider("sqlite-backup-vectors-v1", 3),
                },
            ];
            for (const { label, embeddingProvider } of mismatches) {
                const targetFixture = makeFixture();
                const targetAdapter = new SqliteAdapter({
                    dbPath: targetFixture.dbPath,
                    embeddingProvider,
                });
                const targetProvider = new NaiaMemoryProvider({ adapter: targetAdapter });
                let reopenedAdapter: SqliteAdapter | undefined;
                try {
                    const targetFact = {
                        ...makeFact(`incompatible target ${label}`),
                        id: `incompatible-target-${label}`,
                    };
                    await targetAdapter.semantic.upsert(targetFact);
                    const before = await targetProvider.exportBackup("target-password");
                    await expect(
                        targetProvider.importBackup(sourceBlob, "mismatch-password"),
                    ).rejects.toThrow("SQLite backup target does not match current adapter");
                    const after = await targetProvider.exportBackup("target-password");
                    expect(publicBackupStore(
                        await decodeLocalBackup(after, "target-password"),
                    )).toEqual(publicBackupStore(
                        await decodeLocalBackup(before, "target-password"),
                    ));

                    await targetProvider.close();
                    reopenedAdapter = new SqliteAdapter({
                        dbPath: targetFixture.dbPath,
                        embeddingProvider,
                    });
                    await expect(reopenedAdapter.semantic.getAll()).resolves.toEqual(
                        expect.arrayContaining([
                            expect.objectContaining({
                                id: targetFact.id,
                                content: targetFact.content,
                            }),
                        ]),
                    );
                } finally {
                    await reopenedAdapter?.close();
                    await targetProvider.close();
                    rmSync(targetFixture.tempDir, { recursive: true, force: true });
                }
            }
        } finally {
            await sourceProvider.close();
            rmSync(sourceFixture.tempDir, { recursive: true, force: true });
        }
    });

    it("rejects authenticated malformed snapshots before mutating target state", async () => {
        const sourceFixture = makeFixture();
        const targetFixture = makeFixture();
        const sourceEmbeddingProvider = makeVectorProvider("sqlite-backup-malformed-v1");
        const targetEmbeddingProvider = makeVectorProvider("sqlite-backup-malformed-v1");
        const sourceAdapter = new SqliteAdapter({
            dbPath: sourceFixture.dbPath,
            embeddingProvider: sourceEmbeddingProvider,
        });
        const targetAdapter = new SqliteAdapter({
            dbPath: targetFixture.dbPath,
            embeddingProvider: targetEmbeddingProvider,
        });
        const sourceProvider = new NaiaMemoryProvider({ adapter: sourceAdapter });
        const targetProvider = new NaiaMemoryProvider({ adapter: targetAdapter });
        let reopenedAdapter: SqliteAdapter | undefined;
        try {
            const sourceFact = {
                ...makeFact("authenticated malformed source"),
                id: "malformed-source-fact",
            };
            const targetFact = {
                ...makeFact("malformed target must survive"),
                id: "malformed-target-fact",
            };
            await sourceAdapter.semantic.upsert(sourceFact);
            await targetAdapter.semantic.upsert(targetFact);

            const sourceBlob = await sourceProvider.exportBackup("malformed-password");
            const sourceDecoded = await decodeLocalBackup(
                sourceBlob,
                "malformed-password",
            );
            const sourceSnapshot = backupSnapshot(sourceDecoded);
            const sourceFactId = String(sourceSnapshot.facts[0]?.id);
            const sourceVector = sourceSnapshot.vectors.facts.find(
                (vector: { factId: string }) => vector.factId === sourceFactId,
            );
            expect(sourceVector).toBeDefined();

            const beforeDecoded = await decodeLocalBackup(
                await targetProvider.exportBackup("target-state-password"),
                "target-state-password",
            );
            const beforeRaw = backupSnapshot(beforeDecoded);
            const beforePublic = publicBackupStore(beforeDecoded);
            const beforeHotVectors = await exactVectorMatches(
                targetAdapter,
                "vec_facts_hot",
            );
            const beforeMainVectors = await exactVectorMatches(
                targetAdapter,
                "vec_facts",
            );

            type MutableBackupStore = MemoryStore & {
                factEmbeddings: Record<string, number[]>;
            } & Record<string, any>;
            const malformedCases: Array<{
                name: string;
                error: RegExp;
                mutate: (store: MutableBackupStore) => void;
            }> = [
                {
                    name: "malformed collection shape",
                    error: /SQLite backup facts are invalid/,
                    mutate: (store) => {
                        store.sqliteBackup.snapshot.facts = null;
                    },
                },
                {
                    name: "public fact conflicts with authenticated raw fact",
                    error: /public projection does not match authenticated snapshot/,
                    mutate: (store) => {
                        store.facts[0].content = "conflicting public content";
                    },
                },
                {
                    name: "unsupported episode embeddings",
                    error: /episode embeddings are unsupported/,
                    mutate: (store) => {
                        store.episodeEmbeddings = {
                            "malformed-episode": [1, 0],
                        };
                    },
                },
                {
                    name: "raw numeric field has string shape",
                    error: /kgNodes\[0\]\.frequency must be a finite number/,
                    mutate: (store) => {
                        store.sqliteBackup.snapshot.kgNodes[0].frequency = String(
                            store.sqliteBackup.snapshot.kgNodes[0].frequency,
                        );
                    },
                },
                {
                    name: "raw serialized JSON has wrong container shape",
                    error: /public projection does not match authenticated snapshot/,
                    mutate: (store) => {
                        store.sqliteBackup.snapshot.facts[0].entities = JSON.stringify({
                            unsupported: true,
                        });
                    },
                },
                {
                    name: "unsupported sidecar version",
                    error: /Invalid SQLite backup sidecar/,
                    mutate: (store) => {
                        store.sqliteBackup.version = 2;
                    },
                },
                {
                    name: "duplicate fact id",
                    error: /duplicate fact key/,
                    mutate: (store) => {
                        const duplicateRawFact = jsonSnapshot(
                            store.sqliteBackup.snapshot.facts[0],
                        );
                        const duplicatePublicFact = jsonSnapshot(store.facts[0]);
                        store.sqliteBackup.snapshot.facts.push(duplicateRawFact);
                        store.facts.push(duplicatePublicFact);
                    },
                },
                {
                    name: "orphan vector fact id",
                    error: /vector references unknown fact/,
                    mutate: (store) => {
                        const orphanId = "malformed-orphan-vector";
                        store.sqliteBackup.snapshot.vectors.facts.push({
                            factId: orphanId,
                            embedding: [1, 0],
                            hot: false,
                        });
                        store.factEmbeddings[orphanId] = [1, 0];
                    },
                },
                {
                    name: "mixed embedding space",
                    error: /vector identity does not match target/,
                    mutate: (store) => {
                        store.sqliteBackup.snapshot.vectors.embeddingSpaceId =
                            "sqlite-backup-malformed-other-space";
                        store.embeddingSpaceId =
                            "sqlite-backup-malformed-other-space";
                    },
                },
                {
                    name: "incompatible vector dimensions",
                    error: /vector identity does not match target/,
                    mutate: (store) => {
                        store.sqliteBackup.snapshot.vectors.dimensions = 3;
                    },
                },
                {
                    name: "Float32 overflow",
                    error: /non-finite vector/,
                    mutate: (store) => {
                        const vector = store.sqliteBackup.snapshot.vectors.facts.find(
                            (candidate: any) => candidate.factId === sourceFactId,
                        );
                        vector.embedding[0] = Number.MAX_VALUE;
                        store.factEmbeddings[sourceFactId][0] = Number.MAX_VALUE;
                    },
                },
            ];

            for (const malformedCase of malformedCases) {
                const malformedStore = jsonSnapshot(
                    sourceDecoded,
                ) as MutableBackupStore;
                malformedCase.mutate(malformedStore);
                const malformedBlob = await encodeLocalBackup(
                    malformedStore,
                    "malformed-password",
                );

                await expect(
                    targetProvider.importBackup(
                        malformedBlob,
                        "malformed-password",
                    ),
                    malformedCase.name,
                ).rejects.toThrow(malformedCase.error);

                const afterDecoded = await decodeLocalBackup(
                    await targetProvider.exportBackup("target-state-password"),
                    "target-state-password",
                );
                expect(backupSnapshot(afterDecoded)).toEqual(beforeRaw);
                expect(publicBackupStore(afterDecoded)).toEqual(beforePublic);
                expect(await exactVectorMatches(targetAdapter, "vec_facts_hot"))
                    .toEqual(beforeHotVectors);
                expect(await exactVectorMatches(targetAdapter, "vec_facts"))
                    .toEqual(beforeMainVectors);
            }

            await targetProvider.close();
            reopenedAdapter = new SqliteAdapter({
                dbPath: targetFixture.dbPath,
                embeddingProvider: targetEmbeddingProvider,
            });
            const reopenedDecoded = await decodeLocalBackup(
                await reopenedAdapter.export("target-state-password"),
                "target-state-password",
            );
            expect(backupSnapshot(reopenedDecoded)).toEqual(beforeRaw);
            expect(publicBackupStore(reopenedDecoded)).toEqual(beforePublic);
            expect(await exactVectorMatches(reopenedAdapter, "vec_facts_hot"))
                .toEqual(beforeHotVectors);
            expect(await exactVectorMatches(reopenedAdapter, "vec_facts"))
                .toEqual(beforeMainVectors);
        } finally {
            await reopenedAdapter?.close();
            await sourceProvider.close();
            await targetProvider.close();
            rmSync(sourceFixture.tempDir, { recursive: true, force: true });
            rmSync(targetFixture.tempDir, { recursive: true, force: true });
        }
    });

    it("rolls back replacement faults after destructive and metadata stages", async () => {
        const sourceFixture = makeFixture();
        const targetFixture = makeFixture();
        const sourceEmbeddingProvider = makeVectorProvider("sqlite-backup-atomic-v1");
        const targetEmbeddingProvider = makeVectorProvider("sqlite-backup-atomic-v1");
        const sourceAdapter = new SqliteAdapter({
            dbPath: sourceFixture.dbPath,
            embeddingProvider: sourceEmbeddingProvider,
        });
        const targetAdapter = new SqliteAdapter({
            dbPath: targetFixture.dbPath,
            embeddingProvider: targetEmbeddingProvider,
        });
        const sourceProvider = new NaiaMemoryProvider({ adapter: sourceAdapter });
        const targetProvider = new NaiaMemoryProvider({ adapter: targetAdapter });
        let reopenedAdapter: SqliteAdapter | undefined;
        try {
            await seedAtomicState(sourceAdapter, "atomic-source");
            const targetState = await seedAtomicState(targetAdapter, "atomic-target");
            const sourceBlob = await sourceProvider.exportBackup("atomic-password");
            const sourceDecoded = await decodeLocalBackup(
                sourceBlob,
                "atomic-password",
            );
            const sourceSnapshot = backupSnapshot(sourceDecoded);
            const beforeDecoded = await decodeLocalBackup(
                await targetProvider.exportBackup("target-state-password"),
                "target-state-password",
            );
            const beforeSnapshot = backupSnapshot(beforeDecoded);
            const beforePublic = publicBackupStore(beforeDecoded);
            const sourceTarget = await callRawWorker(sourceAdapter, "backup-target", {});
            const targetIdentity = await callRawWorker(targetAdapter, "backup-target", {});
            expect(sourceTarget).toEqual(targetIdentity);
            expect((sourceDecoded as any).sqliteBackup.target).toEqual(targetIdentity);

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
                expect(beforeSnapshot[collection]).toEqual(expect.any(Array));
                expect(beforeSnapshot[collection]).not.toHaveLength(0);
            }
            expect(beforeSnapshot.vectors.facts).not.toHaveLength(0);
            expect(sourceSnapshot.facts[0]?.id).not.toBe(beforeSnapshot.facts[0]?.id);

            const beforeDerived = await captureAtomicDerivedState(
                targetAdapter,
                targetState.query,
                targetState.atTimestamp,
            );
            const faultPhases = ["after-facts", "after-metadata"];
            for (const faultAfter of faultPhases) {
                // after-facts runs after the transaction has cleared and begun
                // loading replacement rows; after-metadata faults at its tail.
                await expect(
                    callRawWorker(targetAdapter, "replace-backup", {
                        snapshot: sourceSnapshot,
                        expectedTarget: targetIdentity,
                        faultAfter,
                    }),
                ).rejects.toThrow("SQLite backup test fault injection");

                const afterDecoded = await decodeLocalBackup(
                    await targetProvider.exportBackup("target-state-password"),
                    "target-state-password",
                );
                expect(backupSnapshot(afterDecoded)).toEqual(beforeSnapshot);
                expect(publicBackupStore(afterDecoded)).toEqual(beforePublic);
                expect((afterDecoded as any).sqliteBackup.target).toEqual(targetIdentity);
                expect(await captureAtomicDerivedState(
                    targetAdapter,
                    targetState.query,
                    targetState.atTimestamp,
                )).toEqual(beforeDerived);
            }

            await targetProvider.close();
            reopenedAdapter = new SqliteAdapter({
                dbPath: targetFixture.dbPath,
                embeddingProvider: targetEmbeddingProvider,
            });
            const reopenedDecoded = await decodeLocalBackup(
                await reopenedAdapter.export("target-state-password"),
                "target-state-password",
            );
            expect(backupSnapshot(reopenedDecoded)).toEqual(beforeSnapshot);
            expect(publicBackupStore(reopenedDecoded)).toEqual(beforePublic);
            expect((reopenedDecoded as any).sqliteBackup.target).toEqual(targetIdentity);
            expect(await captureAtomicDerivedState(
                reopenedAdapter,
                targetState.query,
                targetState.atTimestamp,
            )).toEqual(beforeDerived);
        } finally {
            await reopenedAdapter?.close();
            await sourceProvider.close();
            await targetProvider.close();
            rmSync(sourceFixture.tempDir, { recursive: true, force: true });
            rmSync(targetFixture.tempDir, { recursive: true, force: true });
        }
    });

    it.each([
        {
            label: "successful import",
            password: "admission-password",
            expectedImport: "success",
        },
        {
            label: "failed authentication",
            password: "wrong-admission-password",
            expectedImport: "failure",
        },
    ] as const)(
        "drains accepted import and writes before close for $label",
        async ({ password, expectedImport }) => {
            const sourceFixture = makeFixture();
            const targetFixture = makeFixture();
            const priorStarted = deferred<void>();
            const priorGate = deferred<void>();
            const futureEmbedding = { value: false };
            const embeddingSpaceId = "sqlite-backup-admission-v1";
            const sourceAdapter = new SqliteAdapter({
                dbPath: sourceFixture.dbPath,
                embeddingProvider: makeVectorProvider(embeddingSpaceId),
            });
            const targetEmbeddingProvider = makeAdmissionVectorProvider(
                embeddingSpaceId,
                "admission prior accepted write",
                priorStarted,
                priorGate,
                "admission future accepted write",
                futureEmbedding,
            );
            const targetAdapter = new SqliteAdapter({
                dbPath: targetFixture.dbPath,
                embeddingProvider: targetEmbeddingProvider,
            });
            const sourceProvider = new NaiaMemoryProvider({ adapter: sourceAdapter });
            const targetProvider = new NaiaMemoryProvider({ adapter: targetAdapter });
            let reopenedAdapter: SqliteAdapter | undefined;
            try {
                const importedFact = {
                    ...makeFact("admission imported source state"),
                    id: "admission-imported-fact",
                };
                const originalFact = {
                    ...makeFact("admission original target state"),
                    id: "admission-original-fact",
                };
                const priorFact = {
                    ...makeFact("admission prior accepted write"),
                    id: "admission-prior-fact",
                };
                const futureFact = {
                    ...makeFact("admission future accepted write"),
                    id: "admission-future-fact",
                };
                await sourceAdapter.semantic.upsert(importedFact);
                const sourceBlob = await sourceProvider.exportBackup("admission-password");
                await targetAdapter.semantic.upsert(originalFact);

                const priorWrite = targetAdapter.semantic.upsert(priorFact);
                await priorStarted.promise;
                const settlement: string[] = [];
                let priorSettled = false;
                let importSettled = false;
                let futureSettled = false;
                let closeSettled = false;
                const priorObserved = priorWrite.then(() => {
                    priorSettled = true;
                    settlement.push("prior");
                });
                const importPromise = targetProvider.importBackup(sourceBlob, password);
                const importObserved = importPromise.then(
                    () => {
                        importSettled = true;
                        settlement.push("import-success");
                    },
                    () => {
                        importSettled = true;
                        settlement.push("import-failure");
                    },
                );
                const futureWrite = targetAdapter.semantic.upsert(futureFact);
                const futureObserved = futureWrite.then(() => {
                    futureSettled = true;
                    settlement.push("future");
                });
                const closePromise = targetAdapter.close().then(() => {
                    closeSettled = true;
                    settlement.push("close");
                });

                await Promise.resolve();
                expect(priorSettled).toBe(false);
                expect(importSettled).toBe(false);
                expect(futureSettled).toBe(false);
                expect(closeSettled).toBe(false);
                expect(futureEmbedding.value).toBe(false);
                expect(() => targetAdapter.semantic.upsert({
                    ...makeFact("admission rejected after close"),
                    id: "admission-rejected-fact",
                })).toThrow("SQLite adapter is closed");

                priorGate.resolve(undefined);
                await priorObserved;
                await importObserved;
                await futureObserved;
                await closePromise;
                expect(settlement).toEqual([
                    "prior",
                    expectedImport === "success" ? "import-success" : "import-failure",
                    "future",
                    "close",
                ]);
                if (expectedImport === "success") {
                    await expect(importPromise).resolves.toBeUndefined();
                } else {
                    await expect(importPromise).rejects.toThrow(
                        "Decryption failed: wrong password or corrupted blob",
                    );
                }

                await targetProvider.close();
                reopenedAdapter = new SqliteAdapter({
                    dbPath: targetFixture.dbPath,
                    embeddingProvider: targetEmbeddingProvider,
                });
                const reopenedIds = (await reopenedAdapter.semantic.getAll())
                    .map((fact) => fact.id)
                    .sort();
                const expectedIds = (expectedImport === "success"
                    ? [importedFact.id, futureFact.id]
                    : [originalFact.id, priorFact.id, futureFact.id])
                    .sort();
                expect(reopenedIds).toEqual(expectedIds);
            } finally {
                await reopenedAdapter?.close();
                await sourceProvider.close();
                await targetProvider.close();
                rmSync(sourceFixture.tempDir, { recursive: true, force: true });
                rmSync(targetFixture.tempDir, { recursive: true, force: true });
            }
        },
    );

    it.each([
        {
            label: "successful import",
            password: "cache-password",
            expectedImport: "success",
        },
        {
            label: "failed authentication",
            password: "wrong-cache-password",
            expectedImport: "failure",
        },
    ] as const)(
        "keeps late KG reads from resurrecting cache state after $label",
        async ({ password, expectedImport }) => {
            const sourceFixture = makeFixture();
            const targetFixture = makeFixture();
            const sourceAdapter = new SqliteAdapter({ dbPath: sourceFixture.dbPath });
            const targetAdapter = new SqliteAdapter({ dbPath: targetFixture.dbPath });
            const sourceProvider = new NaiaMemoryProvider({ adapter: sourceAdapter });
            const targetProvider = new NaiaMemoryProvider({ adapter: targetAdapter });
            let reopenedAdapter: SqliteAdapter | undefined;
            let restoreReadHook: (() => void) | undefined;
            try {
                const sourceFact = {
                    ...makeFact("cache source imported fact"),
                    id: "cache-source-fact",
                    entities: ["cache-source", "cache-anchor"],
                };
                const targetFact = {
                    ...makeFact("cache target retained fact"),
                    id: "cache-target-fact",
                    entities: ["cache-target", "cache-anchor"],
                };
                await sourceAdapter.semantic.upsert(sourceFact);
                await sourceAdapter.semantic.associate(
                    "cache-source",
                    "cache-source-related",
                    0.4,
                );
                const sourceBlob = await sourceProvider.exportBackup("cache-password");

                await targetAdapter.semantic.upsert(targetFact);
                await targetAdapter.semantic.associate(
                    "cache-target",
                    "cache-target-related",
                    0.4,
                );
                await targetAdapter.getKGState();
                await targetAdapter.semantic.associate(
                    "cache-target",
                    "cache-target-late",
                    0.4,
                );

                const generationBefore = (targetAdapter as unknown as {
                    kgCacheGeneration: number;
                }).kgCacheGeneration;
                const readHook = holdOneCompletedKgRead(targetAdapter);
                restoreReadHook = readHook.restore;
                const lateRead = targetAdapter.getKGState();
                await readHook.readStarted;

                const importPromise = targetProvider.importBackup(
                    sourceBlob,
                    password,
                );
                if (expectedImport === "success") {
                    await expect(importPromise).resolves.toBeUndefined();
                    expect((targetAdapter as unknown as {
                        kgCacheGeneration: number;
                    }).kgCacheGeneration).toBe(generationBefore + 1);
                } else {
                    await expect(importPromise).rejects.toThrow(
                        "Decryption failed: wrong password or corrupted blob",
                    );
                    expect((targetAdapter as unknown as {
                        kgCacheGeneration: number;
                    }).kgCacheGeneration).toBe(generationBefore);
                }

                let lateReadSettled = false;
                void lateRead.then(() => {
                    lateReadSettled = true;
                });
                await Promise.resolve();
                expect(lateReadSettled).toBe(false);
                readHook.release();
                const lateState = await lateRead;
                restoreReadHook();
                restoreReadHook = undefined;
                const freshState = await targetAdapter.getKGState();

                if (expectedImport === "success") {
                    expect(lateState.nodes["cache-target"]).toBeDefined();
                    expect(lateState.nodes["cache-source"]).toBeUndefined();
                    expect(freshState.nodes["cache-source"]).toBeDefined();
                    expect(freshState.nodes["cache-target"]).toBeUndefined();
                    expect(
                        freshState.edges["cache-source::cache-source-related"],
                    ).toBeDefined();
                    expect(
                        (await targetAdapter.semantic.search(
                            "cache source imported",
                            10,
                            true,
                        )).map((fact) => fact.id),
                    ).toContain(sourceFact.id);
                } else {
                    expect(lateState.nodes["cache-target"]).toBeDefined();
                    expect(lateState.nodes["cache-source"]).toBeUndefined();
                    expect(freshState).toEqual(lateState);
                    expect(
                        freshState.edges["cache-target::cache-target-late"],
                    ).toBeDefined();
                    expect(
                        (await targetAdapter.semantic.search(
                            "cache target retained",
                            10,
                            true,
                        )).map((fact) => fact.id),
                    ).toContain(targetFact.id);
                }

                await targetProvider.close();
                reopenedAdapter = new SqliteAdapter({ dbPath: targetFixture.dbPath });
                const reopenedState = await reopenedAdapter.getKGState();
                if (expectedImport === "success") {
                    expect(reopenedState.nodes["cache-source"]).toBeDefined();
                    expect(reopenedState.nodes["cache-target"]).toBeUndefined();
                } else {
                    expect(reopenedState.nodes["cache-target"]).toBeDefined();
                    expect(reopenedState.nodes["cache-source"]).toBeUndefined();
                }
            } finally {
                restoreReadHook?.();
                await reopenedAdapter?.close();
                await sourceProvider.close();
                await targetProvider.close();
                rmSync(sourceFixture.tempDir, { recursive: true, force: true });
                rmSync(targetFixture.tempDir, { recursive: true, force: true });
            }
        },
    );
});
