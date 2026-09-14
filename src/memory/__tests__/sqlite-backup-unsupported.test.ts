import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeLocalBackup } from "../adapters/local-backup.js";
import { isMemoryStore } from "../adapters/local-model.js";
import { SqliteAdapter } from "../adapters/sqlite.js";
import { NaiaMemoryProvider } from "../provider.js";
import { isCapable } from "../provider-types.js";
import type { EmbeddingProvider } from "../embeddings.js";
import type { Fact } from "../types.js";

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function controlledEmbeddingProvider(
    firstBatchStarted: { resolve: (value: void | PromiseLike<void>) => void },
    firstBatchGate: { promise: Promise<void> },
): EmbeddingProvider {
    let nonEmptyBatchCalls = 0;
    return {
        name: "sqlite-backup-controlled",
        dims: 2,
        embeddingSpaceId: "sqlite-backup-controlled-v1",
        async embed() {
            return [1, 0];
        },
        async embedBatch(texts: string[]) {
            if (texts.length > 0 && nonEmptyBatchCalls++ === 0) {
                firstBatchStarted.resolve();
                await firstBatchGate.promise;
            }
            return texts.map(() => [1, 0]);
        },
    };
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

function makeFixture() {
    const tempDir = mkdtempSync(join(tmpdir(), "naia-memory-sqlite-backup-"));
    return { tempDir, dbPath: join(tempDir, "memory.db") };
}

describe("SqliteAdapter backup export", () => {
    it("drains accepted writes into an authenticated Local-compatible snapshot", async () => {
        const fixture = makeFixture();
        const adapter = new SqliteAdapter({ dbPath: fixture.dbPath });
        const fact = makeFact("SQLite backup baseline");
        try {
            const write = adapter.semantic.upsert(fact);
            const blob = await adapter.export("password");
            await write;

            expect(blob).toBeInstanceOf(Uint8Array);
            expect(blob.byteLength).toBeGreaterThan(49);
            const decoded = await decodeLocalBackup(blob, "password");
            expect(isMemoryStore(decoded)).toBe(true);
            expect(decoded.facts).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ id: fact.id, content: fact.content }),
                ]),
            );
            expect(
                (decoded as unknown as {
                    sqliteBackup?: { version: number; target?: { schemaVersion: number } };
                })
                    .sqliteBackup,
            ).toEqual(expect.objectContaining({
                version: 1,
                target: expect.objectContaining({ schemaVersion: 3 }),
            }));
            await expect(decodeLocalBackup(blob, "wrong-password")).rejects.toThrow(
                "Decryption failed: wrong password or corrupted blob",
            );
        } finally {
            await adapter.close();
            rmSync(fixture.tempDir, { recursive: true, force: true });
        }
    });

    it("exports through the public provider surface", async () => {
        const fixture = makeFixture();
        const adapter = new SqliteAdapter({ dbPath: fixture.dbPath });
        const provider = new NaiaMemoryProvider({ adapter });
        const fact = makeFact("Provider backup baseline");
        try {
            await adapter.semantic.upsert(fact);
            expect(provider.supportsBackup()).toBe(true);
            expect(isCapable(provider, "BackupCapableProvider")).toBe(true);

            const blob = await provider.exportBackup("provider-password");
            const decoded = await decodeLocalBackup(blob, "provider-password");
            expect(decoded.facts).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ id: fact.id, content: fact.content }),
                ]),
            );
        } finally {
            await provider.close();
            rmSync(fixture.tempDir, { recursive: true, force: true });
        }
    });

    it("captures only prior writes, then drains future writes before close and reopen", async () => {
        const fixture = makeFixture();
        const firstBatchStarted = deferred<void>();
        const firstBatchGate = deferred<void>();
        const adapter = new SqliteAdapter({
            dbPath: fixture.dbPath,
            embeddingProvider: controlledEmbeddingProvider(firstBatchStarted, firstBatchGate),
        });
        const prior = makeFact("Delayed prior export fact");
        const future = makeFact("Future post export fact");
        try {
            const priorWrite = adapter.semantic.upsert(prior);
            await firstBatchStarted.promise;
            const exportPromise = adapter.export("delayed-password");
            const futureWrite = adapter.semantic.upsert(future);
            let closeSettled = false;
            const closePromise = adapter.close().then(() => {
                closeSettled = true;
            });
            await Promise.resolve();
            expect(closeSettled).toBe(false);
            await expect(adapter.export("after-closing")).rejects.toThrow(
                "SQLite adapter is closed",
            );
            firstBatchGate.resolve();

            const blob = await exportPromise;
            const decoded = await decodeLocalBackup(blob, "delayed-password");
            expect(decoded.facts).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ id: prior.id, content: prior.content }),
                ]),
            );
            expect(decoded.facts).not.toEqual(
                expect.arrayContaining([expect.objectContaining({ id: future.id })]),
            );

            await priorWrite;
            await futureWrite;
            await closePromise;

            const reopened = new SqliteAdapter({ dbPath: fixture.dbPath });
            try {
                await expect(reopened.semantic.search(prior.content, 10, true)).resolves.toEqual(
                    expect.arrayContaining([expect.objectContaining({ id: prior.id })]),
                );
                await expect(reopened.semantic.search(future.content, 10, true)).resolves.toEqual(
                    expect.arrayContaining([expect.objectContaining({ id: future.id })]),
                );
                await reopened.close();
                await expect(reopened.export("after-close")).rejects.toThrow(
                    "SQLite adapter is closed",
                );
            } finally {
                await reopened.close();
            }
        } finally {
            firstBatchGate.resolve();
            await adapter.close();
            rmSync(fixture.tempDir, { recursive: true, force: true });
        }
    });

    it("releases future writes and close after an export encoding failure", async () => {
        const fixture = makeFixture();
        const firstBatchStarted = deferred<void>();
        const firstBatchGate = deferred<void>();
        const adapter = new SqliteAdapter({
            dbPath: fixture.dbPath,
            embeddingProvider: controlledEmbeddingProvider(firstBatchStarted, firstBatchGate),
        });
        const prior = makeFact("Delayed prior failed export fact");
        const future = makeFact("Future after failed export fact");
        try {
            const priorWrite = adapter.semantic.upsert(prior);
            await firstBatchStarted.promise;
            const failedExport = adapter.export("");
            const futureWrite = adapter.semantic.upsert(future);
            let closeSettled = false;
            const closePromise = adapter.close().then(() => {
                closeSettled = true;
            });
            await Promise.resolve();
            expect(closeSettled).toBe(false);
            await expect(adapter.export("after-closing")).rejects.toThrow(
                "SQLite adapter is closed",
            );
            firstBatchGate.resolve();

            await expect(failedExport).rejects.toThrow("Password must not be empty");
            await priorWrite;
            await futureWrite;
            await closePromise;

            const reopened = new SqliteAdapter({ dbPath: fixture.dbPath });
            try {
                await expect(reopened.semantic.search(future.content, 10, true)).resolves.toEqual(
                    expect.arrayContaining([expect.objectContaining({ id: future.id })]),
                );
            } finally {
                await reopened.close();
            }
        } finally {
            firstBatchGate.resolve();
            await adapter.close();
            rmSync(fixture.tempDir, { recursive: true, force: true });
        }
    });
});
