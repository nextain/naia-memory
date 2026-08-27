import { describe, expect, it, vi } from "vitest";
import { OfflineRerankerProvider } from "../reranker.js";

function providerWithLogits(logits: number[][]) {
	const tokenizer = vi.fn((text: string[], options: { text_pair: string[] }) => ({ text, ...options }));
	const model = vi.fn(async () => ({ logits: { tolist: () => logits.splice(0, 8) } }));
	const provider = new OfflineRerankerProvider();
	(provider as any).pipeline = { tokenizer, model };
	(provider as any).initPromise = Promise.resolve();
	return { provider, tokenizer, model };
}

describe("OfflineRerankerProvider", () => {
	it("scores query-passage pairs in batches and orders by sigmoid relevance", async () => {
		const { provider, tokenizer, model } = providerWithLogits([[0], [2], [-2]]);
		const result = await provider.rerank(
			"current city",
			[{ content: "Seoul" }, { content: "Daejeon" }, { content: "Busan" }],
			3,
		);

		expect(model).toHaveBeenCalledTimes(1);
		expect(tokenizer).toHaveBeenCalledWith(
			["current city", "current city", "current city"],
			expect.objectContaining({ text_pair: ["Seoul", "Daejeon", "Busan"] }),
		);
		expect(result.map((item) => item.content)).toEqual(["Daejeon", "Seoul", "Busan"]);
		expect(result[0].rerankScore).toBeCloseTo(0.881, 3);
	});

	it("limits inference batches to eight candidates", async () => {
		const logits = Array.from({ length: 10 }, (_, index) => [index]);
		const { provider, model } = providerWithLogits(logits);
		await provider.rerank(
			"query",
			Array.from({ length: 10 }, (_, index) => ({ content: `candidate-${index}` })),
			10,
		);

		expect(model).toHaveBeenCalledTimes(2);
	});
});
