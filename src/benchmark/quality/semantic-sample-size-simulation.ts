import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import type { SemanticAnalysisPlan } from "./semantic-analysis-plan.js";
import {
	MAX_EXACT_BINOMIAL_TRIALS,
	exactBinomialUpperTail,
	holmRejectedCount,
} from "./semantic-sign-test.js";

export type SemanticSampleSizeAssumptions = {
	schemaVersion: "naia-memory-semantic-sample-size-assumptions-v1";
	languages: string[];
	competitors: string[];
	nullFamilyExceedanceProbability: 0.5;
	alternativeFamilyExceedanceProbability: Record<
		string,
		Record<string, number>
	>;
	dependencyModel: "independent-language-competitor-family-bernoulli";
	candidateIndependentFamiliesByLanguage: Record<string, number>[];
	simulationIterations: number;
	seed: number;
	statement: "FROZEN_BEFORE_CAMPAIGN_EXECUTION";
};

type Decision = { anyRejected: boolean; allRejected: boolean };

function uniqueNonemptyStrings(value: unknown): value is string[] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		new Set(value).size === value.length &&
		value.every((item) => typeof item === "string" && item.trim().length > 0)
	);
}

export function isSemanticSampleSizeAssumptions(
	value: unknown,
): value is SemanticSampleSizeAssumptions {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return false;
	const item = value as Record<string, unknown>;
	if (
		item.schemaVersion !== "naia-memory-semantic-sample-size-assumptions-v1" ||
		!uniqueNonemptyStrings(item.languages) ||
		item.languages.length > 64 ||
		!uniqueNonemptyStrings(item.competitors) ||
		item.competitors.length > 64 ||
		item.nullFamilyExceedanceProbability !== 0.5 ||
		item.dependencyModel !==
			"independent-language-competitor-family-bernoulli" ||
		!Number.isInteger(item.simulationIterations) ||
		Number(item.simulationIterations) < 1_000 ||
		Number(item.simulationIterations) > 1_000_000 ||
		!Number.isInteger(item.seed) ||
		Number(item.seed) < 1 ||
		Number(item.seed) > 0xffff_ffff ||
		item.statement !== "FROZEN_BEFORE_CAMPAIGN_EXECUTION" ||
		typeof item.alternativeFamilyExceedanceProbability !== "object" ||
		item.alternativeFamilyExceedanceProbability === null ||
		Array.isArray(item.alternativeFamilyExceedanceProbability) ||
		!Array.isArray(item.candidateIndependentFamiliesByLanguage) ||
		item.candidateIndependentFamiliesByLanguage.length === 0 ||
		item.candidateIndependentFamiliesByLanguage.length > 100
	)
		return false;
	const probabilities = item.alternativeFamilyExceedanceProbability as Record<
		string,
		unknown
	>;
	if (
		Object.keys(probabilities).sort().join("\0") !==
		[...item.languages].sort().join("\0")
	)
		return false;
	for (const language of item.languages) {
		const row = probabilities[language];
		if (typeof row !== "object" || row === null || Array.isArray(row))
			return false;
		const cells = row as Record<string, unknown>;
		if (
			Object.keys(cells).sort().join("\0") !==
			[...item.competitors].sort().join("\0")
		)
			return false;
		if (
			Object.values(cells).some(
				(probability) =>
					typeof probability !== "number" ||
					!Number.isFinite(probability) ||
					probability <= 0.5 ||
					probability >= 1,
			)
		)
			return false;
	}
	const candidateKeys = new Set<string>();
	return item.candidateIndependentFamiliesByLanguage.every((candidate) => {
		if (
			typeof candidate !== "object" ||
			candidate === null ||
			Array.isArray(candidate)
		)
			return false;
		const counts = candidate as Record<string, unknown>;
		const valid =
			Object.keys(counts).sort().join("\0") ===
				[...item.languages].sort().join("\0") &&
			Object.values(counts).every(
				(count) =>
					Number.isInteger(count) &&
					Number(count) > 0 &&
					Number(count) <= MAX_EXACT_BINOMIAL_TRIALS,
			);
		const key = [...item.languages]
			.sort()
			.map((language) => `${language}:${String(counts[language])}`)
			.join("|");
		if (!valid || candidateKeys.has(key)) return false;
		candidateKeys.add(key);
		return true;
	});
}

function holmDecision(pValues: number[], alpha: number): Decision {
	const rejected = holmRejectedCount(pValues, alpha);
	return {
		anyRejected: rejected > 0,
		allRejected: rejected === pValues.length,
	};
}

function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return (state >>> 0) / 0x1_0000_0000;
	};
}

function wilson(successes: number, trials: number) {
	const z = 1.959963984540054;
	const estimate = successes / trials;
	const denominator = 1 + (z * z) / trials;
	const center = estimate + (z * z) / (2 * trials);
	const margin =
		z *
		Math.sqrt(
			(estimate * (1 - estimate)) / trials + (z * z) / (4 * trials * trials),
		);
	return {
		estimate,
		lower95: Math.max(0, (center - margin) / denominator),
		upper95: Math.min(1, (center + margin) / denominator),
	};
}

