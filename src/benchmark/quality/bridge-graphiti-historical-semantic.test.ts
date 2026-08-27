import { describe, expect, it, vi } from "vitest";
import {
	GraphitiHistoricalSemanticBridge,
	type GraphitiHistoricalSemanticClient,
} from "./bridge-graphiti-historical-semantic.js";

function client(): GraphitiHistoricalSemanticClient {
	return {
		addEpisode: vi.fn(async () => undefined),
		hasEpisode: vi.fn(async () => true),
		searchCurrentFacts: vi.fn(async () => []),
		searchFactsRaw: vi.fn(async () => [
			{ uuid: "edge-old", fact: "사용자는 서울에 산다" },
		]),
		listCurrentFacts: vi.fn(async () => [
			{ uuid: "edge-new", fact: "사용자는 부산에 산다" },
		]),
		listHistoricalFacts: vi.fn(async () => [
			{ uuid: "edge-old", fact: "사용자는 서울에 산다" },
			{ uuid: "edge-new", fact: "사용자는 부산에 산다" },
		]),
		deleteGroup: vi.fn(async () => undefined),
	};
}

describe("GraphitiHistoricalSemanticBridge", () => {
	it("keeps raw historical search and complete history independently sourced", async () => {
		const graphiti = client();
		const bridge = new GraphitiHistoricalSemanticBridge(graphiti, "case-ko");
		await expect(bridge.search("과거에는 어디에 살았나?", 2)).resolves.toEqual([
			{ nativeId: "edge-old", content: "사용자는 서울에 산다" },
		]);
		await expect(bridge.getNativeState()).resolves.toHaveLength(2);
		expect(graphiti.searchFactsRaw).toHaveBeenCalledOnce();
		expect(graphiti.listHistoricalFacts).toHaveBeenCalledWith("case-ko");
		expect(graphiti.listCurrentFacts).not.toHaveBeenCalled();
		expect(bridge.retrievalSurface).toBe("engine-native-historical-search-v1");
	});

	it("waits until asynchronous episode ingestion commits", async () => {
		const graphiti = client();
		vi.mocked(graphiti.hasEpisode)
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true);
		const wait = vi.fn(async () => undefined);
		const bridge = new GraphitiHistoricalSemanticBridge(graphiti, "case-ko", {
			pollIntervalMs: 1,
			ingestionTimeoutMs: 100,
			wait,
		});

		await expect(
			bridge.ingestTurn({ content: "나는 서울에 산다" }),
		).resolves.toEqual({
			outcome: "opaque",
		});
		expect(graphiti.hasEpisode).toHaveBeenCalledTimes(2);
		expect(wait).toHaveBeenCalledWith(1);
	});
});
