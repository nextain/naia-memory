import { describe, expect, it, vi } from "vitest";
import {
	Mem0SemanticBridge,
	type Mem0SemanticClient,
} from "./bridge-mem0-semantic.js";

describe("Mem0 semantic bridge", () => {
	it("uses native inference without leaking benchmark labels", async () => {
		const add = vi.fn(async () => ({}));
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

		await bridge.ingestTurn({
			content: "I moved to Busan.",
		});

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
			add: vi.fn(async () => ({})),
			search: vi.fn(async () => ({ results: [] })),
			getAll: vi.fn(async () => ({ results: [] })),
			deleteAll,
		};
		const bridge = new Mem0SemanticBridge(client, "isolated-user");
		await bridge.close();
		expect(deleteAll).toHaveBeenCalledWith({ userId: "isolated-user" });
	});
});