export function simulateSemanticSampleSize(input: {
	assumptions: SemanticSampleSizeAssumptions;
	plan: SemanticAnalysisPlan;
}) {
	const { assumptions, plan } = input;
	if (!isSemanticSampleSizeAssumptions(assumptions))
		throw new Error("semantic sample-size assumptions are invalid");
	if (evidenceObjectSha256(assumptions) !== plan.sampleSizeAssumptionsSha256)
		throw new Error("semantic sample-size assumptions hash mismatch");
	if (
		[...assumptions.languages].sort().join("\0") !==
			Object.keys(plan.requiredIndependentFamiliesByLanguage)
				.sort()
				.join("\0") ||
		[...assumptions.competitors].sort().join("\0") !==
			[...plan.primaryComparisons].sort().join("\0")
	)
		throw new Error("semantic sample-size assumptions coverage mismatch");

	const candidates = assumptions.candidateIndependentFamiliesByLanguage.map(
		(counts, candidateIndex) => {
			const nullRandom = seededRandom(
				(assumptions.seed + candidateIndex * 2) >>> 0 || 1,
			);
			const alternativeRandom = seededRandom(
				(assumptions.seed + candidateIndex * 2 + 1) >>> 0 || 1,
			);
			let nullAny = 0;
			let nullAll = 0;
			let alternativeAll = 0;
			for (
				let iteration = 0;
				iteration < assumptions.simulationIterations;
				iteration++
			) {
				const nullPValues: number[] = [];
				const alternativePValues: number[] = [];
				for (const competitor of assumptions.competitors) {
					for (const language of assumptions.languages) {
						const families = counts[language];
						const alternativeProbability =
							assumptions.alternativeFamilyExceedanceProbability[language]?.[
								competitor
							];
						if (families === undefined || alternativeProbability === undefined)
							throw new Error("semantic sample-size cell is missing");
						let nullSuccesses = 0;
						let alternativeSuccesses = 0;
						for (let family = 0; family < families; family++) {
							if (nullRandom() < assumptions.nullFamilyExceedanceProbability)
								nullSuccesses++;
							if (alternativeRandom() < alternativeProbability)
								alternativeSuccesses++;
						}
						nullPValues.push(exactBinomialUpperTail(nullSuccesses, families));
						alternativePValues.push(
							exactBinomialUpperTail(alternativeSuccesses, families),
						);
					}
				}
				const nullDecision = holmDecision(nullPValues, plan.familyWiseAlpha);
				if (nullDecision.anyRejected) nullAny++;
				if (nullDecision.allRejected) nullAll++;
				if (holmDecision(alternativePValues, plan.familyWiseAlpha).allRejected)
					alternativeAll++;
			}
			return {
				independentFamiliesByLanguage: counts,
				nullAnyHypothesisRejection: wilson(
					nullAny,
					assumptions.simulationIterations,
				),
				nullAllHypothesesRejection: wilson(
					nullAll,
					assumptions.simulationIterations,
				),
				alternativeCompleteDecisionPower: wilson(
					alternativeAll,
					assumptions.simulationIterations,
				),
			};
		},
	);
	const targetKey = JSON.stringify(
		Object.fromEntries(
			Object.entries(plan.requiredIndependentFamiliesByLanguage).sort(),
		),
	);
	const plannedCandidate = candidates.find(
		(candidate) =>
			JSON.stringify(
				Object.fromEntries(
					Object.entries(candidate.independentFamiliesByLanguage).sort(),
				),
			) === targetKey,
	);
	if (!plannedCandidate)
		throw new Error("semantic sample-size signed plan target is not simulated");
	const planTargetSatisfiedUnderAssumptions =
		plannedCandidate.nullAnyHypothesisRejection.upper95 <=
			plan.familyWiseAlpha &&
		plannedCandidate.alternativeCompleteDecisionPower.lower95 >=
			plan.targetPower;
	return {
		schemaVersion: "naia-memory-semantic-sample-size-simulation-v1" as const,
		assumptionsSha256: evidenceObjectSha256(assumptions),
		method: "seeded-monte-carlo-complete-exact-sign-test-holm-rule" as const,
		iterations: assumptions.simulationIterations,
		seed: assumptions.seed,
		candidates,
		plannedIndependentFamiliesByLanguage:
			plan.requiredIndependentFamiliesByLanguage,
		plannedCandidate,
		planTargetSatisfiedUnderAssumptions,
		sampleSizeAdequacyVerified: false as const,
		claimEligible: false as const,
		caveat:
			"Power is conditional on preregistered Bernoulli probabilities and independence. It does not establish empirical effect sizes, cross-cell dependence, corpus validity, or public-claim eligibility.",
	};
}
