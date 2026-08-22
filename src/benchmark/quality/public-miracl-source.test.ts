import { describe, expect, it } from "vitest";
import {
	parseQrelsTsv,
	parseTopicsTsv,
	parseTrecRun,
	validateTrecRunCoverage,
} from "./public-miracl-source.js";

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
		expect(
			parseQrelsTsv("1\tQ0\td2\t1\n1\tQ0\td1\t2\n1\tQ0\td1\t1\n2\tQ0\td3\t0"),
		).toEqual(new Map([["1", ["d1", "d2"]]]));
		expect(() => parseQrelsTsv("1 Q0 d2 1")).toThrow(/invalid/);
	});
});

describe("TREC run parsing", () => {
	it("preserves validated rank order", () => {
		expect(parseTrecRun("q1 Q0 d2 1 2.0 tag\nq1 Q0 d1 2 1.0 tag\n")).toEqual(
			new Map([["q1", ["d2", "d1"]]]),
		);
	});

	it("rejects rank gaps and duplicate documents", () => {
		expect(() => parseTrecRun("q Q0 d 2 1 tag")).toThrow(/non-contiguous/);
		expect(() => parseTrecRun("q Q0 d 1 2 tag\nq Q0 d 2 1 tag")).toThrow(
			/duplicate/,
		);
	});

	it("fails closed on missing, extra, or shallow query results", () => {
		const expected = new Set(["q1", "q2"]);
		expect(() =>
			validateTrecRunCoverage(new Map([["q1", ["d1"]]]), expected, 1),
		).toThrow(/missing=1/);
		expect(() =>
			validateTrecRunCoverage(
				new Map([
					["q1", ["d1"]],
					["q2", ["d2"]],
					["q3", ["d3"]],
				]),
				expected,
				1,
			),
		).toThrow(/unexpected=1/);
		expect(() =>
			validateTrecRunCoverage(
				new Map([
					["q1", ["d1"]],
					["q2", ["d2", "d3"]],
				]),
				expected,
				1,
			),
		).toThrow(/wrongDepth=1/);
	});
});
