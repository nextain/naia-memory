import { describe, expect, it } from "vitest";
import type { SemanticAnalysisPlan } from "./semantic-analysis-plan.js";
import { calculateSemanticCompetitiveInference } from "./semantic-competitive-inference.js";

const plan: SemanticAnalysisPlan = {
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
	requiredIndependentFamiliesByLanguage: { en: 6, ko: 6 },
	sampleSizeMethod: "simulation of complete decision rule",
	sampleSizeAssumptionsSha256: "1".repeat(64),
	stoppingRule: "collect-all-frozen-test-families-no-outcome-peeking",
	createdAt: "2026-01-01T00:00:00Z",
	signedAt: "2026-01-01T00:00:01Z",
	statement: "ANALYSIS_PLAN_PREREGISTERED",
	signatureBase64: "x",
};

function sample(
	engine: string,
	language: string,
	familyId: string,
	value: number,
	caseId = `${familyId}-case`,
) {
	return {
		engine,
		language,
		familyId,
		caseId,
		currentAt1: value,
		currentAtK: value,
		staleExposureAtK: 1 - value,
		deletionLeakageAtK: 0,
	};
}

describe("semantic competitive inference", () => {
	it("computes exact per-language tests and Holm decisions", () => {
		const samples = ["en", "ko"].flatMap((language) =>
			Array.from({ length: 6 }, (_, index) => [
				sample("naia", language, `f-${language}-${index}`, 1),
				sample("mem0", language, `f-${language}-${index}`, 0),
			]).flat(),
		);
		const result = calculateSemanticCompetitiveInference({ samples, plan });
		expect(result.competitiveThresholdsPassed).toBe(true);
		expect(result.hypotheses).toHaveLength(2);
		expect(result.hypotheses.map((item) => item.rawPValue)).toEqual([
			1 / 64,
			1 / 64,
		]);
		expect(result.hypotheses.map((item) => item.holmAdjustedPValue)).toEqual([
			1 / 32,
			1 / 32,
		]);
		expect(result.claimEligible).toBe(false);
	});

	it("fails closed when p-value resolution or coverage is inadequate", () => {
		const sparsePlan = {
			...plan,
			requiredIndependentFamiliesByLanguage: { en: 2, ko: 2 },
		};
		const samples = ["en", "ko"].flatMap((language) =>
			[0, 1].flatMap((index) => [
				sample("naia", language, `f-${language}-${index}`, 1),
				sample("mem0", language, `f-${language}-${index}`, 0),
			]),
		);
		const result = calculateSemanticCompetitiveInference({
			samples,
			plan: sparsePlan,
		});
		expect(result.competitiveThresholdsPassed).toBe(false);
		expect(
			result.hypotheses.every((item) => item.reason === "resolution-floor"),
		).toBe(true);
		expect(() =>
			calculateSemanticCompetitiveInference({
				samples: samples.filter((item) => item.language === "ko"),
				plan: sparsePlan,
			}),
		).toThrow("language coverage mismatch");
	});

	it("evaluates the resolution floor at the hypothesis's actual Holm rank", () => {
		const rankedPlan = {
			...plan,
			requiredIndependentFamiliesByLanguage: { en: 5, ko: 6 },
		};
		const samples = [
			...Array.from({ length: 5 }, (_, index) => [
				sample("naia", "en", `f-en-${index}`, 1),
				sample("mem0", "en", `f-en-${index}`, 0),
			]).flat(),
			...Array.from({ length: 6 }, (_, index) => [
				sample("naia", "ko", `f-ko-${index}`, 1),
				sample("mem0", "ko", `f-ko-${index}`, 0),
			]).flat(),
		];
		const result = calculateSemanticCompetitiveInference({
			samples,
			plan: rankedPlan,
		});
		expect(result.competitiveThresholdsPassed).toBe(true);
		expect(result.hypotheses.every((item) => item.estimable)).toBe(true);
	});

	it("preserves the no-discordant-family diagnosis", () => {
		const tied = ["en", "ko"].flatMap((language) =>
			Array.from({ length: 6 }, (_, index) =>
				Array.from({ length: 10 }, (__, repetition) => [
					sample(
						"naia",
						language,
						`f-${language}-${index}`,
						repetition === 0 ? 1 : 0,
					),
					sample("mem0", language, `f-${language}-${index}`, 0),
				]).flat(),
			).flat(),
		);
		const result = calculateSemanticCompetitiveInference({
			samples: tied,
			plan,
		});
		expect(
			result.hypotheses.every(
				(item) => item.reason === "no-discordant-families",
			),
		).toBe(true);
	});

	it("counts MPID-boundary ties as failures under the all-family null", () => {
		const mixedPlan = {
			...plan,
			requiredIndependentFamiliesByLanguage: { en: 10, ko: 10 },
		};
		const samples = ["en", "ko"].flatMap((language) =>
			Array.from({ length: 10 }, (_, index) => [
				sample("naia", language, `f-${language}-${index}`, index < 6 ? 1 : 0),
				sample("mem0", language, `f-${language}-${index}`, 0),
			]).flat(),
		);
		const result = calculateSemanticCompetitiveInference({
			samples,
			plan: mixedPlan,
		});
		expect(result.hypotheses.map((item) => item.rawPValue)).toEqual([
			0.376953125, 0.376953125,
		]);
		expect(result.competitiveThresholdsPassed).toBe(false);
	});

	it("rejects equal aggregate counts with mismatched case composition", () => {
		const samples = ["en", "ko"].flatMap((language) =>
			Array.from({ length: 6 }, (_, index) => [
				sample("naia", language, `f-${language}-${index}`, 1, "case-a"),
				sample("mem0", language, `f-${language}-${index}`, 0, "case-b"),
			]).flat(),
		);
		expect(() =>
			calculateSemanticCompetitiveInference({ samples, plan }),
		).toThrow("pairing mismatch");
	});

	it("fails closed on non-binary samples and unsupported exact-test size", () => {
		const valid = ["en", "ko"].flatMap((language) =>
			Array.from({ length: 6 }, (_, index) => [
				sample("naia", language, `f-${language}-${index}`, 1),
				sample("mem0", language, `f-${language}-${index}`, 0),
			]).flat(),
		);
		expect(() =>
			calculateSemanticCompetitiveInference({
				samples: [{ ...valid[0], currentAt1: 0.5 }, ...valid.slice(1)],
				plan,
			}),
		).toThrow("identified binary samples");

		const oversizedPlan = {
			...plan,
			requiredIndependentFamiliesByLanguage: { en: 1024, ko: 1024 },
		};
		const oversized = ["en", "ko"].flatMap((language) =>
			Array.from({ length: 1024 }, (_, index) => [
				sample("naia", language, `f-${language}-${index}`, 1),
				sample("mem0", language, `f-${language}-${index}`, 0),
			]).flat(),
		);
		expect(() =>
			calculateSemanticCompetitiveInference({
				samples: oversized,
				plan: oversizedPlan,
			}),
		).toThrow("exceeds numerical range");
	});
});
