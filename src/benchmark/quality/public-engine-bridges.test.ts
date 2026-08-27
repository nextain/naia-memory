import { rm } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type { MemoryAdapter } from "../../memory/types.js";
import {
	type Mem0PublicClient,
	Mem0PublicEngineBridge,
} from "./bridge-mem0.js";
import {
	NaiaLocalPublicEngineBridge,
	createNaiaLocalPublicEngineBridge,
} from "./bridge-naia-local.js";

describe("public engine bridges", () => {
	it("constructs a real isolated Naia LocalAdapter", async () => {
		const storePath = `/tmp/naia-public-bridge-${crypto.randomUUID()}.json`;
		try {
			const bridge = await createNaiaLocalPublicEngineBridge({ storePath });
			await bridge.addMemory({
				id: "current",
				content: "현재 주소는 서울이다",
			});
			expect(await bridge.searchIds("현재 주소", 1)).toEqual(["current"]);
			await bridge.close();
		} finally {
			await rm(storePath, { force: true });
		}
	});

	it("round-trips dataset IDs through Naia fact IDs", async () => {
		const upsert = vi.fn();
		const search = vi
			.fn()
			.mockResolvedValue([{ id: "current", content: "현재" }]);
		const close = vi.fn();
		const adapter = {
			semantic: { upsert, search },
		} as unknown as MemoryAdapter;
		const bridge = new NaiaLocalPublicEngineBridge(adapter, close);

		await bridge.addMemory({
			id: "current",
			content: "현재",
			date: "2026-01-02",
		});
		expect(await bridge.searchIds("지금", 1)).toEqual(["current"]);
		expect(upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "current",
				content: "현재",
				createdAt: Date.parse("2026-01-02"),
			}),
		);
		expect(search).toHaveBeenCalledWith("지금", 1, true, {
			project: "public-benchmark",
		});
		await bridge.close();
		expect(close).toHaveBeenCalledOnce();
	});

	it("round-trips dataset IDs through mem0 native metadata without inference", async () => {
		const add = vi.fn();
		const search = vi.fn().mockResolvedValue({
			results: [{ metadata: { publicBenchmarkMemoryId: "current" } }],
		});
		const deleteAll = vi.fn();
		const bridge = new Mem0PublicEngineBridge(
			{ add, search, deleteAll } as Mem0PublicClient,
			"sealed-case",
		);

		await bridge.addMemory({
			id: "current",
			content: "현재",
			date: "2026-01-02",
		});
		expect(add).toHaveBeenCalledWith([{ role: "user", content: "현재" }], {
			userId: "sealed-case",
			infer: false,
			metadata: {
				publicBenchmarkMemoryId: "current",
				publicBenchmarkDate: "2026-01-02",
			},
		});
		expect(await bridge.searchIds("지금", 1)).toEqual(["current"]);
		await bridge.close();
		expect(deleteAll).toHaveBeenCalledWith({ userId: "sealed-case" });
	});

	it("fails closed when mem0 drops dataset identity metadata", async () => {
		const client: Mem0PublicClient = {
			add: vi.fn(),
			search: vi.fn().mockResolvedValue({ results: [{ metadata: {} }] }),
			deleteAll: vi.fn(),
		};
		const bridge = new Mem0PublicEngineBridge(client, "sealed-case");
		await expect(bridge.searchIds("지금", 1)).rejects.toThrow(
			"did not preserve the dataset memory ID",
		);
	});
});
