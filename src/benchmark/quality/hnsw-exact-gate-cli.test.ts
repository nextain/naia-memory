import { describe, expect, it } from "vitest";
import {
	deterministicInsertionOrder,
	rankingsAreStable,
	resolveFactId,
	resolveFactIds,
	summarizeGeneratedInterference,
	summarizeGeneratedInterferenceDetails,
	summarizePreservationByCategory,
} from "./hnsw-exact-gate.js";

describe("HNSW exact gate labels", () => {
	it("uses deterministic but build-specific insertion permutations", () => {
		const first = deterministicInsertionOrder(100, "build-1");
		expect(first).toEqual(deterministicInsertionOrder(100, "build-1"));
		expect(first).not.toEqual(deterministicInsertionOrder(100, "build-2"));
		expect([...first].sort((a, b) => a - b)).toEqual(
			Array.from({ length: 100 }, (_, index) => index),
		);
	});

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

	it("reports exact-search intrusion by generated scale distractors", () => {
		expect(
			summarizeGeneratedInterference([
				["scale-ko-1", "F1", "scale-ko-2"],
				["F2", "F3", "F4"],
			]),
		).toEqual({
			top1Rate: 0.5,
			top10QueryRate: 0.5,
			meanGeneratedAt10: 1,
		});
	});

	it("attributes generated intrusion to query categories and template families", () => {
		expect(
			summarizeGeneratedInterferenceDetails(
				[["scale-en-1", "F1", "scale-en-2"], ["F2", "scale-en-1"], ["F3"]],
				["direct", "direct", "temporal"],
				(id) => (id.startsWith("scale-") ? Number(id.at(-1)) : null),
			),
		).toEqual({
			byCategory: {
				direct: {
					queryCount: 2,
					top1Rate: 0.5,
					top10QueryRate: 1,
					meanGeneratedAt10: 1.5,
				},
				temporal: {
					queryCount: 1,
					top1Rate: 0,
					top10QueryRate: 0,
					meanGeneratedAt10: 0,
				},
			},
			byTemplate: [
				{ templateIndex: 1, hitCount: 2, top1Count: 1 },
				{ templateIndex: 2, hitCount: 1, top1Count: 0 },
			],
		});
	});

	it("reports approximate preservation by query category", () => {
		expect(
			summarizePreservationByCategory(
				[
					{ goldId: "F1", baseline: ["F1", "F2"], candidate: ["F1", "F2"] },
					{ goldId: "F2", baseline: ["F2", "F3"], candidate: ["F3", "F2"] },
				],
				["direct", "temporal"],
			),
		).toEqual({
			direct: { queryCount: 1, overlapAt10: 1, agreementAt1: 1 },
			temporal: { queryCount: 1, overlapAt10: 1, agreementAt1: 0 },
		});
	});
});
