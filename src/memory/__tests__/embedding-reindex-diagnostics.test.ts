import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "../adapters/local.js";
import type { EmbeddingProvider } from "../embeddings.js";
import { MemorySystem } from "../index.js";

describe("LocalAdapter embedding reindex diagnostics (FR-MEM-REINDEX-DIAG-1, #681)", () => {
	const dirs: string[] = [];

	afterEach(async () => {
		await Promise.all(
			dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	it("MemorySystem surfaces getEmbeddingReindexError from adapter", async () => {
		const dir = await mkdtemp(join(tmpdir(), "naia-memory-system-boom-"));
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
						content: "테스트 사실",
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
				embeddingSpaceId: "model-x",
			}),
		);

		const embedder: EmbeddingProvider = {
			name: "failing-embedder",
			dims: 2,
			embeddingSpaceId: "model-y",
			async embed() {
				return [0, 1];
			},
			async embedBatch() {
				throw new Error("boom in MemorySystem auto-reindex");
			},
		};

		const adapter = new LocalAdapter({
			storePath,
			embeddingProvider: embedder,
			reindexEmbeddingsOnMismatch: true,
		});

		const memory = new MemorySystem({ adapter });
		// memory.init() awaits whenReady()
		await memory.init();

		expect(memory.getEmbeddingReindexError()).toContain("boom in MemorySystem auto-reindex");
		await memory.close();
	});
});
