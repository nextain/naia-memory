import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemorySystem } from "../index.js";
import { SqliteAdapter } from "../adapters/sqlite.js";
import { randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { EmbeddingProvider } from "../embeddings.js";

describe("SqliteAdapter Smoke Test", () => {
    let memory: MemorySystem;
    let adapter: SqliteAdapter;
    let dbPath: string;

    beforeEach(async () => {
        dbPath = join(homedir(), ".naia", "memory", `test-smoke-${randomUUID()}.db`);
        adapter = new SqliteAdapter({ dbPath });
        memory = new MemorySystem({ adapter });
        await memory.init();
    });

    afterEach(async () => {
        await memory.close();
        if (existsSync(dbPath)) {
            try { unlinkSync(dbPath); } catch {}
        }
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

    it("should support epoch-based filtering in SQLite", async () => {
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
		await memory.close();
		adapter = new SqliteAdapter({
			dbPath, embeddingProvider: provider("space-new", [0, 1]),
			reindexEmbeddingsOnMismatch: true,
		});
		memory = new MemorySystem({ adapter });
		await expect(adapter.semantic.getAll()).resolves.toHaveLength(1);
		await memory.close();
		adapter = new SqliteAdapter({ dbPath, embeddingProvider: provider("space-new", [0, 1]) });
		memory = new MemorySystem({ adapter });
		await expect(adapter.semantic.getAll()).resolves.toHaveLength(1);
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
