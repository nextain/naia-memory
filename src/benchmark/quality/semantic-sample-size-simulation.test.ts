import { describe, expect, it } from "vitest";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import type { SemanticAnalysisPlan } from "./semantic-analysis-plan.js";
import {
	type SemanticSampleSizeAssumptions,
	isSemanticSampleSizeAssumptions,
	simulateSemanticSampleSize,
} from "./semantic-sample-size-simulation.js";

const assumptions: SemanticSampleSizeAssumptions = {
	schemaVersion: "naia-memory-semantic-sample-size-assumptions-v4",
	languages: ["en", "ko"],
	competitors: ["mem0"],
	nullConstructionClusterExceedanceProbability: 0.5,
	alternativeConstructionClusterExceedanceProbability: {
		en: { mem0: 0.9 },
		ko: { mem0: 0.9 },
	},
	dependencyModel:
		"shared-uniform-within-cell-construction-cluster-shock-mixture",
	dependencyScenarios: [
		{ id: "independent", sharedCellShockProbability: 0 },
		{ id: "moderate-positive", sharedCellShockProbability: 0.35 },
	],
	candidateIndependentConstructionClustersByLanguage: [
		{ en: 6, ko: 6 },
		{ en: 24, ko: 24 },
	],
	simulationIterations: 4_000,
	seed: 20260821,
	statement: "FROZEN_BEFORE_CAMPAIGN_EXECUTION",
};

function planFor(value = assumptions): SemanticAnalysisPlan {
	return {
		schemaVersion: "naia-memory-semantic-analysis-plan-v5",
		administrator: "statistician",
		contractSha256: "0".repeat(64),
		engines: ["mem0", "naia"],
		primaryEngine: "naia",
		primaryMetric: "currentAt1",
		primaryComparisons: ["mem0"],
		claimScope: "direct-lifecycle-competitive-report-v1",
		comparisonLanes: {
			directLifecycle: ["mem0"],
			nativeTemporalCharacterization: [],
			agentManagedCharacterization: [],
			productIntegrationDiagnostic: [],
		},
		crossLaneAggregation: "prohibited",
		familyWiseAlpha: 0.05,
		multiplicityAdjustment: "holm",
		targetPower: 0.8,
		minimumDetectableDifference: 0.1,
		minimumPracticallyImportantDifference: 0.1,
		decisionRule: "holm-all-language-competitor-superiority",
		requiredIndependentAuthorClustersByLanguage: { en: 24, ko: 24 },
		requiredIndependentConstructionClustersByLanguage: { en: 24, ko: 24 },
		independenceUnit: "construction-cluster",
		sensitivityAnalysis: "author-equal-and-family-equal-directional-agreement",
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
	it("runs every dependency scenario and validates the signed-plan target", () => {
		expect(isSemanticSampleSizeAssumptions(assumptions)).toBe(true);
		const first = simulateSemanticSampleSize({ assumptions, plan: planFor() });
		const second = simulateSemanticSampleSize({ assumptions, plan: planFor() });
		expect(first).toEqual(second);
		expect(
			first.candidates[0]?.scenarios[0]?.alternativeCompleteDecisionPower
				.lower95,
		).toBeLessThan(0.8);
		expect(first.plannedCandidate.scenarios).toHaveLength(2);
		expect(
			first.plannedCandidate.scenarios[0]?.nullAnyHypothesisRejection.upper95,
		).toBeLessThanOrEqual(0.05);
		expect(
			first.plannedCandidate.scenarios[1]?.nullAnyHypothesisRejection.upper95,
		).toBeGreaterThan(0.05);
		expect(first.planTargetSatisfiedUnderAssumptions).toBe(false);
		expect(first.plannedIndependentConstructionClustersByLanguage).toEqual({
			en: 24,
			ko: 24,
		});
		expect(first.sampleSizeAdequacyVerified).toBe(false);
	});

	it("fails closed on a mutated assumptions artifact or incomplete cell matrix", () => {
		const mutated = structuredClone(assumptions);
		mutated.dependencyScenarios[1] = {
			id: "moderate-positive",
			sharedCellShockProbability: 0.36,
		};
		expect(() =>
			simulateSemanticSampleSize({ assumptions: mutated, plan: planFor() }),
		).toThrow("hash mismatch");
		const invalid = structuredClone(assumptions) as unknown as Record<
			string,
			unknown
		>;
		invalid.alternativeConstructionClusterExceedanceProbability = {
			en: { mem0: 0.9 },
		};
		expect(isSemanticSampleSizeAssumptions(invalid)).toBe(false);
		const noIndependence = structuredClone(assumptions);
		noIndependence.dependencyScenarios = [
			{ id: "moderate", sharedCellShockProbability: 0.35 },
			{ id: "strong", sharedCellShockProbability: 1 },
		];
		expect(isSemanticSampleSizeAssumptions(noIndependence)).toBe(false);

		const missingTarget = structuredClone(assumptions);
		missingTarget.candidateIndependentConstructionClustersByLanguage = [
			{ en: 6, ko: 6 },
		];
		expect(() =>
			simulateSemanticSampleSize({
				assumptions: missingTarget,
				plan: planFor(missingTarget),
			}),
		).toThrow("signed plan target is not simulated");
	});
});
