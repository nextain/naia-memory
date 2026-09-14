import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemorySystem } from "../index.js";
import { SqliteAdapter } from "../adapters/sqlite.js";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { EmbeddingProvider } from "../embeddings.js";

async function readWorkerMmapSize(adapter: SqliteAdapter): Promise<number> {
	// mmap_size is per connection. Probe the adapter's worker connection rather
	// than opening a second connection whose PRAGMA would be unrelated.
	await adapter.semantic.getAll();
	const workerCall = (adapter as unknown as {
		rawCallWorker(type: string, payload: { sql: string; params: unknown[] }): Promise<unknown>;
	}).rawCallWorker;
	const row = await workerCall.call(adapter, "prepare-get", {
		sql: "PRAGMA mmap_size",
		params: [],
	}) as { mmap_size?: number } | undefined;
	return Number(row?.mmap_size ?? 0);
}

describe("SqliteAdapter Smoke Test", () => {
    let memory: MemorySystem;
    let adapter: SqliteAdapter;
    let tempDir: string;
    let dbPath: string;

    beforeEach(async () => {
        tempDir = mkdtempSync(join(tmpdir(), "naia-memory-sqlite-smoke-"));
        dbPath = join(tempDir, `test-smoke-${randomUUID()}.db`);
        adapter = new SqliteAdapter({ dbPath });
        memory = new MemorySystem({ adapter });
        await memory.init();
    });

    afterEach(async () => {
        await memory.close();
        rmSync(tempDir, { recursive: true, force: true });
    });

    it("should store and recall a fact from SQLite", async () => {
        const fact = {
            id: randomUUID(),
            content: "SQLite is better than JSON for scaling.",
            entities: ["SQLite", "JSON"],
            topics: ["database"],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            importance: 0.8,
            recallCount: 0,
            lastAccessed: Date.now(),
            strength: 0.8,
            status: "active" as const,
            sourceEpisodes: []
        };

        await adapter.semantic.upsert(fact);

        const result = await memory.recall("database scaling", { topK: 5 });
        expect(result.facts.length).toBeGreaterThan(0);
        expect(result.facts[0].content).toContain("SQLite");
    });

	it.each([
		["NaN", Number.NaN],
		["positive infinity", Number.POSITIVE_INFINITY],
		["negative infinity", Number.NEGATIVE_INFINITY],
		["negative", -1],
		["fractional", 1.5],
		["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
		["string", "268435456"],
		["null", null],
	] as const)("rejects invalid mmapSizeBytes (%s) before filesystem side effects", (_label, value) => {
		const invalidParent = join(tempDir, "invalid-mmap-option");
		const invalidPath = join(invalidParent, "memory.db");
		expect(() => new SqliteAdapter({
			dbPath: invalidPath,
			mmapSizeBytes: value as unknown as number,
		})).toThrow(/mmapSizeBytes must be a finite, non-negative safe integer/);
		expect(existsSync(invalidParent)).toBe(false);
	});

	it("keeps the worker mmap setting disabled by default and at zero", async () => {
		expect(await readWorkerMmapSize(adapter)).toBe(0);

		await memory.close();
		adapter = new SqliteAdapter({ dbPath, mmapSizeBytes: 0 });
		memory = new MemorySystem({ adapter });
		expect(await readWorkerMmapSize(adapter)).toBe(0);
	});

	it("applies an opt-in mmap setting to the worker and preserves data after reopen", async () => {
		const requestedMmapSize = 256 * 1024 * 1024;
		await memory.close();
		adapter = new SqliteAdapter({ dbPath, mmapSizeBytes: requestedMmapSize });
		memory = new MemorySystem({ adapter });
		const now = Date.now();
		await adapter.semantic.upsert({
			id: "mmap-persisted-fact",
			content: "mmap setting must preserve SQLite data",
			entities: [],
			topics: [],
			createdAt: now,
			updatedAt: now,
			importance: 1,
			recallCount: 0,
			lastAccessed: now,
			strength: 1,
			status: "active",
			sourceEpisodes: [],
		});

		const effectiveBeforeClose = await readWorkerMmapSize(adapter);
		expect(Number.isSafeInteger(effectiveBeforeClose)).toBe(true);
		expect(effectiveBeforeClose).toBeGreaterThanOrEqual(0);
		expect(effectiveBeforeClose).toBeLessThanOrEqual(requestedMmapSize);

		await memory.close();
		adapter = new SqliteAdapter({ dbPath, mmapSizeBytes: requestedMmapSize });
		memory = new MemorySystem({ adapter });
		expect((await adapter.semantic.getAll()).map((fact) => fact.id)).toEqual([
			"mmap-persisted-fact",
		]);
		const effectiveAfterReopen = await readWorkerMmapSize(adapter);
		expect(Number.isSafeInteger(effectiveAfterReopen)).toBe(true);
		expect(effectiveAfterReopen).toBeGreaterThanOrEqual(0);
		expect(effectiveAfterReopen).toBeLessThanOrEqual(requestedMmapSize);
	});

    it("persists every concurrently submitted fact before each upsert resolves", async () => {
        const now = Date.now();
        const facts = Array.from({ length: 128 }, (_, index) => ({
            id: `concurrent-${index}`,
            content: `Concurrent SQLite fact ${index}`,
            entities: ["concurrent"],
            topics: ["batch"],
            createdAt: now + index,
            updatedAt: now + index,
            importance: 0.5,
            recallCount: 0,
            lastAccessed: now + index,
            strength: 0.8,
            status: "active" as const,
            sourceEpisodes: [],
        }));

        await Promise.all(facts.map((fact) => adapter.semantic.upsert(fact)));

        const persisted = await adapter.semantic.getAll();
        expect(persisted).toHaveLength(facts.length);
        expect(new Set(persisted.map((fact) => fact.id))).toEqual(
            new Set(facts.map((fact) => fact.id)),
        );
    });

    it("rolls back every fact in a failed concurrent batch", async () => {
        const now = Date.now();
        const valid = {
            id: "atomic-valid",
            content: "This row must roll back with its batch.",
            entities: ["atomic"],
            topics: ["batch"],
            createdAt: now,
            updatedAt: now,
            importance: 0.5,
            recallCount: 0,
            lastAccessed: now,
            strength: 0.8,
            status: "active" as const,
            sourceEpisodes: [],
        };
        const invalid = { ...valid, id: "atomic-invalid", content: null };

        const results = await Promise.allSettled([
            adapter.semantic.upsert(valid),
            adapter.semantic.upsert(invalid as unknown as typeof valid),
        ]);

        expect(results.map(({ status }) => status)).toEqual(["rejected", "rejected"]);
        expect(await adapter.semantic.getAll()).toEqual([]);
    });

    it("should recall a dated fact within a configured time range", async () => {
        const now = Date.now();
        await adapter.upsertEpoch({
            id: "epoch-1",
            name: "Test Era",
            start: now - 10000,
            end: now + 10000
        });

        const fact = {
            id: randomUUID(),
            content: "This was true during Test Era.",
            entities: [],
            topics: ["test"],
            createdAt: now,
            updatedAt: now,
            importance: 0.5,
            recallCount: 0,
            lastAccessed: now,
            strength: 0.5,
            status: "active" as const,
            sourceEpisodes: [],
            validFrom: now - 5000,
            validTo: now + 5000
        };
        await adapter.semantic.upsert(fact);

        const result = await memory.recall("test", { 
            mode: "at-time",
            epochAnchor: "Test Era" 
        } as any);

        expect(result.facts.length).toBeGreaterThan(0);
        expect(result.facts[0].content).toContain("Test Era");
    });

    it("persists epoch upserts by id and name across a worker restart", async () => {
        await adapter.upsertEpoch({
            id: "epoch-persistent",
            name: "Persistent Era",
            description: "initial",
            start: 100,
            end: 200,
        });
        await adapter.upsertEpoch({
            id: "epoch-persistent",
            name: "Persistent Era",
            description: "updated by id",
            start: 110,
            end: 210,
        });
        expect(await adapter.getEpochs()).toEqual([expect.objectContaining({
            id: "epoch-persistent",
            description: "updated by id",
            start: 110,
            end: 210,
        })]);

        await adapter.upsertEpoch({
            id: "epoch-renamed-record",
            name: "Persistent Era",
            description: "updated by name",
            start: 120,
            end: null,
        });
        expect(await adapter.getEpochs()).toEqual([expect.objectContaining({
            id: "epoch-renamed-record",
            name: "Persistent Era",
            description: "updated by name",
            start: 120,
            end: null,
        })]);

        await memory.close();
        adapter = new SqliteAdapter({ dbPath });
        memory = new MemorySystem({ adapter });
        await memory.init();
        await expect(adapter.getEpochs()).resolves.toEqual([expect.objectContaining({
            id: "epoch-renamed-record",
            name: "Persistent Era",
            start: 120,
            end: null,
        })]);
    });

    it("resolves inclusive temporal bounds and picks the newest overlapping version", async () => {
        await adapter.upsertEpoch({
            id: "epoch-boundary",
            name: "Boundary Era",
            start: 1000,
            end: 2000,
        });
        const makeFact = (id: string, createdAt: number, validFrom: number, validTo: number, content: string) => ({
            id,
            content,
            entities: [],
            topics: [],
            createdAt,
            updatedAt: createdAt,
            importance: 1,
            recallCount: 0,
            lastAccessed: createdAt,
            strength: 1,
            status: "active" as const,
            sourceEpisodes: [],
            validFrom,
            validTo,
        });
        await adapter.semantic.upsert(makeFact("versioned-v1", 10, 1000, 1500, "old version"));
        await adapter.semantic.upsert(makeFact("versioned-v2", 20, 1500, 2500, "new version"));
        await adapter.semantic.upsert(makeFact("at-end", 30, 2000, 2100, "inclusive end"));
        await adapter.semantic.upsert(makeFact("after-end", 40, 2001, 2100, "outside end"));

        const epochFacts = await adapter.semantic.search("", 20, false, {
            mode: "at-time",
            epochAnchor: "Boundary Era",
        });
        expect(epochFacts.map((fact) => fact.id).sort()).toEqual(["at-end", "versioned-v2"]);

        // atTimestamp takes precedence over a simultaneously supplied anchor.
        const pointFacts = await adapter.semantic.search("", 20, false, {
            mode: "at-time",
            atTimestamp: 1100,
            epochAnchor: "Boundary Era",
        });
        expect(pointFacts.map((fact) => fact.id)).toEqual(["versioned-v1"]);

        await memory.close();
        adapter = new SqliteAdapter({ dbPath });
        memory = new MemorySystem({ adapter });
        await memory.init();
        await expect(adapter.semantic.search("", 20, false, {
            mode: "at-time",
            epochAnchor: "Boundary Era",
        })).resolves.toEqual(expect.arrayContaining([
            expect.objectContaining({ id: "versioned-v2" }),
            expect.objectContaining({ id: "at-end" }),
        ]));
    });

    it("uses one current endpoint for open epochs and rechecks modern integer bounds after reopen", async () => {
        const observed = Date.now();
        const makeFact = (
            id: string,
            validFrom: number,
            validTo: number | null,
            project: string,
        ) => ({
            id,
            content: `modern temporal fact ${id}`,
            entities: [],
            topics: [],
            createdAt: validFrom,
            updatedAt: validFrom,
            importance: 1,
            recallCount: 0,
            lastAccessed: validFrom,
            strength: 1,
            status: "active" as const,
            sourceEpisodes: [],
            validFrom,
            validTo,
            encodingContext: { project },
        });

        await adapter.upsertEpoch({
            id: "epoch-open-modern",
            name: "Modern Open Era",
            start: observed - 1000,
            end: null,
        });
        await adapter.semantic.upsert(makeFact(
            "modern-ongoing",
            observed - 100,
            null,
            "allowed",
        ));
        await adapter.semantic.upsert(makeFact(
            "modern-future",
            observed + 60_000,
            null,
            "allowed",
        ));
        await adapter.semantic.upsert(makeFact(
            "modern-before-open",
            observed - 2000,
            observed - 1001,
            "allowed",
        ));
        await adapter.semantic.upsert(makeFact(
            "modern-foreign-ongoing",
            observed - 100,
            null,
            "foreign",
        ));

        const openContext = {
            mode: "at-time" as const,
            epochAnchor: "Modern Open Era",
            project: "allowed",
            scopeMode: "strict" as const,
        };
        const openIds = (await adapter.semantic.search("", 20, false, openContext))
            .map((fact) => fact.id);
        expect(openIds).toContain("modern-ongoing");
        expect(openIds).not.toContain("modern-future");
        expect(openIds).not.toContain("modern-before-open");
        expect(openIds).not.toContain("modern-foreign-ongoing");

        const closedStart = observed - 10_000;
        const closedEnd = observed - 9_000;
        await adapter.upsertEpoch({
            id: "epoch-closed-modern",
            name: "Modern Closed Era",
            start: closedStart,
            end: closedEnd,
        });
        await adapter.semantic.upsert(makeFact(
            "modern-left-inclusive",
            closedStart,
            closedStart,
            "allowed",
        ));
        await adapter.semantic.upsert(makeFact(
            "modern-right-inclusive",
            closedEnd,
            closedEnd,
            "allowed",
        ));
        await adapter.semantic.upsert(makeFact(
            "modern-before-closed",
            closedStart - 1,
            closedStart - 1,
            "allowed",
        ));
        await adapter.semantic.upsert(makeFact(
            "modern-after-closed",
            closedEnd + 1,
            closedEnd + 1,
            "allowed",
        ));
        await adapter.semantic.upsert(makeFact(
            "modern-foreign-left",
            closedStart,
            closedStart,
            "foreign",
        ));

        const closedContext = {
            mode: "at-time" as const,
            epochAnchor: "Modern Closed Era",
            project: "allowed",
            scopeMode: "strict" as const,
        };
        const expectedClosedIds = [
            "modern-left-inclusive",
            "modern-right-inclusive",
        ];
        await expect(adapter.semantic.search("", 20, false, closedContext))
            .resolves.toEqual(expect.arrayContaining(
                expectedClosedIds.map((id) => expect.objectContaining({ id })),
            ));
        const closedIdsBeforeReopen = (await adapter.semantic.search("", 20, false, closedContext))
            .map((fact) => fact.id)
            .sort();
        expect(closedIdsBeforeReopen).toEqual(expectedClosedIds.sort());

        await memory.close();
        adapter = new SqliteAdapter({ dbPath });
        memory = new MemorySystem({ adapter });
        await memory.init();
        const closedIdsAfterReopen = (await adapter.semantic.search("", 20, false, closedContext))
            .map((fact) => fact.id)
            .sort();
        expect(closedIdsAfterReopen).toEqual(expectedClosedIds.sort());
    });

    it("recalls high and low valence flashbulbs without FTS while preserving scope and lifecycle", async () => {
        const now = Date.now();
        const makeFact = (id: string, maxEmotion: number, project: string, status: "active" | "archived" = "active") => ({
            id,
            content: `opaque flashbulb ${id}`,
            entities: [],
            topics: [],
            createdAt: now,
            updatedAt: now,
            importance: 1,
            maxEmotion,
            recallCount: 0,
            lastAccessed: now,
            strength: 1,
            status,
            sourceEpisodes: [],
            encodingContext: { project },
        });
        await adapter.semantic.upsert(makeFact("flash-high", 0.95, "allowed"));
        await adapter.semantic.upsert(makeFact("flash-low", 0.05, "allowed"));
        await adapter.semantic.upsert(makeFact("ordinary", 0.5, "allowed"));
        await adapter.semantic.upsert(makeFact("foreign-flash", 0.95, "foreign"));
        await adapter.semantic.upsert(makeFact("archived-flash", 0.95, "allowed", "archived"));

        const result = await adapter.semantic.search("term-with-no-matching-fact", 20, false, {
            project: "allowed",
            scopeMode: "strict",
        });
        expect(new Set(result.map((fact) => fact.id))).toEqual(new Set(["flash-high", "flash-low"]));
    });

    it("rejects an at-time search without a timestamp or resolvable epoch", async () => {
        await expect(adapter.semantic.search("anything", 5, false, {
            mode: "at-time",
            epochAnchor: "missing epoch",
        })).rejects.toThrow("requires `atTimestamp` or a valid `epochAnchor`");
    });

    it("preserves optional structured-fact metadata on SQLite round-trip", async () => {
        const now = Date.now();
        const id = randomUUID();
        await adapter.semantic.upsert({
            id,
            content: "사용자 거주지: 서울",
            entities: [],
            topics: [],
            createdAt: now,
            updatedAt: now,
            importance: 0.8,
            recallCount: 0,
            lastAccessed: now,
            strength: 0.8,
            status: "active",
            sourceEpisodes: [],
            structured: {
                subject: "사용자",
                property: "거주지",
                value: "서울",
                polarity: "affirmed",
                cardinality: "single",
            },
        });

        const stored = (await adapter.semantic.getAll()).find((fact) => fact.id === id);
        expect(stored?.structured).toMatchObject({ property: "거주지", value: "서울" });
    });

    it("enforces strict project scope for facts", async () => {
        const now = Date.now();
        const makeFact = (id: string, project?: string) => ({
            id, content: "common project secret", entities: [], topics: ["shared"],
            createdAt: now, updatedAt: now, importance: 0.8, recallCount: 0,
            lastAccessed: now, strength: 0.8, status: "active" as const,
            sourceEpisodes: [], encodingContext: project ? { project } : {},
        });
        await adapter.semantic.upsert(makeFact("project-a", "a"));
        await adapter.semantic.upsert(makeFact("project-b", "b"));
        await adapter.semantic.upsert(makeFact("legacy-projectless"));
		for (let i = 0; i < 20; i++) {
			await adapter.semantic.upsert(makeFact(`foreign-${i}`, "foreign"));
		}

		// topK=1 gives a global candidate window of 10; foreign candidates must
		// not starve the one valid project-scoped result.
		const scoped = await adapter.semantic.search("common", 1, false, {
            project: "a", scopeMode: "strict",
        });
        expect(scoped.map((fact) => fact.id)).toEqual(["project-a"]);
    });

	it("does not let foreign vectors starve strict project scope", async () => {
		await memory.close();
		const embedder: EmbeddingProvider = {
			name: "sqlite-scope-test", dims: 2, embeddingSpaceId: "sqlite-scope-test-v1",
			async embed(text) { return text.includes("allowed") ? [0, 1] : [1, 0]; },
			async embedBatch(texts) { return Promise.all(texts.map((text) => this.embed(text))); },
		};
		adapter = new SqliteAdapter({ dbPath, embeddingProvider: embedder });
		memory = new MemorySystem({ adapter });
		await memory.init();
		const now = Date.now();
		const makeFact = (id: string, content: string, project: string) => ({
			id, content, entities: [], topics: [], createdAt: now, updatedAt: now,
			importance: 0.8, recallCount: 0, lastAccessed: now, strength: 0.8,
			status: "active" as const, sourceEpisodes: [], encodingContext: { project },
		});
		await adapter.semantic.upsert(makeFact("allowed", "allowed distant vector", "a"));
		for (let i = 0; i < 20; i++) {
			await adapter.semantic.upsert(makeFact(`foreign-vector-${i}`, "foreign close vector", "foreign"));
		}
		const scoped = await adapter.semantic.search("foreign query", 1, false, {
			project: "a", scopeMode: "strict",
		});
		expect(scoped.map((fact) => fact.id)).toEqual(["allowed"]);
	});

	it("keeps strict vector candidates scoped across surface, deep, and history modes", async () => {
		await memory.close();
		const embedder: EmbeddingProvider = {
			name: "sqlite-strict-vector-lifecycle", dims: 2,
			embeddingSpaceId: "sqlite-strict-vector-lifecycle-v1",
			async embed() { return [1, 0]; },
			async embedBatch(texts) {
				return texts.map((text) => {
					if (text.includes("same-cold")) return [0.99, 0];
					if (text.includes("same-superseded")) return [0.98, 0];
					if (text.includes("same-archived")) return [0.97, 0];
					return [1, 0];
				});
			},
		};
		adapter = new SqliteAdapter({ dbPath, embeddingProvider: embedder });
		memory = new MemorySystem({ adapter });
		await memory.init();
		const now = Date.now();
		const makeFact = (
			id: string,
			status: "active" | "superseded" | "archived",
			strength: number,
			project: string,
		) => ({
			id,
			content: `strict-vector-fixture-${id}`,
			entities: [],
			topics: [],
			createdAt: now,
			updatedAt: now,
			importance: 1,
			recallCount: 0,
			lastAccessed: now,
			strength,
			status,
			sourceEpisodes: [],
			encodingContext: { project },
		});

		await adapter.semantic.upsert(makeFact("same-active", "active", 1, "same-project"));
		await adapter.semantic.upsert(makeFact("same-cold", "active", 0.2, "same-project"));
		await adapter.semantic.upsert(makeFact("same-superseded", "superseded", 1, "same-project"));
		await adapter.semantic.upsert(makeFact("same-archived", "archived", 1, "same-project"));
		await adapter.semantic.upsert(makeFact("foreign-close", "active", 1, "foreign-project"));

		const context = { project: "same-project", scopeMode: "strict" as const };
		const query = "zzqpnxquery";
		const surface = await adapter.semantic.search(query, 4, false, context);
		const deep = await adapter.semantic.search(query, 4, true, context);
		const history = await adapter.semantic.search(query, 4, false, { ...context, mode: "history" });

		// Surface uses the hot table and therefore returns only the scoped active
		// fact. Deep/history scan the full scoped vector table and include every
		// lifecycle state, while the equally close foreign row remains excluded.
		expect(surface.map((fact) => fact.id)).toEqual(["same-active"]);
		expect(deep.map((fact) => fact.id)).toEqual([
			"same-active",
			"same-cold",
			"same-superseded",
			"same-archived",
		]);
		expect(history.map((fact) => fact.id)).toEqual([
			"same-active",
			"same-cold",
			"same-superseded",
			"same-archived",
		]);
	});

	it("searches beyond one thousand vectors inside a strict project", async () => {
		await memory.close();
		const embedder: EmbeddingProvider = {
			name: "sqlite-large-scope-test", dims: 2, embeddingSpaceId: "sqlite-large-scope-test-v1",
			async embed() { return [1, 0]; },
			async embedBatch(texts) {
				return texts.map((text) => text.includes("target") ? [1, 0] : [0, 1]);
			},
		};
		adapter = new SqliteAdapter({ dbPath, embeddingProvider: embedder });
		memory = new MemorySystem({ adapter });
		const now = Date.now();
		const makeFact = (id: string, content: string, updatedAt: number) => ({
			id, content, entities: [], topics: [], createdAt: updatedAt, updatedAt,
			importance: 0.8, recallCount: 0, lastAccessed: updatedAt, strength: 0.8,
			status: "active" as const, sourceEpisodes: [], encodingContext: { project: "large" },
		});
		await adapter.semantic.upsert(makeFact("old-target", "target vector", now));
		for (let index = 0; index < 1001; index++) {
			await adapter.semantic.upsert(makeFact(`new-distractor-${index}`, "distractor vector", now + index + 1));
		}

		const scoped = await adapter.semantic.search("target query", 1, false, {
			project: "large", scopeMode: "strict",
		});
		expect(scoped.map((fact) => fact.id)).toEqual(["old-target"]);
	});

	it("uses document preprocessing for stored vectors", async () => {
		await memory.close();
		const calls: string[] = [];
		const embedder: EmbeddingProvider = {
			name: "sqlite-role-test", dims: 2, embeddingSpaceId: "sqlite-role-test@1",
			async embed(text) { calls.push(`query:${text}`); return [1, 0]; },
			async embedBatch(texts) { calls.push(...texts.map((text) => `document:${text}`)); return texts.map(() => [1, 0]); },
		};
		adapter = new SqliteAdapter({ dbPath, embeddingProvider: embedder });
		memory = new MemorySystem({ adapter });
		await memory.init();
		const now = Date.now();
		await adapter.semantic.upsert({
			id: "role-aware", content: "stored passage", entities: [], topics: [],
			createdAt: now, updatedAt: now, importance: 1, recallCount: 0,
			lastAccessed: now, strength: 1, status: "active", sourceEpisodes: [],
		});
		expect(calls).toContain("document:stored passage");
		expect(calls).not.toContain("query:stored passage");
	});

	it("keeps Korean FTS terms searchable", async () => {
		const now = Date.now();
		await adapter.semantic.upsert({
			id: "korean-fts", content: "사용자는 제주도에서 근무합니다", entities: ["제주도"], topics: ["근무지"],
			createdAt: now, updatedAt: now, importance: 1, recallCount: 0, lastAccessed: now,
			strength: 1, status: "active", sourceEpisodes: [],
		});
		await expect(adapter.semantic.search("제주도 근무", 5)).resolves.toEqual(
			expect.arrayContaining([expect.objectContaining({ id: "korean-fts" })]),
		);
	});

	it("does not persist a fact when its embedding is invalid", async () => {
		await memory.close();
		const embedder: EmbeddingProvider = {
			name: "invalid", dims: 2, embeddingSpaceId: "invalid-v1",
			async embed() { return [1, 0]; }, async embedBatch(texts) { return texts.map(() => [Number.NaN, 0]); },
		};
		adapter = new SqliteAdapter({ dbPath, embeddingProvider: embedder });
		memory = new MemorySystem({ adapter });
		const now = Date.now();
		await expect(adapter.semantic.upsert({
			id: "must-not-persist", content: "invalid vector", entities: [], topics: [], createdAt: now,
			updatedAt: now, importance: 1, recallCount: 0, lastAccessed: now, strength: 1,
			status: "active", sourceEpisodes: [],
		})).rejects.toThrow(/invalid vector/);
		expect((await adapter.semantic.getAll()).some((fact) => fact.id === "must-not-persist")).toBe(false);
	});

	it("removes stale hot indexes when a fact is demoted", async () => {
		const now = Date.now();
		const fact = { id: "demoted", content: "uniquedemotionterm", entities: [], topics: [], createdAt: now,
			updatedAt: now, importance: 1, recallCount: 0, lastAccessed: now, strength: 1,
			status: "active" as const, sourceEpisodes: [] };
		await adapter.semantic.upsert(fact);
		await adapter.semantic.upsert({ ...fact, strength: 0.1, updatedAt: now + 1 });
		expect(await adapter.semantic.search("uniquedemotionterm", 5, false)).toEqual([]);
		expect((await adapter.semantic.search("uniquedemotionterm", 5, true)).map((item) => item.id)).toContain("demoted");
	});

		it("archives delete targets and hides them from the hot tier", async () => {
		const now = Date.now();
		await adapter.semantic.upsert({ id: "archived", content: "archiveuniqueterm", entities: [], topics: [],
			createdAt: now, updatedAt: now, importance: 1, recallCount: 0, lastAccessed: now,
			strength: 1, status: "active", sourceEpisodes: [] });
		await expect(adapter.semantic.delete("archived")).resolves.toBe(true);
		expect((await adapter.semantic.getAll()).find((fact) => fact.id === "archived")?.status).toBe("archived");
		expect(await adapter.semantic.search("archiveuniqueterm", 5, false)).toEqual([]);
			await expect(adapter.semantic.delete("missing")).resolves.toBe(false);
		});

		it("filters superseded and archived facts before latest-view candidate truncation", async () => {
			const now = Date.now();
			const makeFact = (id: string, status: "active" | "superseded" | "archived") => ({
				id, content: "same lifecycle retrieval phrase", entities: [], topics: [],
				createdAt: now, updatedAt: now, importance: 1, recallCount: 0,
				lastAccessed: now, strength: 1, status, sourceEpisodes: [],
			});
			for (let index = 0; index < 60; index++) {
				await adapter.semantic.upsert(makeFact(`old-${index}`, "superseded"));
			}
			await adapter.semantic.upsert({
				...makeFact("cold-history", "superseded"),
				content: "cold historical marker",
				strength: 0.5,
			});
			await adapter.semantic.upsert(makeFact("current", "active"));

			expect((await adapter.semantic.search("lifecycle retrieval", 1)).map((fact) => fact.id))
				.toEqual(["current"]);
			expect((await adapter.semantic.search("", 100)).every((fact) => fact.status === "active"))
				.toBe(true);
			expect((await adapter.semantic.search("lifecycle retrieval", 100, false, { mode: "history" }))
				.some((fact) => fact.status === "superseded")).toBe(true);
			expect((await adapter.semantic.search("cold historical marker", 5, false, { mode: "history" }))
				.map((fact) => fact.id)).toContain("cold-history");
		});

		it("keeps inactive vectors out of latest candidates and honors topK above fifty", async () => {
			await memory.close();
			const embedder: EmbeddingProvider = {
				name: "lifecycle-vector", dims: 2, embeddingSpaceId: "lifecycle-vector-v1",
				async embed() { return [1, 0]; },
				async embedBatch(texts) { return texts.map(() => [1, 0]); },
			};
			adapter = new SqliteAdapter({ dbPath, embeddingProvider: embedder });
			memory = new MemorySystem({ adapter });
			const now = Date.now();
			const makeFact = (id: string, status: "active" | "superseded") => ({
				id, content: "vector lifecycle marker", entities: [], topics: [],
				createdAt: now, updatedAt: now, importance: 1, recallCount: 0,
				lastAccessed: now, strength: 1, status, sourceEpisodes: [],
			});
			for (let index = 0; index < 60; index++) {
				await adapter.semantic.upsert(makeFact(`inactive-vector-${index}`, "superseded"));
			}
			for (let index = 0; index < 60; index++) {
				await adapter.semantic.upsert(makeFact(`active-vector-${index}`, "active"));
			}

			const latest = await adapter.semantic.search("vector lifecycle marker", 60);
			expect(latest).toHaveLength(60);
			expect(latest.every((fact) => fact.status === "active")).toBe(true);
		});

	it("recreates an empty default-dimension vector table for a configured embedder", async () => {
		await memory.close();
		const embedder: EmbeddingProvider = {
			name: "two-dim", dims: 2, embeddingSpaceId: "two-dim-v1",
			async embed() { return [1, 0]; }, async embedBatch(texts) { return texts.map(() => [1, 0]); },
		};
		adapter = new SqliteAdapter({ dbPath, embeddingProvider: embedder });
		memory = new MemorySystem({ adapter });
		const now = Date.now();
		await expect(adapter.semantic.upsert({ id: "two-dim", content: "two dimensions", entities: [], topics: [],
			createdAt: now, updatedAt: now, importance: 1, recallCount: 0, lastAccessed: now,
			strength: 1, status: "active", sourceEpisodes: [] })).resolves.toBeUndefined();
	});

	it("rejects reopening vectors with a different equal-dimension embedding space", async () => {
		await memory.close();
		const provider = (space: string): EmbeddingProvider => ({
			name: "sqlite-space-test", dims: 2, embeddingSpaceId: space,
			async embed() { return [1, 0]; },
			async embedBatch(texts) { return texts.map(() => [1, 0]); },
		});
		adapter = new SqliteAdapter({ dbPath, embeddingProvider: provider("space-a") });
		memory = new MemorySystem({ adapter });
		await memory.init();
		const now = Date.now();
		await adapter.semantic.upsert({
			id: "space-fact", content: "space fact", entities: [], topics: [],
			createdAt: now, updatedAt: now, importance: 1, recallCount: 0,
			lastAccessed: now, strength: 1, status: "active", sourceEpisodes: [],
		});
		await memory.close();
		adapter = new SqliteAdapter({ dbPath, embeddingProvider: provider("space-b") });
		memory = new MemorySystem({ adapter });
		await expect(adapter.semantic.getAll()).rejects.toThrow(/embedding-space mismatch/);
	});

	it("reindexes all SQLite vectors only after explicit mismatch opt-in", async () => {
		await memory.close();
		const provider = (space: string, documentVector: number[]): EmbeddingProvider => ({
			name: "sqlite-reindex-test", dims: 2, embeddingSpaceId: space,
			async embed() { return documentVector; },
			async embedBatch(texts) { return texts.map(() => documentVector); },
		});
		adapter = new SqliteAdapter({ dbPath, embeddingProvider: provider("space-old", [1, 0]) });
		memory = new MemorySystem({ adapter });
		await memory.init();
		const now = Date.now();
		await adapter.semantic.upsert({
			id: "reindexed", content: "reindex me", entities: [], topics: [],
			createdAt: now, updatedAt: now, importance: 1, recallCount: 0,
			lastAccessed: now, strength: 1, status: "active", sourceEpisodes: [],
		});
		await adapter.semantic.upsert({
			id: "archived-before-reindex", content: "archived reindex me", entities: [], topics: [],
			createdAt: now, updatedAt: now, importance: 1, recallCount: 0,
			lastAccessed: now, strength: 1, status: "active", sourceEpisodes: [],
		});
		await expect(adapter.semantic.delete("archived-before-reindex")).resolves.toBe(true);
		await memory.close();
		adapter = new SqliteAdapter({
			dbPath, embeddingProvider: provider("space-new", [0, 1]),
			reindexEmbeddingsOnMismatch: true,
		});
		memory = new MemorySystem({ adapter });
		await expect(adapter.semantic.getAll()).resolves.toHaveLength(2);
		await expect(adapter.semantic.search("reindex", 10, false)).resolves.toEqual([
			expect.objectContaining({ id: "reindexed", status: "active" }),
		]);
		await memory.close();
		adapter = new SqliteAdapter({ dbPath, embeddingProvider: provider("space-new", [0, 1]) });
		memory = new MemorySystem({ adapter });
		await expect(adapter.semantic.getAll()).resolves.toHaveLength(2);
	});

    it("enforces strict project scope for episodes", async () => {
        const now = Date.now();
        const makeEpisode = (id: string, project?: string) => ({
            id, content: "공통 에피소드", summary: "공통 에피소드", timestamp: now,
            role: "user" as const, consolidated: false, recallCount: 0,
            lastAccessed: now, strength: 1,
            importance: { importance: 1, surprise: 0, emotion: 0, utility: 1 },
            encodingContext: project ? { project } : {},
        });
        await adapter.episode.store(makeEpisode("episode-a", "a"));
        await adapter.episode.store(makeEpisode("episode-b", "b"));
        await adapter.episode.store(makeEpisode("episode-projectless"));

        const scoped = await adapter.episode.recall("공통", {
            project: "a", scopeMode: "strict", topK: 10,
        });
        expect(scoped.map((episode) => episode.id)).toEqual(["episode-a"]);
    });
});
