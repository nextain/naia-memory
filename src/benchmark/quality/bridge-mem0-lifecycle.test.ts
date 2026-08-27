import { describe, expect, it, vi } from "vitest";
import {
	Mem0LifecycleBridge,
	type Mem0LifecycleClient,
} from "./bridge-mem0-lifecycle.js";

describe("Mem0 lifecycle bridge", () => {
	it("maps replacement onto mem0's native update and removes stale logical IDs", async () => {
		const memories = new Map<string, string>();
		let nextId = 0;
		const client: Mem0LifecycleClient = {
			add: vi.fn(async (_messages, options) => {
				const id = `native-${++nextId}`;
				memories.set(id, _messages[0]?.content ?? "");
				expect(options.infer).toBe(false);
				return { results: [{ id }] };
			}),
			update: vi.fn(async (id, content) => {
				memories.set(id, content);
			}),
			delete: vi.fn(async (id) => {
				memories.delete(id);
			}),
			getAll: vi.fn(async () => ({
				results: [...memories].map(([id, memory]) => ({ id, memory })),
			})),
			deleteAll: vi.fn(async () => memories.clear()),
		};
		const bridge = new Mem0LifecycleBridge(client, "case-1");
		await bridge.apply({
			op: "add",
			logicalId: "v1",
			content: "서울",
			at: "2026-01-01T00:00:01Z",
		});
		await bridge.apply({
			op: "replace",
			logicalId: "v2",
			replacesLogicalId: "v1",
			content: "부산",
			at: "2026-01-01T00:00:02Z",
		});
		expect(await bridge.getActiveState()).toEqual([
			{ logicalId: "v2", content: "부산" },
		]);
		expect(client.update).toHaveBeenCalledWith("native-1", "부산");
		await bridge.apply({
			op: "delete",
			logicalId: "v2",
			at: "2026-01-01T00:00:03Z",
		});
		expect(await bridge.getActiveState()).toEqual([]);
		await bridge.close();
		expect(client.deleteAll).toHaveBeenCalledWith({ userId: "case-1" });
	});

	it("fails closed when mem0 does not return one native ID", async () => {
		const client = {
			add: vi.fn(async () => ({ results: [] })),
		} as unknown as Mem0LifecycleClient;
		const bridge = new Mem0LifecycleBridge(client, "case-2");
		await expect(
			bridge.apply({
				op: "add",
				logicalId: "v1",
				content: "서울",
				at: "2026-01-01T00:00:01Z",
			}),
		).rejects.toThrow("exactly one native memory ID");
	});

	it("rejects duplicate logical IDs before mutating mem0", async () => {
		const client = {
			add: vi.fn(async () => ({ results: [{ id: "native-1" }] })),
		} as unknown as Mem0LifecycleClient;
		const bridge = new Mem0LifecycleBridge(client, "case-3");
		const add = {
			op: "add" as const,
			logicalId: "v1",
			content: "서울",
			at: "2026-01-01T00:00:01Z",
		};
		await bridge.apply(add);
		await expect(bridge.apply(add)).rejects.toThrow(
			"logical memory ID is already active",
		);
		expect(client.add).toHaveBeenCalledTimes(1);
	});
});
