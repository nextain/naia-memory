import { describe, expect, it } from "vitest";
import {
	rankingsAreStable,
	resolveFactId,
	resolveFactIds,
} from "./hnsw-exact-gate.js";

describe("HNSW exact gate labels", () => {
	it("normalizes legacy zero-padded fact references without inventing ids", () => {
		const ids = new Set(["F48", "F049"]);
		expect(resolveFactId("F048", ids)).toBe("F48");
		expect(resolveFactId("F049", ids)).toBe("F049");
		expect(resolveFactId("F050", ids)).toBeNull();
	});

	it("preserves every valid answer for multi-gold queries", () => {
		const ids = new Set(["F048", "F139"]);
		expect(resolveFactIds(["F048", "F139", "F999"], ids)).toEqual([
			"F048",
			"F139",
		]);
	});

	it("rejects nondeterministic approximate rankings across repeats", () => {
		expect(
			rankingsAreStable([
				["F1", "F2"],
				["F1", "F2"],
			]),
		).toBe(true);
		expect(
			rankingsAreStable([
				["F1", "F2"],
				["F2", "F1"],
			]),
		).toBe(false);
	});
});
