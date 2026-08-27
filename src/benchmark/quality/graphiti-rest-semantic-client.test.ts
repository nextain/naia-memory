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
		const request = vi.fn(async () =>
			json({ committed: true, uuid: "native-episode-1" }),
		);
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
		expect(String(url)).toBe("http://127.0.0.1:8000/benchmark/messages");
		const body = JSON.parse(String(init?.body));
		expect(body.group_id).toBe("case-ko");
		expect(body).toMatchObject({
			uuid: "episode-1",
			content: "부산으로 이사했어요",
			name: "turn-1",
			source_description: "benchmark",
		});
		expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
	});

	it("reads runtime identity from the contacted companion", async () => {
		const request = vi.fn(async () =>
			json({
				graphiti_core_version: "0.28.2",
				neo4j_driver_version: "5.28.1",
				provider_adapter_version: "google-genai@1.62.0",
				llm_client_class: "graphiti_core.llm.GeminiClient",
				llm_model: "gemini-2.5-flash",
				embedding_client_class: "graphiti_core.embedder.GeminiEmbedder",
				embedding_provider: "gemini",
				embedding_model: "gemini-embedding-001",
				embedding_dimensions: 3072,
				server_lock_sha256: "a".repeat(64),
				deployed_sidecar_sha256: "b".repeat(64),
			}),
		);
		const client = new GraphitiRestSemanticClient({
			baseUrl: "http://127.0.0.1:8000",
			fetch: request,
		});

		await expect(client.runtimeIdentity()).resolves.toMatchObject({
			graphitiCoreVersion: "0.28.2",
			embeddingProvider: "gemini",
			embeddingDimensions: 3072,
		});
		expect(String(request.mock.calls[0][0])).toContain(
			"benchmark/runtime-identity",
		);
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
				json({
					facts: [
						{ uuid: "edge-old", fact: "라면을 좋아한다" },
						{ uuid: "edge-1", fact: "비빔밥을 좋아한다" },
					],
				}),
			)
			.mockResolvedValueOnce(
				json({ facts: [{ uuid: "edge-1", fact: "비빔밥을 좋아한다" }] }),
			)
			.mockResolvedValueOnce(json({ detail: "bad query" }, 422));
		const client = new GraphitiRestSemanticClient({
			baseUrl: "http://[::1]:8000",
			fetch: request,
		});

		await expect(
			client.searchCurrentFacts({
				query: "무슨 음식을?",
				groupIds: ["g"],
				maxFacts: 3,
			}),
		).resolves.toEqual([{ uuid: "edge-1", fact: "비빔밥을 좋아한다" }]);
		const rawRequest = vi.fn(async () =>
			json({ facts: [{ uuid: "edge-old", fact: "라면을 좋아한다" }] }),
		);
		const rawClient = new GraphitiRestSemanticClient({
			baseUrl: "http://127.0.0.1:8000",
			fetch: rawRequest,
		});
		await expect(
			rawClient.searchFactsRaw({ query: "음식", groupIds: ["g"], maxFacts: 3 }),
		).resolves.toEqual([{ uuid: "edge-old", fact: "라면을 좋아한다" }]);
		await expect(client.deleteGroup("g")).rejects.toThrow(/422/);
	});

	it("loads complete historical identity from a route separate from search", async () => {
		const request = vi.fn(async () =>
			json({ facts: [{ uuid: "edge-old", fact: "서울에 산다" }] }),
		);
		const client = new GraphitiRestSemanticClient({
			baseUrl: "http://127.0.0.1:8000",
			fetch: request,
		});
		await expect(client.listHistoricalFacts("case ko")).resolves.toEqual([
			{ uuid: "edge-old", fact: "서울에 산다" },
		]);
		expect(String(request.mock.calls[0]?.[0])).toContain(
			"benchmark/historical-facts/case%20ko",
		);
	});
});
