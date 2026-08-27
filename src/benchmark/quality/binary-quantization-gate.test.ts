import { describe, expect, it } from "vitest";
import {
	BinaryCandidateIndex,
	exactTopK,
	meanTopKOverlap,
	rerankCandidates,
	summarizeRanked,
} from "./binary-quantization-gate.js";

describe("binary quantization quality gate", () => {
	it("retrieves and reranks binary candidates with stable fact ids", () => {
		const ids = ["F-a", "F-b", "F-c"];
		const vectors = [
			[1, 1, 1, 1, 1, 1, 1, 1],
			[-1, -1, -1, -1, -1, -1, -1, -1],
			[1, -1, 1, -1, 1, -1, 1, -1],
		];
		const query = [0.9, 0.8, 0.9, 0.8, 0.9, 0.8, 0.9, 0.8];
		const index = new BinaryCandidateIndex(ids, vectors, 8);
		const candidates = index.candidates(query, 2);
		expect(candidates).toContain("F-a");
		expect(
			rerankCandidates(
				candidates,
				new Map(ids.map((id, i) => [id, vectors[i]])),
				query,
				1,
			),
		).toEqual(["F-a"]);
		expect(exactTopK(ids, vectors, query, 1)).toEqual(["F-a"]);
		index.close();
	});

	it("reports overlap and gold ranking independently", () => {
		const comparisons = [
			{ goldId: "a", baseline: ["a", "b"], candidate: ["b", "a"] },
			{ goldId: "c", baseline: ["c", "d"], candidate: ["c", "x"] },
		];
		expect(meanTopKOverlap(comparisons)).toBe(0.75);
		expect(summarizeRanked(comparisons, "baseline")).toEqual({
			recall1: 1,
			recall5: 1,
			recall10: 1,
			mrr: 1,
		});
		expect(summarizeRanked(comparisons, "candidate")).toEqual({
			recall1: 0.5,
			recall5: 1,
			recall10: 1,
			mrr: 0.75,
		});
	});
});
