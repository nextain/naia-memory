import { describe, expect, it } from "vitest";
import type { SemanticAnalysisPlan } from "./semantic-analysis-plan.js";
import { calculateSemanticCompetitiveInference } from "./semantic-competitive-inference.js";

const plan: SemanticAnalysisPlan = {
	schemaVersion: "naia-memory-semantic-analysis-plan-v4",
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
	requiredIndependentAuthorClustersByLanguage: { en: 6, ko: 6 },
	requiredIndependentConstructionClustersByLanguage: { en: 6, ko: 6 },
	independenceUnit: "construction-cluster",
	sensitivityAnalysis: "author-equal-and-family-equal-directional-agreement",
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
		authorClusterId: familyId,
		constructionClusterId: familyId,
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
			requiredIndependentAuthorClustersByLanguage: { en: 2, ko: 2 },
			requiredIndependentConstructionClustersByLanguage: { en: 2, ko: 2 },
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
			requiredIndependentAuthorClustersByLanguage: { en: 5, ko: 6 },
			requiredIndependentConstructionClustersByLanguage: { en: 5, ko: 6 },
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
				(item) => item.reason === "no-discordant-author-clusters",
			),
		).toBe(true);
	});

	it("counts MPID-boundary ties as failures under the all-family null", () => {
		const mixedPlan = {
			...plan,
			requiredIndependentAuthorClustersByLanguage: { en: 10, ko: 10 },
			requiredIndependentConstructionClustersByLanguage: { en: 10, ko: 10 },
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

	it("does not count many families from one author as independent evidence", () => {
		const clusteredPlan = {
			...plan,
			requiredIndependentAuthorClustersByLanguage: { en: 2, ko: 2 },
			requiredIndependentConstructionClustersByLanguage: { en: 2, ko: 2 },
		};
		const samples = ["en", "ko"].flatMap((language) =>
			Array.from({ length: 20 }, (_, index) =>
				[
					sample("naia", language, `f-${language}-${index}`, 1),
					sample("mem0", language, `f-${language}-${index}`, 0),
				].map((item) => ({ ...item, authorClusterId: `author-${language}` })),
			).flat(),
		);
		expect(() =>
			calculateSemanticCompetitiveInference({
				samples,
				plan: clusteredPlan,
			}),
		).toThrow("author-cluster target unmet");
	});

	it("does not count authors sharing one construction pipeline as independent evidence", () => {
		const samples = ["en", "ko"].flatMap((language) =>
			Array.from({ length: 6 }, (_, index) =>
				[
					sample("naia", language, `f-${language}-${index}`, 1),
					sample("mem0", language, `f-${language}-${index}`, 0),
				].map((item) => ({
					...item,
					constructionClusterId: `shared-pipeline-${language}`,
				})),
			).flat(),
		);
		expect(() =>
			calculateSemanticCompetitiveInference({ samples, plan }),
		).toThrow("construction-cluster target unmet");
	});

	it("discloses disagreement between author-equal and family-equal sensitivity", () => {
		const sensitivityPlan = {
			...plan,
			requiredIndependentAuthorClustersByLanguage: { en: 10, ko: 10 },
			requiredIndependentConstructionClustersByLanguage: { en: 10, ko: 10 },
		};
		const samples = ["en", "ko"].flatMap((language) =>
			Array.from({ length: 10 }, (_, authorIndex) => {
				const familyCount = authorIndex === 0 ? 20 : 1;
				return Array.from({ length: familyCount }, (_, familyIndex) => {
					const familyId = `f-${language}-${authorIndex}-${familyIndex}`;
					return [
						sample("naia", language, familyId, authorIndex === 0 ? 0 : 1),
						sample("mem0", language, familyId, authorIndex === 0 ? 1 : 0),
					].map((item) => ({
						...item,
						authorClusterId: `author-${language}-${authorIndex}`,
						constructionClusterId: `construction-${language}-${authorIndex}`,
					}));
				}).flat();
			}).flat(),
		);
		const result = calculateSemanticCompetitiveInference({
			samples,
			plan: sensitivityPlan,
		});
		expect(
			result.hypotheses.every(
				(item) =>
					item.authorEqualMeanDifference > 0 &&
					item.familyEqualMeanDifference < 0 &&
					!item.sensitivityDirectionalAgreement,
			),
		).toBe(true);
		expect(result.allHypothesesRejected).toBe(true);
		expect(result.allSensitivityDirectionsAgree).toBe(false);
		expect(result.competitiveThresholdsPassed).toBe(false);
	});

	it("does not treat neutral sensitivity means as directional agreement", () => {
		const samples = ["en", "ko"].flatMap((language) =>
			Array.from({ length: 6 }, (_, index) => [
				sample(
					"naia",
					language,
					`f-${language}-${index}`,
					index % 2 === 0 ? 1 : 0,
				),
				sample(
					"mem0",
					language,
					`f-${language}-${index}`,
					index % 2 === 0 ? 0 : 1,
				),
			]).flat(),
		);
		const result = calculateSemanticCompetitiveInference({ samples, plan });
		expect(
			result.hypotheses.every(
				(item) =>
					item.authorEqualMeanDifference === 0 &&
					item.familyEqualMeanDifference === 0 &&
					!item.sensitivityDirectionalAgreement,
			),
		).toBe(true);
		expect(result.allSensitivityDirectionsAgree).toBe(false);
		expect(result.competitiveThresholdsPassed).toBe(false);
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
			requiredIndependentAuthorClustersByLanguage: { en: 1024, ko: 1024 },
			requiredIndependentConstructionClustersByLanguage: {
				en: 1024,
				ko: 1024,
			},
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
