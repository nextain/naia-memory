import { describe, expect, it, vi } from "vitest";
import { Mem0Adapter } from "../adapters/mem0.js";
import type { Episode } from "../types.js";

function episode(id: string): Episode {
	return {
		id,
		content: "DJ preference payload",
		summary: "DJ preference payload",
		timestamp: 1,
		importance: { importance: 1, surprise: 0, emotion: 0.5, utility: 1 },
		encodingContext: { project: "p", sessionId: "s" },
		consolidated: false,
		recallCount: 0,
		lastAccessed: 1,
		strength: 1,
	};
}

describe("Mem0Adapter episode idempotency", () => {
	it("does not add an episode again after adapter restart", async () => {
		const persisted = [{
			id: "external-1",
			memory: "DJ preference payload",
			metadata: { type: "episode", episodeId: "episode-1" },
		}];
		const client = {
			getAll: vi.fn(async () => ({ results: persisted })),
			add: vi.fn(async () => undefined),
		};
		const options = {
			mem0Config: {
				embedder: { provider: "test", config: {} },
				vectorStore: { provider: "test", config: {} },
				llm: { provider: "test", config: {} },
			},
			memoryFactory: async () => client,
		};
		await new Mem0Adapter(options).episode.store(episode("episode-1"));
		await new Mem0Adapter(options).episode.store(episode("episode-1"));
		expect(client.add).not.toHaveBeenCalled();
		expect(client.getAll).toHaveBeenCalledTimes(2);
	});
});
