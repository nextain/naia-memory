import { describe, expect, it } from "vitest";
import {
	buildScaleCorpus,
	normalizeForContamination,
} from "./hnsw-scale-corpus.js";

describe("HNSW scale corpus", () => {
	it("builds an exact-size deterministic and unique corpus", () => {
		const options = {
			language: "ko",
			baseFacts: [{ id: "F1", statement: "사용자는 봄에 제주도를 방문했다." }],
			referenceTexts: ["봄 여행지는 어디인가?"],
			targetSize: 10_000,
		};
		const first = buildScaleCorpus(options);
		const second = buildScaleCorpus(options);
		expect(first.facts).toHaveLength(10_000);
		expect(first.receipt).toEqual(second.receipt);
		expect(first.receipt.uniqueIds).toBe(10_000);
		expect(first.receipt.uniqueStatements).toBe(10_000);
		expect(first.receipt.baseDuplicateStatements).toBe(0);
		expect(first.receipt.generatedStatementCollisions).toBe(0);
		expect(first.receipt.exactReferenceCollisions).toBe(0);
		expect(first.receipt.referenceSubstringCollisions).toBe(0);
	});

	it("normalizes punctuation, width, case, and whitespace", () => {
		expect(normalizeForContamination(" Ａ-B C! ")).toBe("abc");
	});

	it("records pre-existing duplicate base statements separately", () => {
		const result = buildScaleCorpus({
			language: "en-translated",
			baseFacts: [
				{ id: "F1", statement: "Alpha beta" },
				{ id: "F2", statement: "alpha, beta!" },
			],
			referenceTexts: [],
			targetSize: 2,
		});
		expect(result.receipt.baseDuplicateStatements).toBe(1);
		expect(result.receipt.generatedStatementCollisions).toBe(0);
	});
});
