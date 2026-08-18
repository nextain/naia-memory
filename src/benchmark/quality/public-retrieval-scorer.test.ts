import { describe, expect, it } from "vitest";
import {
	publicRetrievalMetricName,
	scorePublicRetrieval,
} from "./public-retrieval-scorer.js";

describe("public retrieval scorer", () => {
	const expectation = { expected: ["current-1"], forbidden: ["stale-1"] };

	it("scores opaque IDs without engine- or language-specific behavior", () => {
		expect(
			scorePublicRetrieval(
				JSON.stringify(["other", "current-1"]),
				expectation,
				2,
			),
		).toEqual({
			score: 1,
			judgment: "expected-id-present-without-forbidden-id",
		});
	});

	it("fails when stale evidence is retrieved even with a current hit", () => {
		expect(
			scorePublicRetrieval(
				JSON.stringify(["current-1", "stale-1"]),
				expectation,
				2,
			),
		).toEqual({
			score: 0,
			judgment: "forbidden-id-retrieved",
		});
	});

	it("honors the frozen top-k boundary", () => {
		expect(
			scorePublicRetrieval(
				JSON.stringify(["other", "current-1"]),
				expectation,
				1,
			),
		).toEqual({
			score: 0,
			judgment: "expected-id-absent",
		});
	});

	it("ignores malformed values outside the frozen top-k window", () => {
		expect(
			scorePublicRetrieval(
				JSON.stringify(["current-1", { injected: true }]),
				expectation,
				1,
			),
		).toEqual({
			score: 1,
			judgment: "expected-id-present-without-forbidden-id",
		});
	});

	it("derives the public metric identity from the same top-k", () => {
		expect(publicRetrievalMetricName(20)).toBe("current-hit@20");
		expect(() => publicRetrievalMetricName(0)).toThrow(
			"topK must be a positive integer",
		);
	});

	it("fails closed for malformed engine output", () => {
		expect(scorePublicRetrieval("not-json", expectation, 5)).toEqual({
			score: 0,
			judgment: "invalid-output-json",
		});
		expect(
			scorePublicRetrieval(
				JSON.stringify({ retrieved: ["current-1"] }),
				expectation,
				5,
			),
		).toEqual({ score: 0, judgment: "invalid-retrieval-id-list" });
	});
});
