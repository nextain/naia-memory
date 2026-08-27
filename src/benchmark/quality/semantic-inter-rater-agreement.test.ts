import { describe, expect, it } from "vitest";
import {
	calculateSemanticInterRaterAgreement,
	consensusSemanticLabel,
} from "./semantic-inter-rater-agreement.js";

describe("semantic inter-rater agreement", () => {
	it("reports exact, pairwise, and chance-corrected agreement by language", () => {
		const result = calculateSemanticInterRaterAgreement([
			{
				subjectId: "ko/a",
				language: "ko",
				ratings: ["current", "current", "current"],
			},
			{
				subjectId: "ko/b",
				language: "ko",
				ratings: ["stale", "stale", "deleted"],
			},
			{
				subjectId: "en/a",
				language: "en",
				ratings: ["irrelevant", "irrelevant"],
			},
		]);
		expect(result.overall).toMatchObject({
			subjects: 3,
			ratings: 8,
			agreeingPairs: 5,
			totalPairs: 7,
			exactAgreementSubjects: 2,
			disagreementSubjects: 1,
			percentAgreement: 0.714286,
			exactAgreementRate: 0.666667,
		});
		expect(result.byLanguage.ko.disagreementSubjects).toBe(1);
		expect(result.byLanguage.en.multiRaterKappa).toBe(1);
		expect(result.scopeCaveat).toContain("use byLanguage kappa");
	});

	it("uses a unique majority and resolves ties to uncertain", () => {
		expect(consensusSemanticLabel(["current", "current", "stale"])).toBe(
			"current",
		);
		expect(consensusSemanticLabel(["current", "stale"])).toBe("uncertain");
	});

	it("rejects duplicate subjects and single-rater input", () => {
		expect(() =>
			calculateSemanticInterRaterAgreement([
				{ subjectId: "same", language: "ko", ratings: ["current", "stale"] },
				{ subjectId: "same", language: "ko", ratings: ["current", "stale"] },
			]),
		).toThrow("unique");
		expect(() =>
			calculateSemanticInterRaterAgreement([
				{ subjectId: "one", language: "ko", ratings: ["current"] },
			]),
		).toThrow("at least two");
	});
});
