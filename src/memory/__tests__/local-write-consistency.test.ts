import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "../adapters/local.js";
import type { EmbeddingProvider } from "../embeddings.js";

describe("LocalAdapter write consistency", () => {
	const dirs: string[] = [];
	afterEach(async () => {
		await Promise.all(
			dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	it.each(["semantic", "episode"])(
		"rejects an in-flight %s write across reset",
		async (kind) => {
			const dir = await mkdtemp(join(tmpdir(), "naia-reset-race-"));
			dirs.push(dir);
			let release!: () => void;
			let started!: () => void;
			const blocked = new Promise<void>((resolve) => {
				release = resolve;
			});
			const didStart = new Promise<void>((resolve) => {
				started = resolve;
			});
			const embedder: EmbeddingProvider = {
				name: "blocked",
				dims: 2,
				embeddingSpaceId: "blocked-v1",
				async embed() {
					return [1, 0];
				},
				async embedBatch(texts) {
					started();
					await blocked;
					return texts.map(() => [1, 0]);
				},
			};
			const adapter = new LocalAdapter({
				storePath: join(dir, "memory.json"),
				embeddingProvider: embedder,
			});
			const now = Date.now();
			const write =
				kind === "semantic"
					? adapter.semantic.upsert({
							id: "late",
							content: "late",
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
						})
					: adapter.episode.store({
							id: "late",
							content: "late",
							summary: "late",
							timestamp: now,
							role: "user",
							encodingContext: {},
							consolidated: false,
							recallCount: 0,
							lastAccessed: now,
							strength: 1,
							importance: {
								importance: 1,
								surprise: 0,
								emotion: 0,
								utility: 1,
							},
						});
			await didStart;
			adapter.reset();
			release();
			await expect(write).rejects.toThrow(
				/Memory store changed while embedding/,
			);
			expect(adapter.getStore().facts).toEqual([]);
			expect(adapter.getStore().episodes).toEqual([]);
		},
	);

	it("serializes concurrent semantic inserts with the same identity", async () => {
		const dir = await mkdtemp(join(tmpdir(), "naia-upsert-race-"));
		dirs.push(dir);
		let release!: () => void;
		let starts = 0;
		let firstStarted!: () => void;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		const didFirstStart = new Promise<void>((resolve) => {
			firstStarted = resolve;
		});
		const embedder: EmbeddingProvider = {
			name: "blocked",
			dims: 2,
			embeddingSpaceId: "blocked-v1",
			async embed() {
				return [1, 0];
			},
			async embedBatch(texts) {
				starts++;
				firstStarted();
				await blocked;
				return texts.map(() => [1, 0]);
			},
		};
		const adapter = new LocalAdapter({
			storePath: join(dir, "memory.json"),
			embeddingProvider: embedder,
		});
		const now = Date.now();
		const base = {
			id: "shared",
			content: "same",
			topics: [],
			createdAt: now,
			updatedAt: now,
			importance: 1,
			recallCount: 0,
			lastAccessed: now,
			strength: 1,
			status: "active" as const,
			sourceEpisodes: [],
		};
		const writes = [
			adapter.semantic.upsert({ ...base, entities: ["first"] }),
			adapter.semantic.upsert({ ...base, entities: ["second"] }),
		];
		await didFirstStart;
		expect(starts).toBe(1);
		release();
		await Promise.all(writes);
		const matching = adapter
			.getStore()
			.facts.filter((fact) => fact.id === "shared");
		expect(matching).toHaveLength(1);
		expect(matching[0].entities).toEqual(["first", "second"]);
		expect(starts).toBe(1);
	});

	it("removes a mismatched vector after a concurrent embedding failure", async () => {
		const dir = await mkdtemp(join(tmpdir(), "naia-content-race-"));
		dirs.push(dir);
		let resolveFirst!: () => void;
		let rejectSecond!: () => void;
		let markFirstStarted!: () => void;
		let markSecondStarted!: () => void;
		const firstStarted = new Promise<void>((resolve) => {
			markFirstStarted = resolve;
		});
		const secondStarted = new Promise<void>((resolve) => {
			markSecondStarted = resolve;
		});
		const embedder: EmbeddingProvider = {
			name: "controlled",
			dims: 2,
			embeddingSpaceId: "controlled-v1",
			async embed() {
				return [0, 0];
			},
			embedBatch([text]) {
				return new Promise((resolve, reject) => {
					if (text === "first") {
						resolveFirst = () => resolve([[1, 0]]);
						markFirstStarted();
					} else {
						rejectSecond = () => reject(new Error("failed"));
						markSecondStarted();
					}
				});
			},
		};
		const adapter = new LocalAdapter({
			storePath: join(dir, "memory.json"),
			embeddingProvider: embedder,
		});
		const now = Date.now();
		const base = {
			id: "shared",
			entities: [],
			topics: [],
			createdAt: now,
			updatedAt: now,
			importance: 1,
			recallCount: 0,
			lastAccessed: now,
			strength: 1,
			status: "active" as const,
			sourceEpisodes: [],
		};
		const first = adapter.semantic.upsert({ ...base, content: "first" });
		const second = adapter.semantic.upsert({ ...base, content: "second" });
		await firstStarted;
		resolveFirst();
		await first;
		await secondStarted;
		rejectSecond();
		await second;
		expect(adapter.getStore().facts[0]?.content).toBe("second");
		expect(adapter.getStore().factEmbeddings?.shared).toBeUndefined();
	});

	it("removes a stale episode vector when replacement embedding fails", async () => {
		const dir = await mkdtemp(join(tmpdir(), "naia-episode-failure-"));
		dirs.push(dir);
		let fail = false;
		const embedder: EmbeddingProvider = {
			name: "sometimes-failing",
			dims: 2,
			embeddingSpaceId: "sometimes-failing-v1",
			async embed() {
				return [0, 0];
			},
			async embedBatch() {
				if (fail) throw new Error("failed");
				return [[1, 0]];
			},
		};
		const adapter = new LocalAdapter({
			storePath: join(dir, "memory.json"),
			embeddingProvider: embedder,
		});
		const now = Date.now();
		const base = {
			id: "episode",
			summary: "summary",
			timestamp: now,
			role: "user" as const,
			encodingContext: {},
			consolidated: false,
			recallCount: 0,
			lastAccessed: now,
			strength: 1,
			importance: { importance: 1, surprise: 0, emotion: 0, utility: 1 },
		};
		await adapter.episode.store({ ...base, content: "first" });
		fail = true;
		await adapter.episode.store({ ...base, content: "second" });
		expect(adapter.getStore().episodes[0]?.content).toBe("second");
		expect(adapter.getStore().episodeEmbeddings?.episode).toBeUndefined();
	});

	it("retries a missing semantic embedding when content is unchanged", async () => {
		const dir = await mkdtemp(join(tmpdir(), "naia-embedding-retry-"));
		dirs.push(dir);
		let calls = 0;
		const embedder: EmbeddingProvider = {
			name: "transient",
			dims: 2,
			embeddingSpaceId: "transient-v1",
			async embed() {
				return [1, 0];
			},
			async embedBatch() {
				if (++calls === 1) throw new Error("transient");
				return [[1, 0]];
			},
		};
		const adapter = new LocalAdapter({
			storePath: join(dir, "memory.json"),
			embeddingProvider: embedder,
		});
		const now = Date.now();
		const fact = {
			id: "retry",
			content: "same",
			entities: [],
			topics: [],
			createdAt: now,
			updatedAt: now,
			importance: 1,
			recallCount: 0,
			lastAccessed: now,
			strength: 1,
			status: "active" as const,
			sourceEpisodes: [],
		};
		await adapter.semantic.upsert(fact);
		await adapter.semantic.upsert(fact);
		expect(calls).toBe(2);
		expect(adapter.getStore().factEmbeddings?.retry).toEqual([1, 0]);
	});

	it.each(["semantic", "episode"])(
		"snapshots caller-owned %s input before awaiting",
		async (kind) => {
			const dir = await mkdtemp(join(tmpdir(), "naia-input-snapshot-"));
			dirs.push(dir);
			let release!: () => void;
			let started!: () => void;
			let embeddedText = "";
			const blocked = new Promise<void>((resolve) => {
				release = resolve;
			});
			const didStart = new Promise<void>((resolve) => {
				started = resolve;
			});
			const embedder: EmbeddingProvider = {
				name: "blocked",
				dims: 2,
				embeddingSpaceId: "blocked-v1",
				async embed() {
					return [1, 0];
				},
				async embedBatch([text]) {
					embeddedText = text;
					started();
					await blocked;
					return [[1, 0]];
				},
			};
			const adapter = new LocalAdapter({
				storePath: join(dir, "memory.json"),
				embeddingProvider: embedder,
			});
			const now = Date.now();
			const input =
				kind === "semantic"
					? {
							id: "snapshot",
							content: "before",
							entities: [],
							topics: [],
							createdAt: now,
							updatedAt: now,
							importance: 1,
							recallCount: 0,
							lastAccessed: now,
							strength: 1,
							status: "active" as const,
							sourceEpisodes: [],
						}
					: {
							id: "snapshot",
							content: "before",
							summary: "before",
							timestamp: now,
							role: "user" as const,
							encodingContext: {},
							consolidated: false,
							recallCount: 0,
							lastAccessed: now,
							strength: 1,
							importance: {
								importance: 1,
								surprise: 0,
								emotion: 0,
								utility: 1,
							},
						};
			const write =
				kind === "semantic"
					? adapter.semantic.upsert(
							input as Parameters<typeof adapter.semantic.upsert>[0],
						)
					: adapter.episode.store(
							input as Parameters<typeof adapter.episode.store>[0],
						);
			await didStart;
			input.content = "after";
			release();
			await write;
			const stored =
				kind === "semantic"
					? adapter.getStore().facts[0]
					: adapter.getStore().episodes[0];
			expect(embeddedText).toBe("before");
			expect(stored?.content).toBe("before");
		},
	);

	it.each([
		{ kind: "semantic", shape: "oversized", vector: [1, 0, 99] },
		{ kind: "episode", shape: "oversized", vector: [1, 0, 99] },
		{ kind: "semantic", shape: "sparse", vector: [1, ,] as number[] },
		{ kind: "episode", shape: "sparse", vector: [1, ,] as number[] },
	])("does not persist $shape $kind embeddings", async ({ kind, vector }) => {
		const dir = await mkdtemp(join(tmpdir(), "naia-invalid-vector-"));
		dirs.push(dir);
		const embedder: EmbeddingProvider = {
			name: "malformed",
			dims: 2,
			embeddingSpaceId: "malformed-v1",
			async embed() {
				return vector;
			},
			async embedBatch() {
				return [vector];
			},
		};
		const adapter = new LocalAdapter({
			storePath: join(dir, "memory.json"),
			embeddingProvider: embedder,
		});
		const now = Date.now();
		if (kind === "semantic") {
			await adapter.semantic.upsert({
				id: "invalid",
				content: "invalid",
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
			expect(adapter.getStore().factEmbeddings?.invalid).toBeUndefined();
		} else {
			await adapter.episode.store({
				id: "invalid",
				content: "invalid",
				summary: "invalid",
				timestamp: now,
				role: "user",
				encodingContext: {},
				consolidated: false,
				recallCount: 0,
				lastAccessed: now,
				strength: 1,
				importance: { importance: 1, surprise: 0, emotion: 0, utility: 1 },
			});
			expect(adapter.getStore().episodeEmbeddings?.invalid).toBeUndefined();
		}
	});

	it("makes reset durable before returning", async () => {
		const dir = await mkdtemp(join(tmpdir(), "naia-reset-durable-"));
		dirs.push(dir);
		const storePath = join(dir, "memory.json");
		const adapter = new LocalAdapter({ storePath });
		const now = Date.now();
		await adapter.semantic.upsert({
			id: "old",
			content: "old",
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
		await adapter.flush();
		adapter.reset();
		const reopened = new LocalAdapter({ storePath });
		expect(reopened.getStore().facts).toEqual([]);
	});
});
