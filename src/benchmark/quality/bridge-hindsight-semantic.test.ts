import { afterEach, describe, expect, it, vi } from "vitest";
import { HindsightSemanticBridge } from "./bridge-hindsight-semantic.js";

afterEach(() => vi.unstubAllGlobals());

describe("HindsightSemanticBridge", () => {
	it("uses raw turns, native recall/list identity, and deletes isolated state", async () => {
		const requests: Array<{ url: string; init?: RequestInit }> = [];
		vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
			requests.push({ url, init });
			if (url.includes("/stats?"))
				return new Response(
					JSON.stringify({
						pending_operations: 0,
						failed_operations: 0,
						pending_consolidation: 0,
						failed_consolidation: 0,
					}),
				);
			if (url.includes("/recall"))
				return new Response(
					JSON.stringify({
						results: [
							{ id: "current", text: "서울에 산다" },
							{ id: "extra", text: "다른 기억" },
						],
					}),
				);
			if (url.includes("/memories/list"))
				return new Response(
					JSON.stringify({
						items: [
							{ id: "current", text: "서울에 산다" },
							{ id: "extra", text: "다른 기억" },
						],
						total: 2,
					}),
				);
			if (init?.method === "DELETE") return new Response(null, { status: 204 });
			return new Response(JSON.stringify({ success: true, items_count: 1 }));
		});
		const bridge = new HindsightSemanticBridge(
			"http://127.0.0.1:18888/",
			"isolated-bank",
			"secret",
			0,
			1000,
			async () => undefined,
		);

		await expect(
			bridge.ingestTurn({ content: "이제 서울에 살아요" }),
		).resolves.toEqual({
			outcome: "native-operations",
			nativeOperationCount: 1,
		});
		await expect(bridge.search("어디에 살아요?", 1)).resolves.toEqual([
			{ nativeId: "current", content: "서울에 산다" },
		]);
		await expect(bridge.getNativeState()).resolves.toHaveLength(2);
		await bridge.close();

		expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
			async: false,
			items: [{ content: "이제 서울에 살아요" }],
		});
		expect(
			requests.filter((request) => request.url.includes("/stats?")),
		).toHaveLength(2);
		expect(requests.at(-1)?.init?.method).toBe("DELETE");
		expect(requests.every((request) => request.init?.headers)).toBe(true);
	});

	it("fails closed when settled processing reports a failure", async () => {
		vi.stubGlobal("fetch", async (url: string) => {
			if (url.includes("/stats?"))
				return new Response(
					JSON.stringify({
						pending_operations: 0,
						failed_operations: 1,
						pending_consolidation: 0,
						failed_consolidation: 0,
					}),
				);
			return new Response(JSON.stringify({ success: true, items_count: 1 }));
		});
		const bridge = new HindsightSemanticBridge(
			"http://127.0.0.1:18888",
			"bank",
			undefined,
			0,
			1000,
			async () => undefined,
		);
		await expect(bridge.ingestTurn({ content: "기억" })).rejects.toThrow(
			/background processing failed/,
		);
	});

	it("waits through pending work and resets the settled streak after a flap", async () => {
		const pendingSequence = [1, 0, 1, 0, 0];
		let statsReads = 0;
		const waits: number[] = [];
		vi.stubGlobal("fetch", async (url: string) => {
			if (url.includes("/stats?")) {
				const pending = pendingSequence[statsReads++] ?? 0;
				return new Response(
					JSON.stringify({
						pending_operations: pending,
						failed_operations: 0,
						pending_consolidation: 0,
						failed_consolidation: 0,
					}),
				);
			}
			return new Response(JSON.stringify({ success: true, items_count: 1 }));
		});
		const bridge = new HindsightSemanticBridge(
			"http://127.0.0.1:18888",
			"bank",
			undefined,
			25,
			1000,
			async (milliseconds) => {
				waits.push(milliseconds);
			},
		);

		await expect(bridge.ingestTurn({ content: "기억" })).resolves.toEqual({
			outcome: "native-operations",
			nativeOperationCount: 1,
		});
		expect(statsReads).toBe(5);
		expect(waits).toEqual([25, 25, 25, 25]);
	});

	it("fails closed when the settled-state deadline expires", async () => {
		vi.stubGlobal("fetch", async (url: string) => {
			if (url.includes("/stats?"))
				return new Response(
					JSON.stringify({
						pending_operations: 1,
						failed_operations: 0,
						pending_consolidation: 0,
						failed_consolidation: 0,
					}),
				);
			return new Response(JSON.stringify({ success: true, items_count: 1 }));
		});
		const now = vi.spyOn(Date, "now");
		now
			.mockReturnValueOnce(1000)
			.mockReturnValueOnce(1000)
			.mockReturnValue(1011);
		const bridge = new HindsightSemanticBridge(
			"http://127.0.0.1:18888",
			"bank",
			undefined,
			1,
			10,
			async () => undefined,
		);

		await expect(bridge.ingestTurn({ content: "기억" })).rejects.toThrow(
			"Hindsight settled-state wait timed out",
		);
		now.mockRestore();
	});

	it("rejects credential-bearing endpoints", () => {
		expect(
			() => new HindsightSemanticBridge("https://user:pw@example.com", "bank"),
		).toThrow("must not contain credentials");
	});
});
