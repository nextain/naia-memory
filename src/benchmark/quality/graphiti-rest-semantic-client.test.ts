import { describe, expect, it, vi } from "vitest";
import { GraphitiRestSemanticClient } from "./graphiti-rest-semantic-client.js";

function json(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("GraphitiRestSemanticClient", () => {
	it("refuses the unauthenticated reference service on a remote host", () => {
		expect(
			() =>
				new GraphitiRestSemanticClient({ baseUrl: "https://memory.example" }),
		).toThrow(/loopback-only/);
	});

	it("submits one timestamped user message with native identity", async () => {
		const request = vi.fn(async () => json({ success: true }));
		const client = new GraphitiRestSemanticClient({
			baseUrl: "http://127.0.0.1:8000",
			fetch: request,
		});
		await client.addEpisode({
			uuid: "episode-1",
			groupId: "case-ko",
			content: "부산으로 이사했어요",
			name: "turn-1",
			sourceDescription: "benchmark",
		});

		const [url, init] = request.mock.calls[0];
		expect(String(url)).toBe("http://127.0.0.1:8000/messages");
		const body = JSON.parse(String(init?.body));
		expect(body.group_id).toBe("case-ko");
		expect(body.messages[0]).toMatchObject({
			uuid: "episode-1",
			role_type: "user",
			content: "부산으로 이사했어요",
		});
		expect(Number.isNaN(Date.parse(body.messages[0].timestamp))).toBe(false);
	});

	it("uses companion commit and complete-current-state routes", async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce(json({ committed: true }))
			.mockResolvedValueOnce(
				json({ facts: [{ uuid: "edge-new", fact: "사용자는 부산에 산다" }] }),
			);
		const client = new GraphitiRestSemanticClient({
			baseUrl: "http://localhost:8000/api/",
			fetch: request,
		});

		await expect(
			client.hasEpisode({ uuid: "episode/1", groupId: "case ko" }),
		).resolves.toBe(true);
		await expect(client.listCurrentFacts("case ko")).resolves.toEqual([
			{ uuid: "edge-new", fact: "사용자는 부산에 산다" },
		]);
		expect(String(request.mock.calls[0][0])).toContain(
			"benchmark/episodes/case%20ko/episode%2F1",
		);
	});

	it("preserves native search facts and reports HTTP failures", async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce(
				json({ facts: [{ uuid: "edge-1", fact: "비빔밥을 좋아한다" }] }),
			)
			.mockResolvedValueOnce(json({ detail: "bad query" }, 422));
		const client = new GraphitiRestSemanticClient({
			baseUrl: "http://[::1]:8000",
			fetch: request,
		});

		await expect(
			client.searchFacts({
				query: "무슨 음식을?",
				groupIds: ["g"],
				maxFacts: 3,
			}),
		).resolves.toEqual([{ uuid: "edge-1", fact: "비빔밥을 좋아한다" }]);
		await expect(client.deleteGroup("g")).rejects.toThrow(/422/);
	});
});
