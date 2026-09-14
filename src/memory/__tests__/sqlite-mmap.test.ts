import { createRequire } from "node:module";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteAdapter } from "../adapters/sqlite.js";
import type { Fact } from "../types.js";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as typeof import("better-sqlite3");

type WorkerCall = (
	command: string,
	payload: { sql: string; params: unknown[] },
) => Promise<unknown>;

async function workerPragma(adapter: SqliteAdapter, sql: string): Promise<unknown> {
	// The mmap setting belongs to the worker connection. A second SQLite
	// connection would report its own independent PRAGMA value.
	await adapter.semantic.getAll();
	const rawCallWorker = (adapter as unknown as {
		rawCallWorker: WorkerCall;
	}).rawCallWorker;
	return rawCallWorker.call(adapter, "prepare-get", { sql, params: [] });
}

async function workerMmapSize(adapter: SqliteAdapter): Promise<number> {
	const row = await workerPragma(adapter, "PRAGMA mmap_size") as { mmap_size?: number } | undefined;
	return Number(row?.mmap_size ?? 0);
}

function makeFact(id: string, content: string, status: Fact["status"] = "active"): Fact {
	const now = Date.now();
	return {
		id,
		content,
		entities: ["sqlite"],
		topics: ["mmap"],
		createdAt: now,
		updatedAt: now,
		importance: 0.8,
		recallCount: 0,
		lastAccessed: now,
		strength: 0.8,
		status,
		sourceEpisodes: [],
	};
}

