import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteAdapter } from "../adapters/sqlite.js";
import type { Episode, Fact } from "../types.js";

function makeFact(id: string, entities: string[], overrides: Partial<Fact> = {}): Fact {
    const now = Date.now();
    return {
        id,
        content: `SQLite KG fact ${id}`,
        entities,
        topics: ["knowledge-graph"],
        createdAt: now,
        updatedAt: now,
        importance: 0.5,
        recallCount: 0,
        lastAccessed: now,
        strength: 1,
        status: "active",
        sourceEpisodes: [],
        ...overrides,
    };
}

function createLegacyDatabase(dbPath: string): void {
    const db = new Database(dbPath);
    db.exec(`
        CREATE TABLE memory_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO memory_metadata (key, value) VALUES ('facts_generation', '0');
        CREATE TABLE episodes (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            role TEXT NOT NULL,
            consolidated BOOLEAN DEFAULT 0,
            importance_importance REAL,
            importance_surprise REAL,
            importance_emotion REAL,
            importance_utility REAL,
            encoding_context TEXT
        );
        CREATE TABLE kg_nodes (name TEXT PRIMARY KEY, frequency INTEGER DEFAULT 1, last_seen INTEGER NOT NULL);
        CREATE TABLE kg_edges (
            source TEXT NOT NULL,
            target TEXT NOT NULL,
            weight REAL DEFAULT 0.05,
            last_strengthened INTEGER NOT NULL,
            PRIMARY KEY (source, target)
        );
    `);
    db.prepare(
        "INSERT INTO episodes (id, content, timestamp, role, consolidated, encoding_context) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("legacy-episode", "legacy content", 1234, "user", 0, "{}");
    db.prepare(
        "INSERT INTO kg_nodes (name, frequency, last_seen) VALUES (?, ?, ?)",
    ).run("legacy", 7, 1234);
    db.prepare(
        "INSERT INTO kg_edges (source, target, weight, last_strengthened) VALUES (?, ?, ?, ?)",
    ).run("legacy", "node", 0.42, 1234);
    db.close();
}

function createMigrationConflictDatabase(dbPath: string): void {
    createLegacyDatabase(dbPath);
    const db = new Database(dbPath);
    db.exec("CREATE VIEW semantic_associations AS SELECT 'conflict' AS association_key");
    db.close();
}

function snapshotSchemaAndLegacyRows(dbPath: string): {
    schema: unknown[];
    rows: Record<string, unknown[]>;
} {
    const db = new Database(dbPath, { readonly: true });
    const schema = db.prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name",
    ).all();
    const rows: Record<string, unknown[]> = {};
    for (const table of ["memory_metadata", "episodes", "kg_nodes", "kg_edges"]) {
        rows[table] = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
    }
    db.close();
    return { schema, rows };
}

