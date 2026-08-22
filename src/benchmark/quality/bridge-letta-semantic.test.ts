import { afterEach, describe, expect, it, vi } from "vitest";
import {
	LettaSemanticBridge,
	type LettaSemanticClient,
	createLettaSemanticBridge,
} from "./bridge-letta-semantic.js";

describe("Letta semantic bridge", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("uses agent-managed updates and exposes the native user-memory block", async () => {
		const sendUserMessage = vi.fn(async () => 1);
		const client: LettaSemanticClient = {
			createAgent: vi.fn(async () => ({ id: "unused" })),
			sendUserMessage,
			listMemoryBlocks: vi.fn(async () => [
				{ id: "block-persona", label: "persona", value: "Agent policy" },
				{ id: "block-human", label: "human", value: "User lives in Busan" },
			]),
			searchArchivalMemory: vi.fn(async () => [
				{ id: "passage-busan", content: "Busan is near the sea" },
			]),
			listArchivalMemory: vi.fn(async () => [
				{ id: "passage-busan", content: "Busan is near the sea" },
			]),
			deleteAgent: vi.fn(async () => undefined),
		};
		const bridge = new LettaSemanticBridge(client, "agent-isolated");

		expect(await bridge.ingestTurn({ content: "I moved to Busan." })).toEqual({
			outcome: "native-operations",
			nativeOperationCount: 1,
		});
		expect(sendUserMessage).toHaveBeenCalledWith(
			"agent-isolated",
			"I moved to Busan.",
		);
		expect(JSON.stringify(sendUserMessage.mock.calls)).not.toContain(
			"benchmark",
		);
		expect(await bridge.search("Where do I live?", 3)).toEqual([
			{ nativeId: "block-human", content: "User lives in Busan" },
			{ nativeId: "passage-busan", content: "Busan is near the sea" },
		]);
		expect(await bridge.getNativeState()).toEqual([
			{ nativeId: "block-human", content: "User lives in Busan" },
			{ nativeId: "passage-busan", content: "Busan is near the sea" },
		]);
		expect(client.searchArchivalMemory).toHaveBeenCalledWith(
			"agent-isolated",
			"Where do I live?",
			2,
		);
	});

	it("keeps always-active core state first and does not over-fetch archival results", async () => {
		const searchArchivalMemory = vi.fn(async () => [
			{ id: "passage-ignored", content: "Should not be fetched" },
		]);
		const client: LettaSemanticClient = {
			createAgent: vi.fn(async () => ({ id: "unused" })),
			sendUserMessage: vi.fn(async () => 0),
			listMemoryBlocks: vi.fn(async () => [
				{ id: "block-human", label: "human", value: "Always active" },
			]),
			searchArchivalMemory,
			listArchivalMemory: vi.fn(async () => []),
			deleteAgent: vi.fn(async () => undefined),
		};

		expect(
			await new LettaSemanticBridge(client, "agent-isolated").search(
				"query",
				1,
			),
		).toEqual([{ nativeId: "block-human", content: "Always active" }]);
		expect(searchArchivalMemory).not.toHaveBeenCalled();
	});

	it("deletes only its isolated agent during cleanup", async () => {
		const deleteAgent = vi.fn(async () => undefined);
		const client: LettaSemanticClient = {
			createAgent: vi.fn(async () => ({ id: "unused" })),
			sendUserMessage: vi.fn(async () => 0),
			listMemoryBlocks: vi.fn(async () => []),
			searchArchivalMemory: vi.fn(async () => []),
			listArchivalMemory: vi.fn(async () => []),
			deleteAgent,
		};
		await new LettaSemanticBridge(client, "agent-isolated").close();
		expect(deleteAgent).toHaveBeenCalledWith("agent-isolated");
	});

	it("represents a cleared native user block as empty memory state", async () => {
		const client: LettaSemanticClient = {
			createAgent: vi.fn(async () => ({ id: "unused" })),
			sendUserMessage: vi.fn(async () => 1),
			listMemoryBlocks: vi.fn(async () => [
				{ id: "block-persona", label: "persona", value: "Agent policy" },
				{ id: "block-human", label: "human", value: "   " },
			]),
			searchArchivalMemory: vi.fn(async () => []),
			listArchivalMemory: vi.fn(async () => []),
			deleteAgent: vi.fn(async () => undefined),
		};
		const bridge = new LettaSemanticBridge(client, "agent-isolated");

		expect(await bridge.search("What should be forgotten?", 3)).toEqual([]);
		expect(await bridge.getNativeState()).toEqual([]);
	});

	it("uses the version-pinned Letta archival search REST surface", async () => {
		const requests: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string | URL | Request) => {
				const url = String(input);
				requests.push(url);
				if (url.endsWith("/v1/agents/"))
					return Response.json({ id: "agent-rest" });
				if (url.endsWith("/core-memory/blocks"))
					return Response.json([
						{ id: "block-human", label: "human", value: "Always active" },
					]);
				if (url.includes("/archival-memory/search?"))
					return Response.json({
						results: [{ id: "passage-native", content: "Native result" }],
						count: 1,
					});
				throw new Error(`unexpected Letta request: ${url}`);
			}),
		);

		const bridge = await createLettaSemanticBridge({
			baseUrl: "http://letta.test",
			model: "test-model",
			embeddingModel: "test-embedding",
			embeddingDimensions: 3,
		});
		expect(await bridge.search("where now?", 2)).toEqual([
			{ nativeId: "block-human", content: "Always active" },
			{ nativeId: "passage-native", content: "Native result" },
		]);
		expect(requests.at(-1)).toBe(
			"http://letta.test/v1/agents/agent-rest/archival-memory/search?query=where+now%3F&top_k=1",
		);
	});

	it("fails closed on a blank archival identity from Letta REST", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string | URL | Request) => {
				const url = String(input);
				if (url.endsWith("/v1/agents/"))
					return Response.json({ id: "agent-rest" });
				if (url.endsWith("/core-memory/blocks")) return Response.json([]);
				if (url.includes("/archival-memory/search?"))
					return Response.json({
						results: [{ id: " ", content: "Invalid identity" }],
						count: 1,
					});
				throw new Error(`unexpected Letta request: ${url}`);
			}),
		);

		const bridge = await createLettaSemanticBridge({
			baseUrl: "http://letta.test",
			model: "test-model",
			embeddingModel: "test-embedding",
			embeddingDimensions: 3,
		});
		await expect(bridge.search("query", 1)).rejects.toThrow(
			"Letta returned a malformed archival search result",
		);
	});
});
