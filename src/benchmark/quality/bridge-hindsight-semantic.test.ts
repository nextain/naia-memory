import { afterEach, describe, expect, it, vi } from "vitest";
import { HindsightSemanticBridge } from "./bridge-hindsight-semantic.js";

afterEach(() => vi.unstubAllGlobals());

describe("HindsightSemanticBridge", () => {
	it("uses raw turns, native recall/list identity, and deletes isolated state", async () => {
		const requests: Array<{ url: string; init?: RequestInit }> = [];
		vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
			requests.push({ url, init });
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
		expect(requests.at(-1)?.init?.method).toBe("DELETE");
		expect(requests.every((request) => request.init?.headers)).toBe(true);
	});

	it("rejects credential-bearing endpoints", () => {
		expect(
			() => new HindsightSemanticBridge("https://user:pw@example.com", "bank"),
		).toThrow("must not contain credentials");
	});
});
