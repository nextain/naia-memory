import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { LocalAdapter } from "../adapters/local.js";
import type { Fact } from "../types.js";

it("limits candidates admitted by vector similarity alone", async () => {
	const dir = await mkdtemp(join(tmpdir(), "vector-limit-"));
	const embed = async (text: string) => [1, text.startsWith("query") ? 0 : Number(text.slice(-1)) / 10];
	const adapter = new LocalAdapter({ storePath: join(dir, "store.json"), embeddingProvider: {
		name: "fake", embeddingSpaceId: "fake-v1", dims: 2, embed, embedBatch: async (texts) => Promise.all(texts.map(embed)),
	}, vectorCandidateLimit: 2 });
	try {
		for (let i = 0; i < 5; i++) {
			const now = Date.now();
			const fact: Fact = { id: String(i), content: `item${i}`, entities: [], topics: [], importance: 0.5, maxEmotion: 0.5, strength: 0.5, status: "active", createdAt: now, updatedAt: now, lastAccessed: now, recallCount: 0, sourceEpisodes: [] };
			await adapter.semantic.upsert(fact);
		}
		expect((await adapter.semantic.search("query", 10)).map(f => f.id)).toEqual(["0", "1"]);
		expect((await adapter.semantic.search("query item4", 10)).map(f => f.id)).toContain("4");
	} finally {
		await adapter.close();
		await rm(dir, { recursive: true, force: true });
	}
});
