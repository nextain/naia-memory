import { describe, expect, it, vi } from "vitest";
import {
	Mem0SemanticBridge,
	bindMem0EmbeddingFetch,
	type Mem0SemanticClient,
} from "./bridge-mem0-semantic.js";

describe("Mem0 semantic bridge", () => {
	it("binds route evidence to the native OpenAI embedding transport", () => {
		const originalFetch = vi.fn<typeof fetch>();
		const evidenceFetch = vi.fn<typeof fetch>();
		const client = { embedder: { openai: { fetch: originalFetch } } };

		bindMem0EmbeddingFetch(client, evidenceFetch);

		expect(client.embedder.openai.fetch).toBe(evidenceFetch);
	});

	it("fails closed when the native embedding transport shape drifts", () => {
		expect(() =>
			bindMem0EmbeddingFetch({ embedder: {} }, vi.fn<typeof fetch>()),
		).toThrow("embedding transport is unavailable for route evidence");
	});

	it("uses native inference without leaking benchmark labels", async () => {
		const add = vi.fn(async () => ({
			results: [{ metadata: { event: "ADD" } }],
		}));
		const client: Mem0SemanticClient = {
			add,
			search: vi.fn(async () => ({
				results: [{ id: "mem0-2", memory: "User lives in Busan" }],
			})),
			getAll: vi.fn(async () => ({
				results: [{ id: "mem0-2", memory: "User lives in Busan" }],
			})),
			deleteAll: vi.fn(async () => ({})),
		};
		const bridge = new Mem0SemanticBridge(client, "isolated-user");

		expect(
			await bridge.ingestTurn({
				content: "I moved to Busan.",
			}),
		).toEqual({ outcome: "native-operations", nativeOperationCount: 1 });

		expect(add).toHaveBeenCalledWith(
			[{ role: "user", content: "I moved to Busan." }],
			{ userId: "isolated-user", infer: true },
		);
		expect(JSON.stringify(add.mock.calls)).not.toContain("benchmark");
		expect(await bridge.search("Where do I live?", 3)).toEqual([
			{ nativeId: "mem0-2", content: "User lives in Busan" },
		]);
	});

	it("deletes only its isolated user state during cleanup", async () => {
		const deleteAll = vi.fn(async () => ({}));
		const client: Mem0SemanticClient = {
			add: vi.fn(async () => ({ results: [] })),
			search: vi.fn(async () => ({ results: [] })),
			getAll: vi.fn(async () => ({ results: [] })),
			deleteAll,
		};
		const bridge = new Mem0SemanticBridge(client, "isolated-user");
		await bridge.close();
		expect(deleteAll).toHaveBeenCalledWith({ userId: "isolated-user" });
	});
});
