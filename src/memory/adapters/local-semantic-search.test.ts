import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgeGraph, emptyKGState } from "../knowledge-graph.js";
import type { Fact } from "../types.js";
import { searchLocalSemanticMemory } from "./local-semantic-search.js";

const originalSearchMode = process.env.NAIA_SEARCH_MODE;
const originalMmr = process.env.NAIA_MMR;

afterEach(() => {
	if (originalSearchMode === undefined)
		Reflect.deleteProperty(process.env, "NAIA_SEARCH_MODE");
	else process.env.NAIA_SEARCH_MODE = originalSearchMode;
	if (originalMmr === undefined)
		Reflect.deleteProperty(process.env, "NAIA_MMR");
	else process.env.NAIA_MMR = originalMmr;
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

function host(facts: Fact[], factEmbeddings: Record<string, number[]>) {
	return {
		facts,
		factEmbeddings,
		embedder: null,
		disableKGSpreading: true,
		kg: new KnowledgeGraph(emptyKGState()),
		reranker: null,
		embedWithCache: async () => [1, 0],
		factsInTimeRange: () => facts,
		factsValidAtTime: () => facts,
		getEpochs: () => [],
		markDirty: () => {},
		save: () => {},
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

	it.each<
		[
			string,
			{
				deepRecall?: boolean;
				mmr?: string;
				context?: Parameters<typeof searchLocalSemanticMemory>[4] & {
					queryIntent?: string;
				};
			},
		]
	>([
		["deepRecall", { deepRecall: false }],
		["MMR", { mmr: "on" }],
		["confidence", { context: { minConfidence: 0.1 } }],
		["intent", { context: { queryIntent: "work" } }],
		["lifecycle mode", { context: { mode: "history" as const } }],
	])(
		"fails closed for an incompatible %s condition",
		async (_name, options) => {
			process.env.NAIA_SEARCH_MODE = "vector-head-rrf-tail";
			process.env.NAIA_MMR = options.mmr ?? "off";
			await expect(
				searchLocalSemanticMemory(
					host([], {}),
					"query",
					100,
					options.deepRecall ?? true,
					options.context,
				),
			).rejects.toThrow("vector-head-rrf-tail requires deepRecall");
		},
	);

	it("fails closed when a reranker is configured", async () => {
		process.env.NAIA_SEARCH_MODE = "vector-head-rrf-tail";
		process.env.NAIA_MMR = "off";
		const configuredHost = host([], {});
		configuredHost.reranker = { rerank: vi.fn() } as never;
		await expect(
			searchLocalSemanticMemory(configuredHost, "query", 100, true),
		).rejects.toThrow("vector-head-rrf-tail requires deepRecall");
	});

	it("preserves the vector-ranked top ten in vector-head/RRF-tail mode", async () => {
		process.env.NAIA_SEARCH_MODE = "vector-head-rrf-tail";
		process.env.NAIA_MMR = "off";
		const facts = Array.from({ length: 12 }, (_, index) =>
			fact(
				`fact-${index}`,
				index === 11 ? "needle needle needle" : `문서 ${index}`,
			),
		);
		const factEmbeddings = Object.fromEntries(
			facts.map(({ id }, index) => [id, [1, index * 0.1]]),
		);

		process.env.NAIA_SEARCH_MODE = "vector-only";
		const vectorOnly = await searchLocalSemanticMemory(
			host(facts, factEmbeddings),
			"needle",
			12,
			true,
		);
		process.env.NAIA_SEARCH_MODE = "vector-head-rrf-tail";
		const result = await searchLocalSemanticMemory(
			host(facts, factEmbeddings),
			"needle",
			12,
			true,
		);

		expect(result.slice(0, 10).map(({ id }) => id)).toEqual(
			vectorOnly.slice(0, 10).map(({ id }) => id),
		);
		expect(result.slice(10).map(({ id }) => id)).toEqual([
			"fact-11",
			"fact-10",
		]);
		expect(new Set(result.map(({ id }) => id))).toHaveLength(12);
	});

	it("uses the same stable tie order as vector-only in the protected head", async () => {
		process.env.NAIA_MMR = "off";
		const facts = Array.from({ length: 12 }, (_, index) =>
			fact(`tie-${index}`, index === 11 ? "needle" : `문서 ${index}`),
		);
		const factEmbeddings = Object.fromEntries(
			facts.map(({ id }) => [id, [1, 0]]),
		);
		process.env.NAIA_SEARCH_MODE = "vector-only";
		const vectorOnly = await searchLocalSemanticMemory(
			host(facts, factEmbeddings),
			"needle",
			12,
			true,
		);
		process.env.NAIA_SEARCH_MODE = "vector-head-rrf-tail";
		const composite = await searchLocalSemanticMemory(
			host(facts, factEmbeddings),
			"needle",
			12,
			true,
		);
		expect(composite.slice(0, 10).map(({ id }) => id)).toEqual(
			vectorOnly.slice(0, 10).map(({ id }) => id),
		);
	});
});
