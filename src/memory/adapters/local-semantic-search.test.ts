import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgeGraph, emptyKGState } from "../knowledge-graph.js";
import type { Fact } from "../types.js";
import { searchLocalSemanticMemory } from "./local-semantic-search.js";

const originalSearchMode = process.env.NAIA_SEARCH_MODE;

afterEach(() => {
	if (originalSearchMode === undefined)
		Reflect.deleteProperty(process.env, "NAIA_SEARCH_MODE");
	else process.env.NAIA_SEARCH_MODE = originalSearchMode;
});

function fact(id: string, content: string): Fact {
	return {
		id,
		content,
		entities: [],
		topics: [],
		importance: 0.5,
		maxEmotion: 0.5,
		strength: 0.5,
		status: "active",
		createdAt: 1,
		updatedAt: 1,
		lastAccessed: 1,
		recallCount: 0,
		validFrom: 1,
		validTo: null,
		sourceEpisodes: [],
		encodingContext: {},
	};
}

describe("local semantic search modes", () => {
	it("runs BM25-only without invoking the embedding provider", async () => {
		process.env.NAIA_SEARCH_MODE = "bm25-only";
		const facts = [
			fact("relevant", "제주도 감귤 생산과 농업"),
			fact("other-a", "서울 지하철 노선 안내"),
			fact("other-b", "양자 컴퓨팅 연구"),
		];
		const embedWithCache = vi.fn(async () => [1, 0]);

		const result = await searchLocalSemanticMemory(
			{
				facts,
				factEmbeddings: undefined,
				embedder: null,
				disableKGSpreading: true,
				kg: new KnowledgeGraph(emptyKGState()),
				reranker: null,
				embedWithCache,
				factsInTimeRange: () => facts,
				factsValidAtTime: () => facts,
				getEpochs: () => [],
				markDirty: () => {},
				save: () => {},
			},
			"제주도 감귤",
			1,
			true,
		);

		expect(result.map(({ id }) => id)).toEqual(["relevant"]);
		expect(embedWithCache).not.toHaveBeenCalled();
	});

	it("rejects unknown search modes instead of silently changing semantics", async () => {
		process.env.NAIA_SEARCH_MODE = "typo";
		await expect(
			searchLocalSemanticMemory(
				{
					facts: [],
					factEmbeddings: undefined,
					embedder: null,
					disableKGSpreading: true,
					kg: new KnowledgeGraph(emptyKGState()),
					reranker: null,
					embedWithCache: async () => null,
					factsInTimeRange: () => [],
					factsValidAtTime: () => [],
					getEpochs: () => [],
					markDirty: () => {},
					save: () => {},
				},
				"query",
				1,
			),
		).rejects.toThrow("unsupported NAIA_SEARCH_MODE: typo");
	});
});
