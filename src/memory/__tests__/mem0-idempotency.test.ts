import { describe, expect, it, vi } from "vitest";
import { Mem0Adapter } from "../adapters/mem0.js";
import type { Episode } from "../types.js";

function episode(id: string, content = "DJ preference payload"): Episode {
	return {
		id,
		content,
		summary: content,
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
	it("updates the same persisted episode after adapter restart", async () => {
		const persisted = [{
			id: "external-1",
			memory: "DJ preference payload",
			metadata: { type: "episode", episodeId: "episode-1" },
		}];
		const client = {
			getAll: vi.fn(async () => ({ results: persisted })),
			add: vi.fn(async () => undefined),
			update: vi.fn(async () => undefined),
		};
		const options = {
			mem0Config: {
				embedder: { provider: "test", config: {} },
				vectorStore: { provider: "test", config: {} },
				llm: { provider: "test", config: {} },
			},
			memoryFactory: async () => client,
		};
		await new Mem0Adapter(options).episode.store(episode("episode-1", "new payload"));
		expect(client.add).not.toHaveBeenCalled();
		expect(client.update).toHaveBeenCalledWith("external-1", "new payload");
		expect(client.getAll).toHaveBeenCalledTimes(1);
	});

	it("serializes concurrent retries and applies the last payload", async () => {
		const persisted: Array<{ id: string; memory: string; metadata: Record<string, string> }> = [];
		const client = {
			getAll: vi.fn(async () => ({ results: persisted.map((item) => ({ ...item })) })),
			add: vi.fn(async (messages: Array<{ content: string }>, options: { metadata: Record<string, string> }) => {
				await Promise.resolve();
				persisted.push({ id: "external-1", memory: messages[0].content, metadata: options.metadata });
			}),
			update: vi.fn(async (id: string, content: string) => {
				const item = persisted.find((candidate) => candidate.id === id);
				if (item) item.memory = content;
			}),
		};
		const adapter = new Mem0Adapter({
			mem0Config: {
				embedder: { provider: "test", config: {} },
				vectorStore: { provider: "test", config: {} },
				llm: { provider: "test", config: {} },
			},
			memoryFactory: async () => client,
		});
		await Promise.all([
			adapter.episode.store(episode("episode-1", "first payload")),
			adapter.episode.store(episode("episode-1", "last payload")),
		]);
		expect(client.add).toHaveBeenCalledTimes(1);
		expect(client.update).toHaveBeenCalledWith("external-1", "last payload");
		expect(persisted).toEqual([
			expect.objectContaining({ memory: "last payload" }),
		]);
		expect(await adapter.episode.getRecent(1)).toEqual([
			expect.objectContaining({ id: "episode-1", content: "last payload" }),
		]);
	});

	it("runs a same-ID retry that was queued before the first write failed", async () => {
		let attempts = 0;
		const client = {
			getAll: vi.fn(async () => {
				if (attempts++ === 0) throw new Error("transient lookup failure");
				return { results: [] };
			}),
			add: vi.fn(async () => undefined),
			update: vi.fn(async () => undefined),
		};
		const adapter = new Mem0Adapter({
			mem0Config: {
				embedder: { provider: "test", config: {} },
				vectorStore: { provider: "test", config: {} },
				llm: { provider: "test", config: {} },
			},
			memoryFactory: async () => client,
		});

		const first = adapter.episode.store(episode("episode-retry", "first payload"));
		const queuedRetry = adapter.episode.store(episode("episode-retry", "retry payload"));
		expect(await Promise.allSettled([first, queuedRetry])).toEqual([
			expect.objectContaining({ status: "rejected" }),
			expect.objectContaining({ status: "fulfilled" }),
		]);
		expect(client.getAll).toHaveBeenCalledTimes(2);
		expect(client.add).toHaveBeenCalledTimes(1);
		expect(await adapter.episode.getRecent(1)).toEqual([
			expect.objectContaining({ id: "episode-retry", content: "retry payload" }),
		]);
	});

	it("does not serialize writes for different episode IDs behind one lock", async () => {
		let releaseFirst!: () => void;
		const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
		let secondEntered!: () => void;
		const secondStarted = new Promise<void>((resolve) => { secondEntered = resolve; });
		const client = {
			getAll: vi.fn(async () => ({ results: [] })),
			add: vi.fn(async (_messages: unknown, options: { metadata: { episodeId: string } }) => {
				if (options.metadata.episodeId === "episode-1") await firstBlocked;
				else secondEntered();
			}),
			update: vi.fn(async () => undefined),
		};
		const adapter = new Mem0Adapter({
			mem0Config: {
				embedder: { provider: "test", config: {} },
				vectorStore: { provider: "test", config: {} },
				llm: { provider: "test", config: {} },
			},
			memoryFactory: async () => client,
		});

		const first = adapter.episode.store(episode("episode-1"));
		const second = adapter.episode.store(episode("episode-2"));
		await secondStarted;
		releaseFirst();
		await Promise.all([first, second]);
		expect(client.add).toHaveBeenCalledTimes(2);
	});
});
