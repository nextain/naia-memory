import { describe, expect, it, vi } from "vitest";
import {
	LettaSemanticBridge,
	type LettaSemanticClient,
} from "./bridge-letta-semantic.js";

describe("Letta semantic bridge", () => {
	it("uses agent-managed updates and exposes the native user-memory block", async () => {
		const sendUserMessage = vi.fn(async () => 1);
		const client: LettaSemanticClient = {
			createAgent: vi.fn(async () => ({ id: "unused" })),
			sendUserMessage,
			listMemoryBlocks: vi.fn(async () => [
				{ id: "block-persona", label: "persona", value: "Agent policy" },
				{ id: "block-human", label: "human", value: "User lives in Busan" },
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
		]);
		expect(await bridge.getNativeState()).toEqual([
			{ nativeId: "block-human", content: "User lives in Busan" },
		]);
	});

	it("deletes only its isolated agent during cleanup", async () => {
		const deleteAgent = vi.fn(async () => undefined);
		const client: LettaSemanticClient = {
			createAgent: vi.fn(async () => ({ id: "unused" })),
			sendUserMessage: vi.fn(async () => 0),
			listMemoryBlocks: vi.fn(async () => []),
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
			deleteAgent: vi.fn(async () => undefined),
		};
		const bridge = new LettaSemanticBridge(client, "agent-isolated");

		expect(await bridge.search("What should be forgotten?", 3)).toEqual([]);
		expect(await bridge.getNativeState()).toEqual([]);
	});
});
