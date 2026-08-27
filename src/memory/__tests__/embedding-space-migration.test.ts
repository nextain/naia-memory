import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "../adapters/local.js";
import type { EmbeddingProvider } from "../embeddings.js";

class FixedEmbedder implements EmbeddingProvider {
	readonly name = "fixed";
	readonly dims = 2;
	constructor(readonly embeddingSpaceId: string) {}
	async embed(text: string): Promise<number[]> {
		return text.includes("질의") ? [1, 0] : [0, 1];
	}
	async embedBatch(texts: string[]): Promise<number[][]> {
		return Promise.all(texts.map((text) => this.embed(text)));
	}
}

describe("LocalAdapter embedding-space migration", () => {
	const dirs: string[] = [];
	afterEach(async () => {
		await Promise.all(
			dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	it("rejects equal-dimension vectors from another model until explicit reindex", async () => {
		const dir = await mkdtemp(join(tmpdir(), "naia-embedding-space-"));
		dirs.push(dir);
		const storePath = join(dir, "memory.json");
		const now = Date.now();
		await writeFile(
			storePath,
			JSON.stringify({
				version: 1,
				episodes: [],
				facts: [
					{
						id: "fact-1",
						content: "저장된 사실",
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
					},
				],
				skills: [],
				reflections: [],
				associations: {},
				factEmbeddings: { "fact-1": [1, 0] },
				episodeEmbeddings: {},
				embeddingSpaceId: "model-a",
			}),
		);

		const adapter = new LocalAdapter({
			storePath,
			embeddingProvider: new FixedEmbedder("model-b"),
		});
		await expect(adapter.semantic.search("질의", 5)).rejects.toThrow(
			/call reindexEmbeddings/,
		);

		await adapter.reindexEmbeddings();
		await expect(adapter.semantic.search("질의", 5)).resolves.toBeDefined();
		const persisted = JSON.parse(await readFile(storePath, "utf8"));
		expect(persisted.embeddingSpaceId).toBe("model-b");
	});

	it("rejects unidentified legacy vectors instead of silently adopting them", async () => {
		const dir = await mkdtemp(join(tmpdir(), "naia-embedding-legacy-"));
		dirs.push(dir);
		const storePath = join(dir, "memory.json");
		await writeFile(
			storePath,
			JSON.stringify({
				version: 1,
				episodes: [],
				facts: [],
				skills: [],
				reflections: [],
				associations: {},
				factEmbeddings: { legacy: [1, 0] },
				episodeEmbeddings: {},
			}),
		);
		const adapter = new LocalAdapter({
			storePath,
			embeddingProvider: new FixedEmbedder("model-b"),
		});
		await expect(adapter.semantic.search("질의", 5)).rejects.toThrow(
			/legacy vectors/,
		);
	});

	it("leaves facts and episodes unchanged when embedding identity rejects a write", async () => {
		const dir = await mkdtemp(join(tmpdir(), "naia-embedding-rejected-write-"));
		dirs.push(dir);
		const storePath = join(dir, "memory.json");
		await writeFile(
			storePath,
			JSON.stringify({
				version: 1,
				episodes: [],
				facts: [],
				skills: [],
				reflections: [],
				associations: {},
				factEmbeddings: { legacy: [1, 0] },
				episodeEmbeddings: {},
			}),
		);
		const adapter = new LocalAdapter({
			storePath,
			embeddingProvider: new FixedEmbedder("model-b"),
		});
		const now = Date.now();
		await expect(
			adapter.semantic.upsert({
				id: "rejected-fact",
				content: "거부될 사실",
				entities: ["entity"],
				topics: [],
				createdAt: now,
				updatedAt: now,
				importance: 1,
				recallCount: 0,
				lastAccessed: now,
				strength: 1,
				status: "active",
				sourceEpisodes: [],
			}),
		).rejects.toThrow(/legacy vectors/);
		await expect(
			adapter.episode.store({
				id: "rejected-episode",
				content: "거부될 에피소드",
				summary: "거부될 에피소드",
				timestamp: now,
				role: "user",
				encodingContext: {},
				consolidated: false,
				recallCount: 0,
				lastAccessed: now,
				strength: 1,
				importance: { importance: 1, surprise: 0, emotion: 0, utility: 1 },
			}),
		).rejects.toThrow(/legacy vectors/);
		expect(adapter.getStore().facts).toEqual([]);
		expect(adapter.getStore().episodes).toEqual([]);
	});

	it("aborts reindex if memory changes while embeddings are being built", async () => {
		const dir = await mkdtemp(
			join(tmpdir(), "naia-embedding-concurrent-reindex-"),
		);
		dirs.push(dir);
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		let started!: () => void;
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
		adapter.getStore().facts.push({
			id: "fact-1",
			content: "기존 사실",
			entities: [],
			topics: [],
			createdAt: 1,
			updatedAt: 1,
			importance: 1,
			recallCount: 0,
			lastAccessed: 1,
			strength: 1,
			status: "active",
			sourceEpisodes: [],
		});
		const reindex = adapter.reindexEmbeddings();
		await didStart;
		await adapter.upsertEpoch({
			id: "epoch-1",
			name: "동시 변경",
			start: 1,
			end: null,
		});
		release();
		await expect(reindex).rejects.toThrow(/Memory changed while reindexing/);
		expect(adapter.getStore().embeddingSpaceId).toBe("blocked-v1");
		expect(adapter.getStore().factEmbeddings?.["fact-1"]).toBeUndefined();
	});

	it("rejects an unidentified provider before persisting vectors", async () => {
		const dir = await mkdtemp(join(tmpdir(), "naia-embedding-unidentified-"));
		dirs.push(dir);
		const provider: EmbeddingProvider = {
			name: "unidentified",
			dims: 2,
			async embed() {
				return [1, 0];
			},
			async embedBatch(texts) {
				return texts.map(() => [1, 0]);
			},
		};
		const adapter = new LocalAdapter({
			storePath: join(dir, "memory.json"),
			embeddingProvider: provider,
		});
		await expect(adapter.semantic.search("질의", 5)).rejects.toThrow(
			/no embedding-space identity/,
		);
		await expect(adapter.reindexEmbeddings()).rejects.toThrow(
			/unidentified embedding provider/,
		);
		adapter.reset();
		await expect(adapter.semantic.search("질의", 5)).rejects.toThrow(
			/no embedding-space identity/,
		);
	});

	it("uses document preprocessing for persisted facts and query preprocessing for recall", async () => {
		const dir = await mkdtemp(join(tmpdir(), "naia-embedding-role-"));
		dirs.push(dir);
		const calls: string[] = [];
		const embedder: EmbeddingProvider = {
			name: "role-aware",
			dims: 2,
			embeddingSpaceId: "role-aware-v1",
			async embed(text) {
				calls.push(`query:${text}`);
				return [1, 0];
			},
			async embedBatch(texts) {
				calls.push(...texts.map((text) => `document:${text}`));
				return texts.map(() => [0, 1]);
			},
		};
		const adapter = new LocalAdapter({
			storePath: join(dir, "memory.json"),
			embeddingProvider: embedder,
		});
		const now = Date.now();
		await adapter.semantic.upsert({
			id: "fact-1",
			content: "저장 문서",
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
		await adapter.semantic.search("질의", 5);
		expect(adapter.getStore().factEmbeddings?.["fact-1"]).toEqual([0, 1]);
		expect(calls).toEqual(["document:저장 문서", "query:질의"]);
	});

	it("rechecks embedding-space identity after backup import", async () => {
		const sourceDir = await mkdtemp(
			join(tmpdir(), "naia-embedding-backup-source-"),
		);
		const targetDir = await mkdtemp(
			join(tmpdir(), "naia-embedding-backup-target-"),
		);
		dirs.push(sourceDir, targetDir);
		const source = new LocalAdapter({
			storePath: join(sourceDir, "memory.json"),
			embeddingProvider: new FixedEmbedder("model-a"),
		});
		const now = Date.now();
		await source.semantic.upsert({
			id: "fact-1",
			content: "저장된 사실",
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
		const blob = await source.export("password");
		const target = new LocalAdapter({
			storePath: join(targetDir, "memory.json"),
			embeddingProvider: new FixedEmbedder("model-b"),
		});
		await target.import(blob, "password");
		await expect(target.semantic.search("질의", 5)).rejects.toThrow(
			/stored=model-a current=model-b/,
		);
		await target.reindexEmbeddings();
		await expect(target.semantic.search("질의", 5)).resolves.toBeDefined();
	});

	it("preserves the current embedding-space identity across reset and reopen", async () => {
		const dir = await mkdtemp(join(tmpdir(), "naia-embedding-reset-"));
		dirs.push(dir);
		const storePath = join(dir, "memory.json");
		const embedder = new FixedEmbedder("model-current");
		const adapter = new LocalAdapter({
			storePath,
			embeddingProvider: embedder,
		});
		adapter.reset();
		await adapter.close();

		const reopened = new LocalAdapter({
			storePath,
			embeddingProvider: embedder,
		});
		await expect(reopened.semantic.search("질의", 5)).resolves.toBeDefined();
		expect(reopened.getStore().embeddingSpaceId).toBe("model-current");
	});

	it("persists knowledge-graph mutations made after reset", async () => {
		const dir = await mkdtemp(join(tmpdir(), "naia-reset-knowledge-graph-"));
		dirs.push(dir);
		const storePath = join(dir, "memory.json");
		const adapter = new LocalAdapter({ storePath });

		adapter.reset();
		expect(adapter.getStore().knowledgeGraph).toBeDefined();
		await adapter.semantic.associate("alpha", "beta", 0.5);
		await adapter.close();

		const reopened = new LocalAdapter({ storePath });
		expect(reopened.getKnowledgeGraph().getNeighbors("alpha")).toEqual([
			{ neighbor: "beta", weight: 0.5 },
		]);
	});
});
