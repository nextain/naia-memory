import { describe, expect, it } from "vitest";
import {
	SEMANTIC_BOOTSTRAP_ITERATIONS,
	calculateSemanticClusterBootstrap,
} from "./semantic-cluster-bootstrap.js";

function sample(engine: string, familyId: string, currentAt1: number) {
	return {
		engine,
		language: "ko",
		familyId,
		currentAt1,
		currentAtK: currentAt1,
		staleExposureAtK: 1 - currentAt1,
		deletionLeakageAtK: 0,
	};
}

describe("semantic family-cluster bootstrap", () => {
	it("is deterministic and reports family rather than repetition count", () => {
		const samples = [
			sample("naia", "family-a", 1),
			sample("naia", "family-a", 1),
			sample("naia", "family-b", 0),
			sample("naia", "family-b", 0),
			sample("mem0", "family-a", 0),
			sample("mem0", "family-a", 0),
			sample("mem0", "family-b", 0),
			sample("mem0", "family-b", 0),
		];
		const first = calculateSemanticClusterBootstrap(samples, "frozen-seed");
		const second = calculateSemanticClusterBootstrap(samples, "frozen-seed");
		expect(first).toEqual(second);
		expect(first.iterations).toBe(SEMANTIC_BOOTSTRAP_ITERATIONS);
		expect(first.multiplicityAdjustment).toBe("none");
		expect(first.hasSparseClusterWarning).toBe(true);
		expect(first.intervals["naia/ko"].currentAt1).toEqual({
			estimate: 0.5,
			lower: 0,
			upper: 1,
			independentClusters: 2,
		});
		const difference = first.pairedDifferences.find(
			(item) => item.metric === "currentAt1",
		);
		expect(difference).toMatchObject({
			leftEngine: "mem0",
			rightEngine: "naia",
			estimate: -0.5,
			lower: -1,
			upper: 0,
			independentClusters: 2,
		});
	});

	it("keeps all engine differences aligned to the same family draws", () => {
		const result = calculateSemanticClusterBootstrap(
			[
				sample("a", "family-a", 1),
				sample("a", "family-b", 0),
				sample("b", "family-a", 0),
				sample("b", "family-b", 0),
				sample("c", "family-a", 1),
				sample("c", "family-b", 1),
			],
			"seed",
		);
		expect(result.pairedDifferences).toHaveLength(12);
		expect(
			result.pairedDifferences.find(
				(item) =>
					item.leftEngine === "a" &&
					item.rightEngine === "c" &&
					item.metric === "currentAt1",
			),
		).toMatchObject({ estimate: -0.5, lower: -1, upper: 0 });
	});

	it("resamples only metric-eligible families and reports their count", () => {
		const nullable = (engine: string, familyId: string, eligible: boolean) => ({
			...sample(engine, familyId, 1),
			staleExposureAtK: eligible ? 0 : null,
		});
		const result = calculateSemanticClusterBootstrap(
			[
				nullable("a", "update-family", true),
				nullable("a", "delete-family", false),
				nullable("b", "update-family", true),
				nullable("b", "delete-family", false),
			],
			"metric-eligibility",
		);
		expect(result.intervals["a/ko"].currentAt1?.independentClusters).toBe(2);
		expect(result.intervals["a/ko"].staleExposureAtK).toMatchObject({
			independentClusters: 1,
			lower: 0,
			upper: 0,
		});
	});

	it("rejects eligibility drift within or across paired engines", () => {
		const base = sample("a", "family-a", 1);
		expect(() =>
			calculateSemanticClusterBootstrap(
				[
					base,
					{ ...base, staleExposureAtK: null },
					{ ...base, engine: "b" },
					{ ...base, engine: "b" },
				],
				"seed",
			),
		).toThrow("eligibility varies within family");
		expect(() =>
			calculateSemanticClusterBootstrap(
				[base, { ...base, engine: "b", staleExposureAtK: null }],
				"seed",
			),
		).toThrow("paired metric eligibility mismatch");
	});

	it("rejects unpaired family coverage and non-binary observations", () => {
		expect(() =>
			calculateSemanticClusterBootstrap(
				[sample("naia", "family-a", 1), sample("mem0", "family-b", 0)],
				"seed",
			),
		).toThrow("coverage mismatch");
		expect(() =>
			calculateSemanticClusterBootstrap(
				[
					sample("naia", "family-a", 1),
					sample("naia", "family-a", 1),
					sample("mem0", "family-a", 0),
				],
				"seed",
			),
		).toThrow("repetition mismatch");
		expect(() =>
			calculateSemanticClusterBootstrap(
				[
					sample("naia", "family-a", 1),
					sample("naia", "family-b", 0),
					sample("naia", "family-b", 0),
					sample("mem0", "family-a", 0),
					sample("mem0", "family-b", 0),
					sample("mem0", "family-b", 0),
				],
				"seed",
			),
		).toThrow("equal family sizes");
		expect(() =>
			calculateSemanticClusterBootstrap(
				[sample("naia", "family-a", 0.5)],
				"seed",
			),
		).toThrow("binary or null metrics");
	});
});
