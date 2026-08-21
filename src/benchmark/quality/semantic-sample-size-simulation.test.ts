import { describe, expect, it } from "vitest";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import type { SemanticAnalysisPlan } from "./semantic-analysis-plan.js";
import {
	type SemanticSampleSizeAssumptions,
	isSemanticSampleSizeAssumptions,
	simulateSemanticSampleSize,
} from "./semantic-sample-size-simulation.js";

const assumptions: SemanticSampleSizeAssumptions = {
	schemaVersion: "naia-memory-semantic-sample-size-assumptions-v1",
	languages: ["en", "ko"],
	competitors: ["mem0"],
	nullFamilyExceedanceProbability: 0.5,
	alternativeFamilyExceedanceProbability: {
		en: { mem0: 0.9 },
		ko: { mem0: 0.9 },
	},
	dependencyModel: "independent-language-competitor-family-bernoulli",
	candidateIndependentFamiliesByLanguage: [
		{ en: 6, ko: 6 },
		{ en: 24, ko: 24 },
	],
	simulationIterations: 4_000,
	seed: 20260821,
	statement: "FROZEN_BEFORE_CAMPAIGN_EXECUTION",
};

function planFor(value = assumptions): SemanticAnalysisPlan {
	return {
		schemaVersion: "naia-memory-semantic-analysis-plan-v2",
		administrator: "statistician",
		contractSha256: "0".repeat(64),
		engines: ["mem0", "naia"],
		primaryEngine: "naia",
		primaryMetric: "currentAt1",
		primaryComparisons: ["mem0"],
		familyWiseAlpha: 0.05,
		multiplicityAdjustment: "holm",
		targetPower: 0.8,
		minimumDetectableDifference: 0.1,
		minimumPracticallyImportantDifference: 0.1,
		decisionRule: "holm-all-language-competitor-superiority",
		requiredIndependentFamiliesByLanguage: { en: 24, ko: 24 },
		sampleSizeMethod: "simulation of complete decision rule",
		sampleSizeAssumptionsSha256: evidenceObjectSha256(value),
		stoppingRule: "collect-all-frozen-test-families-no-outcome-peeking",
		createdAt: "2026-01-01T00:00:00Z",
		signedAt: "2026-01-01T00:00:01Z",
		statement: "ANALYSIS_PLAN_PREREGISTERED",
		signatureBase64: "x",
	};
}

describe("semantic sample-size simulation", () => {
	it("runs the complete Holm decision deterministically and selects a powered candidate", () => {
		expect(isSemanticSampleSizeAssumptions(assumptions)).toBe(true);
		const first = simulateSemanticSampleSize({ assumptions, plan: planFor() });
		const second = simulateSemanticSampleSize({ assumptions, plan: planFor() });
		expect(first).toEqual(second);
		expect(
			first.candidates[0]?.alternativeCompleteDecisionPower.lower95,
		).toBeLessThan(0.8);
		expect(first.planTargetSatisfiedUnderAssumptions).toBe(true);
		expect(first.plannedIndependentFamiliesByLanguage).toEqual({
			en: 24,
			ko: 24,
		});
		expect(first.sampleSizeAdequacyVerified).toBe(false);
	});

	it("fails closed on a mutated assumptions artifact or incomplete cell matrix", () => {
		const mutated = structuredClone(assumptions);
		mutated.seed++;
		expect(() =>
			simulateSemanticSampleSize({ assumptions: mutated, plan: planFor() }),
		).toThrow("hash mismatch");
		const invalid = structuredClone(assumptions) as unknown as Record<
			string,
			unknown
		>;
		invalid.alternativeFamilyExceedanceProbability = { en: { mem0: 0.9 } };
		expect(isSemanticSampleSizeAssumptions(invalid)).toBe(false);

		const missingTarget = structuredClone(assumptions);
		missingTarget.candidateIndependentFamiliesByLanguage = [{ en: 6, ko: 6 }];
		expect(() =>
			simulateSemanticSampleSize({
				assumptions: missingTarget,
				plan: planFor(missingTarget),
			}),
		).toThrow("signed plan target is not simulated");
	});
});
