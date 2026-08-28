import { describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider } from "../../memory/embeddings.js";
import { PlainVectorSemanticBridge } from "./bridge-plain-vector-semantic.js";

function provider(vectors: Record<string, number[]>): EmbeddingProvider {
	return {
		name: "fixture",
		dims: 2,
		embeddingSpaceId: "fixture:v1",
		embed: async (text) => vectors[text],
		embedBatch: async (texts) => texts.map((text) => vectors[text]),
	};
}

describe("plain-vector semantic bridge", () => {
	it("stores immutable turns and ranks them by cosine similarity", async () => {
		const bridge = new PlainVectorSemanticBridge(
			provider({ first: [1, 0], second: [0, 1], query: [0.9, 0.1] }),
		);
		await bridge.ingestTurn({ content: "first" });
		await bridge.ingestTurn({ content: "second" });
		expect(await bridge.search("query", 1)).toEqual([
			{ nativeId: "turn-000001", content: "first" },
		]);
		expect(await bridge.getNativeState()).toHaveLength(2);
		expect(bridge.retrievalSurface).toBe(
			"baseline-immutable-turn-vector-search-v1",
		);
	});

	it("breaks equal cosine scores by stable native id", async () => {
		const bridge = new PlainVectorSemanticBridge(
			provider({ first: [1, 0], second: [1, 0], query: [1, 0] }),
		);
		await bridge.ingestTurn({ content: "first" });
		await bridge.ingestTurn({ content: "second" });
		const expected = [
			{ nativeId: "turn-000001", content: "first" },
			{ nativeId: "turn-000002", content: "second" },
		];
		expect(await bridge.search("query", 2)).toEqual(expected);
		expect(await bridge.search("query", 2)).toEqual(expected);
	});

	it("does not depend on the host locale when breaking score ties", async () => {
		const localeCompare = vi
			.spyOn(String.prototype, "localeCompare")
			.mockImplementation(() => {
				throw new Error("locale-dependent comparison must not be used");
			});
		try {
			const bridge = new PlainVectorSemanticBridge(
				provider({ first: [1, 0], second: [1, 0], query: [1, 0] }),
			);
			await bridge.ingestTurn({ content: "first" });
			await bridge.ingestTurn({ content: "second" });
			expect(await bridge.search("query", 2)).toEqual([
				{ nativeId: "turn-000001", content: "first" },
				{ nativeId: "turn-000002", content: "second" },
			]);
		} finally {
			localeCompare.mockRestore();
		}
	});

	it("ranks finite extreme vectors without cosine overflow", async () => {
		const bridge = new PlainVectorSemanticBridge(
			provider({
				aligned: [Number.MAX_VALUE, Number.MAX_VALUE],
				orthogonal: [Number.MAX_VALUE, -Number.MAX_VALUE],
				query: [Number.MAX_VALUE, Number.MAX_VALUE],
			}),
		);
		await bridge.ingestTurn({ content: "orthogonal" });
		await bridge.ingestTurn({ content: "aligned" });
		expect(await bridge.search("query", 1)).toEqual([
			{ nativeId: "turn-000002", content: "aligned" },
		]);
	});

	it("rejects invalid passage vectors before mutating state", async () => {
		const bridge = new PlainVectorSemanticBridge(
			provider({ bad: [1], zero: [0, 0], nan: [Number.NaN, 1] }),
		);
		await expect(bridge.ingestTurn({ content: "bad" })).rejects.toThrow(
			"invalid dimensions",
		);
		await expect(bridge.ingestTurn({ content: "zero" })).rejects.toThrow(
			"non-zero norm",
		);
		await expect(bridge.ingestTurn({ content: "nan" })).rejects.toThrow(
			"non-finite",
		);
		expect(await bridge.getNativeState()).toEqual([]);
	});

	it("requires exactly one embedding for each ingested turn", async () => {
		for (const embeddings of [
			[],
			[
				[1, 0],
				[0, 1],
			],
		]) {
			const bridge = new PlainVectorSemanticBridge({
				...provider({}),
				embedBatch: async () => embeddings,
			});
			await expect(bridge.ingestTurn({ content: "turn" })).rejects.toThrow(
				"must contain one vector",
			);
			expect(await bridge.getNativeState()).toEqual([]);
		}
	});

	it("rejects invalid queries even with empty state and clears case state", async () => {
		const bridge = new PlainVectorSemanticBridge(
			provider({
				valid: [1, 0],
				zero: [0, 0],
				infinite: [Number.POSITIVE_INFINITY, 1],
			}),
		);
		await expect(bridge.search("zero", 1)).rejects.toThrow("non-zero norm");
		await bridge.ingestTurn({ content: "valid" });
		await expect(bridge.search("infinite", 1)).rejects.toThrow("non-finite");
		await bridge.close();
		expect(await bridge.getNativeState()).toEqual([]);
	});
});
