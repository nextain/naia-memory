import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { calculateStrength } from "../decay.js";
import { SqliteAdapter } from "../adapters/sqlite.js";
import type { Episode, Fact, Reflection } from "../types.js";

const testTmpRoot = process.env.TMPDIR ?? join(process.cwd(), ".tmp", "naia-memory-stage5-20260906");

function makeTempDir(prefix: string): string {
    mkdirSync(testTmpRoot, { recursive: true });
    return mkdtempSync(join(testTmpRoot, prefix));
}

describe("SqliteAdapter persistent episode and procedural state", () => {
    it("round-trips every episode field and persists recall mutations across restart", async () => {
        const tempDir = makeTempDir("sqlite-state-episode-");
        const dbPath = join(tempDir, "memory.db");
        const timestamp = Date.now() - 3 * 24 * 60 * 60 * 1000;
        const lastAccessed = timestamp + 1_234;
        const episode: Episode = {
            id: "episode-state-round-trip",
            content: "SQLite episode content with a persistent summary marker",
            summary: "persistent summary marker",
            timestamp,
            role: "tool",
            importance: {
                importance: 0.91,
                surprise: 0.37,
                emotion: 0.82,
                utility: 0.73,
            },
            encodingContext: {
                project: "state-project",
                activeFile: "state.ts",
                taskDescription: "verify restart state",
                sessionId: "state-session",
                category: "engineering",
            },
            consolidated: false,
            recallCount: 4,
            lastAccessed,
            strength: 0.73,
            status: "active",
        };
        const archived: Episode = {
            ...episode,
            id: "episode-state-archived",
            content: "Archived episode state marker",
            summary: "archived summary marker",
            status: "archived",
            timestamp: timestamp + 1,
        };
        let adapter = new SqliteAdapter({ dbPath });
        try {
            await adapter.episode.store(episode);
            await adapter.episode.store(archived);

            await expect(adapter.episode.getRecent(10)).resolves.toEqual([
                expect.objectContaining({
                    id: episode.id,
                    content: episode.content,
                    summary: episode.summary,
                    timestamp: episode.timestamp,
                    role: episode.role,
                    importance: episode.importance,
                    encodingContext: episode.encodingContext,
                    consolidated: episode.consolidated,
                    recallCount: episode.recallCount,
                    lastAccessed: episode.lastAccessed,
                    strength: episode.strength,
                    status: episode.status,
                }),
            ]);
        } finally {
            await adapter.close();
        }

        adapter = new SqliteAdapter({ dbPath });
        try {
            const reopened = await adapter.episode.getUnconsolidated();
            expect(reopened).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    id: episode.id,
                    content: episode.content,
                    summary: episode.summary,
                    role: episode.role,
                    importance: episode.importance,
                    encodingContext: episode.encodingContext,
                    recallCount: episode.recallCount,
                    lastAccessed: episode.lastAccessed,
                    strength: episode.strength,
                    status: episode.status,
                }),
                expect.objectContaining({ id: archived.id, status: "archived" }),
            ]));

            const recallStarted = Date.now();
            const recalled = await adapter.episode.recall("persistent summary marker", {
                project: "state-project",
                activeFile: "state.ts",
                scopeMode: "strict",
                topK: 1,
                minStrength: 0,
            });
            expect(recalled).toHaveLength(1);
            expect(recalled[0]).toMatchObject({
                id: episode.id,
                summary: episode.summary,
                role: episode.role,
                importance: episode.importance,
                encodingContext: episode.encodingContext,
                consolidated: episode.consolidated,
                status: episode.status,
                recallCount: episode.recallCount + 1,
            });
            expect(recalled[0].lastAccessed).toBeGreaterThanOrEqual(recallStarted);
            expect(recalled[0].strength).toBeCloseTo(
                calculateStrength(
                    episode.importance.utility,
                    episode.timestamp,
                    episode.recallCount + 1,
                    recalled[0].lastAccessed,
                    recalled[0].lastAccessed,
                ),
                10,
            );
            await adapter.episode.markConsolidated([episode.id]);
            await expect(adapter.episode.getUnconsolidated()).resolves.toEqual([
                expect.objectContaining({ id: archived.id, consolidated: false }),
            ]);
        } finally {
            await adapter.close();
        }

        adapter = new SqliteAdapter({ dbPath });
        try {
            const afterRecallRestart = await adapter.episode.recall("persistent summary marker", {
                project: "state-project",
                scopeMode: "strict",
                topK: 1,
                minStrength: 0,
            });
            expect(afterRecallRestart[0]).toMatchObject({
                id: episode.id,
                recallCount: episode.recallCount + 2,
                summary: episode.summary,
                status: episode.status,
                consolidated: true,
            });
        } finally {
            await adapter.close();
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("keeps KG-expanded facts inside strict scope while history restores archived matches", async () => {
        const tempDir = makeTempDir("sqlite-state-kg-scope-");
        const dbPath = join(tempDir, "memory.db");
        const now = Date.now();
        const makeFact = (
            id: string,
            entities: string[],
            project: string,
            status: Fact["status"] = "active",
        ): Fact => ({
            id,
            content: `opaque KG scope fixture ${id}`,
            entities,
            topics: ["kg-scope"],
            createdAt: now,
            updatedAt: now,
            importance: 1,
            recallCount: 0,
            lastAccessed: now,
            strength: 1,
            status,
            sourceEpisodes: [],
            encodingContext: { project },
        });

        let adapter = new SqliteAdapter({ dbPath });
        try {
            await adapter.semantic.upsert(makeFact("kg-seed", ["seed", "bridge"], "scope-a"));
            await adapter.semantic.upsert(makeFact("kg-active-a", ["bridge", "active-a"], "scope-a"));
            await adapter.semantic.upsert(makeFact("kg-archived-a", ["bridge", "archived-a"], "scope-a", "archived"));
            await adapter.semantic.upsert(makeFact("kg-active-b", ["bridge", "active-b"], "scope-b"));

            const context = { project: "scope-a", scopeMode: "strict" as const };
            const surface = await adapter.semantic.search("seed", 20, false, context);
            expect(surface.map((fact) => fact.id)).toEqual(expect.arrayContaining([
                "kg-seed",
                "kg-active-a",
            ]));
            expect(surface.map((fact) => fact.id)).not.toContain("kg-active-b");
            expect(surface.map((fact) => fact.id)).not.toContain("kg-archived-a");

            const history = await adapter.semantic.search("seed", 20, false, {
                ...context,
                mode: "history",
            });
            expect(history.map((fact) => fact.id)).toEqual(expect.arrayContaining([
                "kg-seed",
                "kg-active-a",
                "kg-archived-a",
            ]));
            expect(history.map((fact) => fact.id)).not.toContain("kg-active-b");

            await adapter.close();
            adapter = new SqliteAdapter({ dbPath });
            const reopened = await adapter.semantic.search("seed", 20, false, {
                ...context,
                mode: "history",
            });
            expect(reopened.map((fact) => fact.id)).toEqual(expect.arrayContaining([
                "kg-active-a",
                "kg-archived-a",
            ]));
            expect(reopened.map((fact) => fact.id)).not.toContain("kg-active-b");
        } finally {
            await adapter.close();
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("atomically records concurrent outcomes and persists reflections across restart", async () => {
        const tempDir = makeTempDir("sqlite-state-procedural-");
        const dbPath = join(tempDir, "memory.db");
        const adapters = [
            new SqliteAdapter({ dbPath }),
            new SqliteAdapter({ dbPath }),
        ];
        const reflection: Reflection = {
            task: "deploy sqlite service",
            failure: "concurrent migration failed",
            analysis: "SQLite state write lacked an atomic outcome update",
            correction: "record counters in one worker transaction",
            timestamp: Date.now(),
        };
        try {
            await Promise.all(adapters.map((adapter) => adapter.procedural.getSkill("deploy")));
            const outcomes = Array.from({ length: 64 }, (_, index) => ({
                adapter: adapters[index % adapters.length],
                success: index % 4 !== 0,
            }));
            await Promise.all(
                outcomes.map(({ adapter, success }) =>
                    adapter.procedural.recordOutcome("deploy", success)),
            );

            const skill = await adapters[0].procedural.getSkill("deploy");
            expect(skill).toMatchObject({
                name: "deploy",
                successCount: 48,
                failureCount: 16,
                confidence: 0.75,
            });

            await adapters[0].procedural.learnFromFailure(reflection);
            await expect(adapters[1].procedural.getReflections("deploy sqlite", 5)).resolves.toEqual([
                reflection,
            ]);
        } finally {
            await Promise.all(adapters.map((adapter) => adapter.close()));
        }

        const reopened = new SqliteAdapter({ dbPath });
        try {
            await expect(reopened.procedural.getSkill("deploy")).resolves.toMatchObject({
                name: "deploy",
                successCount: 48,
                failureCount: 16,
                confidence: 0.75,
            });
            await expect(reopened.procedural.getReflections("deploy sqlite", 5)).resolves.toEqual([
                reflection,
            ]);
        } finally {
            await reopened.close();
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("backfills legacy procedural columns without losing state", async () => {
        const tempDir = makeTempDir("sqlite-state-procedural-legacy-");
        const dbPath = join(tempDir, "memory.db");
        const legacy = new Database(dbPath);
        legacy.exec(`
            CREATE TABLE memory_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            INSERT INTO memory_metadata (key, value) VALUES ('facts_generation', '0');
            CREATE TABLE skills (
                name TEXT PRIMARY KEY,
                description TEXT,
                usage_count INTEGER DEFAULT 0,
                success_count INTEGER DEFAULT 0,
                last_used INTEGER
            );
            CREATE TABLE reflections (
                id TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                importance REAL
            );
        `);
        legacy.prepare(
            "INSERT INTO skills (name, description, usage_count, success_count, last_used) VALUES (?, ?, ?, ?, ?)",
        ).run("legacy-deploy", "legacy deployment skill", 5, 3, 42);
        legacy.prepare(
            "INSERT INTO skills (name, description, usage_count, success_count, last_used) VALUES (?, ?, ?, ?, ?)",
        ).run("legacy-null", "legacy nullable skill", 5, 3, null);
        legacy.prepare(
            "INSERT INTO skills (name, description, usage_count, success_count, last_used) VALUES (?, ?, ?, ?, ?)",
        ).run("legacy-zero", "legacy zero skill", 4, 2, 0);
        legacy.prepare(
            "INSERT INTO reflections (id, content, timestamp, importance) VALUES (?, ?, ?, ?)",
        ).run("legacy-reflection", "legacy deploy reflection", 99, 0.4);
        legacy.close();

        let adapter = new SqliteAdapter({ dbPath });
        try {
            await expect(adapter.procedural.getSkill("legacy-deploy")).resolves.toEqual({
                id: "legacy-skill:legacy-deploy",
                name: "legacy-deploy",
                description: "legacy deployment skill",
                learnedAt: 42,
                successCount: 3,
                failureCount: 2,
                confidence: 0.6,
            });
            await expect(adapter.procedural.getReflections("legacy deploy", 1)).resolves.toEqual([{
                task: "",
                failure: "",
                analysis: "legacy deploy reflection",
                correction: "",
                timestamp: 99,
            }]);

            await expect(adapter.procedural.getSkill("legacy-null")).resolves.toEqual({
                id: "legacy-skill:legacy-null",
                name: "legacy-null",
                description: "legacy nullable skill",
                learnedAt: 0,
                successCount: 3,
                failureCount: 2,
                confidence: 0.6,
            });
            await expect(adapter.procedural.getSkill("legacy-zero")).resolves.toEqual({
                id: "legacy-skill:legacy-zero",
                name: "legacy-zero",
                description: "legacy zero skill",
                learnedAt: 0,
                successCount: 2,
                failureCount: 2,
                confidence: 0.5,
            });

            // An outcome updates last_used and counters while preserving the
            // migrated learned_at sentinel. The complete object is the
            // invariant that must survive the close/reopen boundary.
            await adapter.procedural.recordOutcome("legacy-null", true);
            await adapter.procedural.recordOutcome("legacy-zero", false);
            const expectedNull = {
                id: "legacy-skill:legacy-null",
                name: "legacy-null",
                description: "legacy nullable skill",
                learnedAt: 0,
                successCount: 4,
                failureCount: 2,
                confidence: 4 / 6,
            };
            const expectedZero = {
                id: "legacy-skill:legacy-zero",
                name: "legacy-zero",
                description: "legacy zero skill",
                learnedAt: 0,
                successCount: 2,
                failureCount: 3,
                confidence: 2 / 5,
            };
            await expect(adapter.procedural.getSkill("legacy-null")).resolves.toEqual(expectedNull);
            await expect(adapter.procedural.getSkill("legacy-zero")).resolves.toEqual(expectedZero);

            await adapter.close();
            adapter = new SqliteAdapter({ dbPath });
            await expect(adapter.procedural.getSkill("legacy-null")).resolves.toEqual(expectedNull);
            await expect(adapter.procedural.getSkill("legacy-zero")).resolves.toEqual(expectedZero);
        } finally {
            await adapter.close();
            rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