describe("SqliteAdapter mmap_size option", () => {
	const tempDirs: string[] = [];
	const adapters: SqliteAdapter[] = [];

	function makeDb(prefix = "naia-memory-sqlite-mmap-") {
		const tempDir = mkdtempSync(join(tmpdir(), prefix));
		tempDirs.push(tempDir);
		return { tempDir, dbPath: join(tempDir, "memory.db") };
	}

	function track(adapter: SqliteAdapter): SqliteAdapter {
		adapters.push(adapter);
		return adapter;
	}

	afterEach(async () => {
		for (const adapter of adapters.splice(0).reverse()) await adapter.close();
		for (const tempDir of tempDirs.splice(0)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it.each([
		["NaN", Number.NaN],
		["positive infinity", Number.POSITIVE_INFINITY],
		["negative infinity", Number.NEGATIVE_INFINITY],
		["negative", -1],
		["fractional", 4096.5],
		["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
		["string", "4096"],
		["null", null],
	] as const)("rejects invalid mmapSizeBytes (%s) before mkdir or worker startup", (_label, value) => {
		const { tempDir } = makeDb();
		const invalidParent = join(tempDir, "invalid-mmap-option");
		const invalidPath = join(invalidParent, "memory.db");

		expect(() => new SqliteAdapter({
			dbPath: invalidPath,
			mmapSizeBytes: value as unknown as number,
		})).toThrow("SQLite mmapSizeBytes must be a finite, non-negative safe integer");
		expect(existsSync(invalidParent)).toBe(false);
	});

	it("keeps the worker mapping disabled when mmapSizeBytes is omitted or zero", async () => {
		const { dbPath } = makeDb();
		const omitted = track(new SqliteAdapter({ dbPath }));
		expect(await workerMmapSize(omitted)).toBe(0);

		await omitted.close();
		const explicitZero = track(new SqliteAdapter({ dbPath, mmapSizeBytes: 0 }));
		expect(await workerMmapSize(explicitZero)).toBe(0);
	});

	it("applies a valid opt-in mapping and preserves store/search data after reopen", async () => {
		const { dbPath } = makeDb();
		const requestedMmapSize = 64 * 1024;
		const adapter = track(new SqliteAdapter({ dbPath, mmapSizeBytes: requestedMmapSize }));
		const fact = makeFact("mmap-persisted", "mmap persistence marker");

		await adapter.semantic.upsert(fact);
		expect((await adapter.semantic.search("mmap persistence marker", 5)).map(({ id }) => id)).toContain(fact.id);
		const effective = await workerMmapSize(adapter);
		expect(Number.isSafeInteger(effective)).toBe(true);
		expect(effective).toBeGreaterThanOrEqual(0);
		expect(effective).toBeLessThanOrEqual(requestedMmapSize);

		await adapter.close();
		const reopened = track(new SqliteAdapter({ dbPath, mmapSizeBytes: requestedMmapSize }));
		expect((await reopened.semantic.getAll()).find(({ id }) => id === fact.id)).toMatchObject({
			id: fact.id,
			content: fact.content,
			status: "active",
		});
		expect((await reopened.semantic.search("mmap persistence marker", 5)).map(({ id }) => id)).toContain(fact.id);
	});

	it("reads a database larger than a small mapping cap", async () => {
		const { dbPath } = makeDb();
		const requestedMmapSize = 4096;
		const adapter = track(new SqliteAdapter({ dbPath, mmapSizeBytes: requestedMmapSize }));
		const facts = Array.from({ length: 12 }, (_, index) => makeFact(
			`large-db-${index}`,
			`small mmap cap large database marker ${index} ${"payload ".repeat(300)}`,
		));

		for (const fact of facts) await adapter.semantic.upsert(fact);
		const persisted = await adapter.semantic.getAll();
		expect(persisted.map(({ id }) => id)).toEqual(expect.arrayContaining(facts.map(({ id }) => id)));
		expect((await adapter.semantic.search("small mmap cap large database marker", 3)).length).toBeGreaterThan(0);

		const effective = await workerMmapSize(adapter);
		expect(effective).toBeGreaterThanOrEqual(0);
		expect(effective).toBeLessThanOrEqual(requestedMmapSize);

		await adapter.close();
		const checkpointDb = new Database(dbPath);
		try {
			expect(checkpointDb.pragma("journal_mode", { simple: true })).toBe("wal");
			const checkpoint = checkpointDb.pragma("wal_checkpoint(PASSIVE)") as Array<{ busy?: number }>;
			expect(Number(checkpoint[0]?.busy ?? 0)).toBe(0);
		} finally {
			checkpointDb.close();
		}
		expect(statSync(dbPath).size).toBeGreaterThan(requestedMmapSize);

		const reopened = track(new SqliteAdapter({ dbPath, mmapSizeBytes: requestedMmapSize }));
		const reopenedFacts = await reopened.semantic.getAll();
		expect(reopenedFacts.map(({ id }) => id)).toEqual(expect.arrayContaining(facts.map(({ id }) => id)));
		expect((await reopened.semantic.search("small mmap cap large database marker", 3)).length).toBeGreaterThan(0);
	});

	it("keeps :memory: usable when mmap is requested", async () => {
		const adapter = track(new SqliteAdapter({ dbPath: ":memory:", mmapSizeBytes: 4096 }));
		const fact = makeFact("memory-mmap", "in memory mmap marker");

		await adapter.semantic.upsert(fact);
		expect((await adapter.semantic.getAll()).map(({ id }) => id)).toEqual([fact.id]);
		expect((await adapter.semantic.search("in memory mmap marker", 5)).map(({ id }) => id)).toContain(fact.id);
		const effective = await workerMmapSize(adapter);
		expect(effective).toBeGreaterThanOrEqual(0);
		expect(effective).toBeLessThanOrEqual(4096);
	});

	it("keeps uncommitted WAL writes invisible, then survives update, archive, checkpoint, and reopen", async () => {
		const { dbPath } = makeDb();
		const requestedMmapSize = 1 * 1024 * 1024;
		const adapter = track(new SqliteAdapter({ dbPath, mmapSizeBytes: requestedMmapSize }));
		const fact = makeFact("wal-lifecycle", "wal lifecycle baseline");
		await adapter.semantic.upsert(fact);
		const effective = await workerMmapSize(adapter);
		expect(effective).toBeGreaterThanOrEqual(0);
		expect(effective).toBeLessThanOrEqual(requestedMmapSize);

		const writer = new Database(dbPath);
		try {
			expect(writer.pragma("journal_mode", { simple: true })).toBe("wal");

			writer.exec("CREATE TABLE IF NOT EXISTS mmap_visibility (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
			writer.exec("BEGIN IMMEDIATE");
			writer.prepare("INSERT INTO mmap_visibility (id, value) VALUES (?, ?)").run(1, "before");
			writer.exec("COMMIT");
			const baselineCheckpoint = writer.pragma("wal_checkpoint(PASSIVE)") as Array<{ busy?: number }>;
			expect(Number(baselineCheckpoint[0]?.busy ?? 0)).toBe(0);
			expect(await workerPragma(adapter, "SELECT value FROM mmap_visibility WHERE id = 1")).toEqual({ value: "before" });

			writer.exec("BEGIN IMMEDIATE");
			writer.prepare("UPDATE mmap_visibility SET value = ? WHERE id = 1").run("after");
			expect(await workerPragma(adapter, "SELECT value FROM mmap_visibility WHERE id = 1")).toEqual({ value: "before" });
			writer.exec("COMMIT");
			expect(await workerPragma(adapter, "SELECT value FROM mmap_visibility WHERE id = 1")).toEqual({ value: "after" });
		} finally {
			writer.close();
		}

		const updated = { ...fact, content: "wal lifecycle updated", updatedAt: fact.updatedAt + 1 };
		await adapter.semantic.upsert(updated);
		expect((await adapter.semantic.getAll()).find(({ id }) => id === fact.id)).toMatchObject({
			content: updated.content,
			status: "active",
		});
		expect(await adapter.semantic.delete(fact.id)).toBe(true);
		expect((await adapter.semantic.getAll()).find(({ id }) => id === fact.id)?.status).toBe("archived");

		await adapter.close();
		const checkpointDb = new Database(dbPath);
		try {
			const checkpoint = checkpointDb.pragma("wal_checkpoint(PASSIVE)") as Array<{ busy?: number }>;
			expect(Number(checkpoint[0]?.busy ?? 0)).toBe(0);
		} finally {
			checkpointDb.close();
		}

		const reopened = track(new SqliteAdapter({ dbPath, mmapSizeBytes: requestedMmapSize }));
		expect((await reopened.semantic.getAll()).find(({ id }) => id === fact.id)).toMatchObject({
			content: updated.content,
			status: "archived",
		});
	});
});
