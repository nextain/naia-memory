import { describe, expect, it } from "vitest";
import { parseQrelsTsv, parseTopicsTsv } from "./public-miracl-source.js";

describe("MIRACL native source parsing", () => {
	it("preserves native topic text and rejects duplicate ids", () => {
		expect(parseTopicsTsv("1\t한국어 질문\n2\tsecond query")).toEqual(
			new Map([
				["1", "한국어 질문"],
				["2", "second query"],
			]),
		);
		expect(() => parseTopicsTsv("1\ta\n1\tb")).toThrow(/duplicate/);
	});

	it("retains only positive judgments and canonicalizes document ids", () => {
		expect(parseQrelsTsv("1 0 d2 1\n1 0 d1 2\n1 0 d1 1\n2 0 d3 0")).toEqual(
			new Map([["1", ["d1", "d2"]]]),
		);
	});
});