describe("SQLite stage 5B schema and knowledge-graph checkpoint", () => {
    it("persists KG associations, hubs, and state across a reopen", async () => {
        const tempDir = mkdtempSync(join(tmpdir(), "naia-memory-sqlite-kg-"));
        const dbPath = join(tempDir, "kg.db");
        let adapter: SqliteAdapter | undefined;
        try {
            adapter = new SqliteAdapter({ dbPath });
            await adapter.semantic.upsert(makeFact("f1", ["Alpha", "Beta"]));
            await adapter.semantic.upsert(makeFact("f2", ["alpha", "Gamma"]));

            const beforeAssociation = await adapter.getKGState();
            expect(beforeAssociation.nodes).toMatchObject({
                alpha: expect.objectContaining({ frequency: 4 }),
                beta: expect.objectContaining({ frequency: 2 }),
                gamma: expect.objectContaining({ frequency: 2 }),
            });
            expect(beforeAssociation.edges["alpha::beta"]).toMatchObject({
                from: "alpha",
                to: "beta",
                coOccurrences: 1,
            });
            expect(beforeAssociation.edges["alpha::gamma"]).toMatchObject({
                from: "alpha",
                to: "gamma",
                coOccurrences: 1,
            });
            expect(await adapter.getHubs()).toEqual({
                alpha: { frequency: 4 },
                beta: { frequency: 2 },
                gamma: { frequency: 2 },
            });

            await adapter.semantic.associate("ALPHA", "Gamma");
            const afterAssociation = await adapter.getKGState();
            expect(afterAssociation.nodes.alpha.frequency).toBe(5);
            expect(afterAssociation.nodes.gamma.frequency).toBe(3);
            expect(afterAssociation.edges["alpha::gamma"]).toMatchObject({
                from: "alpha",
                to: "gamma",
                coOccurrences: 2,
            });
            expect(afterAssociation.edges["alpha::gamma"].weight).toBeCloseTo(
                0.05 + 0.1 / Math.sqrt(2),
                10,
            );

            await adapter.close();
            adapter = new SqliteAdapter({ dbPath });
            expect(await adapter.getKGState()).toEqual(afterAssociation);
            expect(await adapter.getHubs()).toEqual({
                alpha: { frequency: 5 },
                beta: { frequency: 2 },
                gamma: { frequency: 3 },
            });

            const db = new Database(dbPath, { readonly: true });
            const association = db.prepare(
                "SELECT entity_a, entity_b, weight FROM semantic_associations WHERE association_key = ?",
            ).get("alpha::gamma") as { entity_a: string; entity_b: string; weight: number } | undefined;
            expect(association).toMatchObject({ entity_a: "ALPHA", entity_b: "Gamma", weight: 0.1 });
            db.close();
        } finally {
            await adapter?.close();
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("migrates a legacy schema idempotently without inventing edge history", async () => {
        const tempDir = mkdtempSync(join(tmpdir(), "naia-memory-sqlite-legacy-"));
        const dbPath = join(tempDir, "legacy.db");
        let adapter: SqliteAdapter | undefined;
        try {
            createLegacyDatabase(dbPath);
            adapter = new SqliteAdapter({ dbPath });
            const firstState = await adapter.getKGState();
            expect(firstState.nodes.legacy).toMatchObject({ frequency: 7, lastSeen: 1234 });
            expect(firstState.edges["legacy::node"]).toMatchObject({
                from: "legacy",
                to: "node",
                weight: 0.42,
                coOccurrences: 0,
            });
            const episode = (await adapter.episode.getRecent(1))[0] as Episode;
            expect(episode).toMatchObject({
                id: "legacy-episode",
                content: "legacy content",
                summary: "legacy content",
                timestamp: 1234,
                recallCount: 0,
                lastAccessed: 1234,
                strength: 1,
            });
            await adapter.close();

            const db = new Database(dbPath, { readonly: true });
            const version = db.prepare(
                "SELECT value FROM memory_metadata WHERE key = 'schema_version'",
            ).get() as { value: string };
            const episodeColumns = db.prepare("PRAGMA table_info(episodes)").all() as Array<{ name: string }>;
            const edgeColumns = db.prepare("PRAGMA table_info(kg_edges)").all() as Array<{ name: string }>;
            expect(version.value).toBe("3");
            expect(episodeColumns.map(({ name }) => name)).toEqual(expect.arrayContaining([
                "summary", "recall_count", "last_accessed", "strength", "status",
            ]));
            expect(edgeColumns.map(({ name }) => name)).toContain("co_occurrences");
            db.close();

            // A schema-version 3 reopen must not rerun v1 backfills. Empty
            // summary/zero last_accessed are valid caller state and must stay
            // untouched once the migration has completed.
            const writable = new Database(dbPath);
            writable.prepare("UPDATE episodes SET summary = '', last_accessed = 0 WHERE id = ?").run("legacy-episode");
            writable.close();

            adapter = new SqliteAdapter({ dbPath });
            expect(await adapter.getKGState()).toEqual(firstState);
            expect((await adapter.episode.getRecent(1))[0]).toMatchObject({ summary: "", lastAccessed: 0 });
            await adapter.close();

            const reopened = new Database(dbPath, { readonly: true });
            const preserved = reopened.prepare(
                "SELECT summary, last_accessed FROM episodes WHERE id = ?",
            ).get("legacy-episode") as { summary: string; last_accessed: number };
            expect(preserved).toEqual({ summary: "", last_accessed: 0 });
            reopened.close();
        } finally {
            await adapter?.close();
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("upgrades a schema-version 2 procedural state and records revision 3", async () => {
        const tempDir = mkdtempSync(join(tmpdir(), "naia-memory-sqlite-v2-upgrade-"));
        const dbPath = join(tempDir, "v2-upgrade.db");
        let adapter: SqliteAdapter | undefined;
        try {
            // Seed the database through the current adapter, then emulate a
            // v2 database whose procedural row still has a legacy sentinel.
            adapter = new SqliteAdapter({ dbPath });
            await adapter.procedural.recordOutcome("v2-procedural", true);
            await adapter.close();
            adapter = undefined;

            const v2 = new Database(dbPath);
            expect(v2.prepare(
                "UPDATE memory_metadata SET value = '2' WHERE key = 'schema_version'",
            ).run().changes).toBe(1);
            v2.prepare(`
                UPDATE skills
                SET id = ?, description = ?, learned_at = 0,
                    usage_count = 5, success_count = 3, failure_count = 2,
                    confidence = 0.6, last_used = 4242
                WHERE name = ?
            `).run("v2-procedural-id", "v2 procedural skill", "v2-procedural");
            v2.close();

            adapter = new SqliteAdapter({ dbPath });
            await expect(adapter.procedural.getSkill("v2-procedural")).resolves.toEqual({
                id: "v2-procedural-id",
                name: "v2-procedural",
                description: "v2 procedural skill",
                learnedAt: 4242,
                successCount: 3,
                failureCount: 2,
                confidence: 0.6,
            });
            await adapter.close();
            adapter = undefined;

            const upgraded = new Database(dbPath, { readonly: true });
            expect(upgraded.prepare(
                "SELECT value FROM memory_metadata WHERE key = 'schema_version'",
            ).get()).toEqual({ value: "3" });
            upgraded.close();
        } finally {
            await adapter?.close();
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("rolls back a migration when v2 table creation conflicts", async () => {
        const tempDir = mkdtempSync(join(tmpdir(), "naia-memory-sqlite-migration-rollback-"));
        const dbPath = join(tempDir, "migration-rollback.db");
        let adapter: SqliteAdapter | undefined;
        try {
            createMigrationConflictDatabase(dbPath);
            const before = snapshotSchemaAndLegacyRows(dbPath);
            adapter = new SqliteAdapter({ dbPath });
            await expect(adapter.episode.getRecent(1)).rejects.toThrow(/semantic_associations|already exists/i);
            await adapter.close();
            adapter = undefined;

            // The conflict is raised after the base-schema statements would
            // otherwise create tables/indexes. The whole bootstrap must roll
            // back, including every original row and metadata value.
            expect(snapshotSchemaAndLegacyRows(dbPath)).toEqual(before);

            const repair = new Database(dbPath);
            repair.exec("DROP VIEW semantic_associations");
            repair.close();

            adapter = new SqliteAdapter({ dbPath });
            await expect(adapter.episode.getRecent(1)).resolves.toHaveLength(1);
            await adapter.close();
            adapter = undefined;
            const db = new Database(dbPath, { readonly: true });
            expect(db.prepare(
                "SELECT value FROM memory_metadata WHERE key = 'schema_version'",
            ).get()).toEqual({ value: "3" });
            expect(db.prepare("SELECT type FROM sqlite_master WHERE name = 'semantic_associations'").get()).toEqual({ type: "table" });
            db.close();
        } finally {
            await adapter?.close();
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("rejects a higher schema version before changing any schema or rows", async () => {
        const tempDir = mkdtempSync(join(tmpdir(), "naia-memory-sqlite-schema-version-"));
        const dbPath = join(tempDir, "future.db");
        let adapter: SqliteAdapter | undefined;
        try {
            createLegacyDatabase(dbPath);
            const writable = new Database(dbPath);
            writable.prepare(
                "INSERT INTO memory_metadata (key, value) VALUES ('schema_version', ?)",
            ).run("99");
            writable.close();
            const before = snapshotSchemaAndLegacyRows(dbPath);

            adapter = new SqliteAdapter({ dbPath });
            await expect(adapter.episode.getRecent(1)).rejects.toThrow(
                "Unsupported SQLite schema version: 99",
            );
            await adapter.close();
            adapter = undefined;

            expect(snapshotSchemaAndLegacyRows(dbPath)).toEqual(before);
        } finally {
            await adapter?.close();
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("preserves entity history across repeated updates of one fact id", async () => {
        const tempDir = mkdtempSync(join(tmpdir(), "naia-memory-sqlite-kg-history-"));
        const dbPath = join(tempDir, "history.db");
        let adapter: SqliteAdapter | undefined;
        try {
            adapter = new SqliteAdapter({ dbPath });
            await adapter.semantic.upsert(makeFact("same-id", ["Alpha", "Beta"]));
            await adapter.semantic.upsert(makeFact("same-id", ["Gamma"]));
            await adapter.semantic.upsert(makeFact("same-id", ["Delta"]));
            expect((await adapter.semantic.getAll())[0].entities).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
            await adapter.close();
            adapter = new SqliteAdapter({ dbPath });
            expect((await adapter.semantic.getAll())[0].entities).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
        } finally {
            await adapter?.close();
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("matches Local duplicate entity touches and clamps first associations", async () => {
        const tempDir = mkdtempSync(join(tmpdir(), "naia-memory-sqlite-kg-duplicates-"));
        const dbPath = join(tempDir, "duplicates.db");
        let adapter: SqliteAdapter | undefined;
        try {
            adapter = new SqliteAdapter({ dbPath });
            await adapter.semantic.upsert(makeFact("duplicates", ["Alpha", "Alpha", "Beta"]));
            const state = await adapter.getKGState();
            expect(state.nodes.alpha).toMatchObject({ frequency: 4 });
            expect(state.nodes.beta).toMatchObject({ frequency: 3 });
            expect(state.edges["alpha::beta"]).toMatchObject({ coOccurrences: 2 });
            expect((await adapter.semantic.getAll())[0].entities).toEqual(["Alpha", "Alpha", "Beta"]);

            await adapter.semantic.associate("A", "B", 2);
            const db = new Database(dbPath, { readonly: true });
            expect(db.prepare(
                "SELECT weight FROM semantic_associations WHERE association_key = ?",
            ).get("a::b")).toEqual({ weight: 1 });
            db.close();
        } finally {
            await adapter?.close();
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("rolls back KG changes together with a failed fact upsert batch", async () => {
        const tempDir = mkdtempSync(join(tmpdir(), "naia-memory-sqlite-kg-atomic-"));
        const dbPath = join(tempDir, "atomic.db");
        let adapter: SqliteAdapter | undefined;
        try {
            adapter = new SqliteAdapter({ dbPath });
            const validWrite = adapter.semantic.upsert(makeFact("valid", ["stable", "entity"]));
            const invalidWrite = adapter.semantic.upsert(makeFact("invalid", ["ahead", "cache"], {
                content: null as unknown as string,
            }));
            await expect(Promise.all([validWrite, invalidWrite])).rejects.toThrow();
            expect(await adapter.getKGState()).toEqual({ nodes: {}, edges: {} });
            expect(await adapter.semantic.getAll()).toEqual([]);
            await adapter.close();
            adapter = new SqliteAdapter({ dbPath });
            expect(await adapter.getKGState()).toEqual({ nodes: {}, edges: {} });
            expect(await adapter.semantic.getAll()).toEqual([]);
        } finally {
            await adapter?.close();
            rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
