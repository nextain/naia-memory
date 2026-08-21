import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import type { SemanticAnalysisPlan } from "./semantic-analysis-plan.js";
import {
	MAX_EXACT_BINOMIAL_TRIALS,
	exactBinomialUpperTail,
	holmRejectedCount,
} from "./semantic-sign-test.js";

export type SemanticSampleSizeAssumptions = {
	schemaVersion: "naia-memory-semantic-sample-size-assumptions-v3";
	languages: string[];
	competitors: string[];
	nullAuthorClusterExceedanceProbability: 0.5;
	alternativeAuthorClusterExceedanceProbability: Record<
		string,
		Record<string, number>
	>;
	dependencyModel: "shared-uniform-within-cell-author-cluster-shock-mixture";
	dependencyScenarios: {
		id: string;
		sharedCellShockProbability: number;
	}[];
	candidateIndependentAuthorClustersByLanguage: Record<string, number>[];
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
		item.schemaVersion !== "naia-memory-semantic-sample-size-assumptions-v3" ||
		!uniqueNonemptyStrings(item.languages) ||
		item.languages.length > 64 ||
		!uniqueNonemptyStrings(item.competitors) ||
		item.competitors.length > 64 ||
		item.nullAuthorClusterExceedanceProbability !== 0.5 ||
		item.dependencyModel !==
			"shared-uniform-within-cell-author-cluster-shock-mixture" ||
		!Array.isArray(item.dependencyScenarios) ||
		item.dependencyScenarios.length < 2 ||
		item.dependencyScenarios.length > 20 ||
		!Number.isInteger(item.simulationIterations) ||
		Number(item.simulationIterations) < 1_000 ||
		Number(item.simulationIterations) > 1_000_000 ||
		!Number.isInteger(item.seed) ||
		Number(item.seed) < 1 ||
		Number(item.seed) > 0xffff_ffff ||
		item.statement !== "FROZEN_BEFORE_CAMPAIGN_EXECUTION" ||
		typeof item.alternativeAuthorClusterExceedanceProbability !== "object" ||
		item.alternativeAuthorClusterExceedanceProbability === null ||
		Array.isArray(item.alternativeAuthorClusterExceedanceProbability) ||
		!Array.isArray(item.candidateIndependentAuthorClustersByLanguage) ||
		item.candidateIndependentAuthorClustersByLanguage.length === 0 ||
		item.candidateIndependentAuthorClustersByLanguage.length > 100
	)
		return false;
	const scenarioIds = new Set<string>();
	let hasIndependentScenario = false;
	for (const rawScenario of item.dependencyScenarios) {
		if (
			typeof rawScenario !== "object" ||
			rawScenario === null ||
			Array.isArray(rawScenario)
		)
			return false;
		const scenario = rawScenario as Record<string, unknown>;
		if (
			Object.keys(scenario).sort().join("\0") !==
				["id", "sharedCellShockProbability"].sort().join("\0") ||
			typeof scenario.id !== "string" ||
			scenario.id.trim().length === 0 ||
			scenario.id.length > 64 ||
			scenarioIds.has(scenario.id) ||
			typeof scenario.sharedCellShockProbability !== "number" ||
			!Number.isFinite(scenario.sharedCellShockProbability) ||
			scenario.sharedCellShockProbability < 0 ||
			scenario.sharedCellShockProbability > 1
		)
			return false;
		scenarioIds.add(scenario.id);
		if (scenario.sharedCellShockProbability === 0)
			hasIndependentScenario = true;
	}
	if (!hasIndependentScenario) return false;
	const probabilities =
		item.alternativeAuthorClusterExceedanceProbability as Record<
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
	return item.candidateIndependentAuthorClustersByLanguage.every(
		(candidate) => {
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
		},
	);
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

function streamSeed(input: {
	base: number;
	candidateIndex: number;
	scenarioIndex: number;
	arm: "null" | "alternative";
}) {
	let value = input.base >>> 0;
	value ^= Math.imul(input.candidateIndex + 1, 0x9e37_79b1);
	value ^= Math.imul(input.scenarioIndex + 1, 0x85eb_ca77);
	value ^= Math.imul(input.arm === "null" ? 1 : 2, 0xc2b2_ae3d);
	return value >>> 0 || 1;
}

function cellSuccesses(input: {
	authorClusters: number;
	probability: number;
	sharedCellShockProbability: number;
	random: () => number;
}): number {
	// With probability q the whole cell shares one Bernoulli outcome; otherwise
	// author clusters are independent. Marginals stay p and pairwise covariance is
	// q * p * (1 - p), so every declared q >= 0 is nonnegative dependence.
	if (input.sharedCellShockProbability > 0) {
		const shocked = input.random() < input.sharedCellShockProbability;
		if (shocked)
			return input.random() < input.probability ? input.authorClusters : 0;
	}
	let successes = 0;
	for (let cluster = 0; cluster < input.authorClusters; cluster++)
		if (input.random() < input.probability) successes++;
	return successes;
}

function wilson(successes: number, trials: number) {
	// Standard two-sided 95% Wilson score interval, z = Phi^-1(0.975).
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
			Object.keys(plan.requiredIndependentAuthorClustersByLanguage)
				.sort()
				.join("\0") ||
		[...assumptions.competitors].sort().join("\0") !==
			[...plan.primaryComparisons].sort().join("\0")
	)
		throw new Error("semantic sample-size assumptions coverage mismatch");

	const candidates =
		assumptions.candidateIndependentAuthorClustersByLanguage.map(
			(counts, candidateIndex) => {
				const scenarios = assumptions.dependencyScenarios.map(
					(scenario, scenarioIndex) => {
						const nullRandom = seededRandom(
							streamSeed({
								base: assumptions.seed,
								candidateIndex,
								scenarioIndex,
								arm: "null",
							}),
						);
						const alternativeRandom = seededRandom(
							streamSeed({
								base: assumptions.seed,
								candidateIndex,
								scenarioIndex,
								arm: "alternative",
							}),
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
									const authorClusters = counts[language];
									const alternativeProbability =
										assumptions.alternativeAuthorClusterExceedanceProbability[
											language
										]?.[competitor];
									if (
										authorClusters === undefined ||
										alternativeProbability === undefined
									)
										throw new Error("semantic sample-size cell is missing");
									const nullSuccesses = cellSuccesses({
										authorClusters,
										probability:
											assumptions.nullAuthorClusterExceedanceProbability,
										sharedCellShockProbability:
											scenario.sharedCellShockProbability,
										random: nullRandom,
									});
									const alternativeSuccesses = cellSuccesses({
										authorClusters,
										probability: alternativeProbability,
										sharedCellShockProbability:
											scenario.sharedCellShockProbability,
										random: alternativeRandom,
									});
									nullPValues.push(
										exactBinomialUpperTail(nullSuccesses, authorClusters),
									);
									alternativePValues.push(
										exactBinomialUpperTail(
											alternativeSuccesses,
											authorClusters,
										),
									);
								}
							}
							const nullDecision = holmDecision(
								nullPValues,
								plan.familyWiseAlpha,
							);
							if (nullDecision.anyRejected) nullAny++;
							if (nullDecision.allRejected) nullAll++;
							if (
								holmDecision(alternativePValues, plan.familyWiseAlpha)
									.allRejected
							)
								alternativeAll++;
						}
						return {
							dependencyScenario: scenario,
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
				return { independentAuthorClustersByLanguage: counts, scenarios };
			},
		);
	const targetKey = JSON.stringify(
		Object.fromEntries(
			Object.entries(plan.requiredIndependentAuthorClustersByLanguage).sort(),
		),
	);
	const plannedCandidate = candidates.find(
		(candidate) =>
			JSON.stringify(
				Object.fromEntries(
					Object.entries(candidate.independentAuthorClustersByLanguage).sort(),
				),
			) === targetKey,
	);
	if (!plannedCandidate)
		throw new Error("semantic sample-size signed plan target is not simulated");
	const planTargetSatisfiedUnderAssumptions = plannedCandidate.scenarios.every(
		(scenario) =>
			scenario.nullAnyHypothesisRejection.upper95 <= plan.familyWiseAlpha &&
			scenario.alternativeCompleteDecisionPower.lower95 >= plan.targetPower,
	);
	return {
		schemaVersion: "naia-memory-semantic-sample-size-simulation-v3" as const,
		assumptionsSha256: evidenceObjectSha256(assumptions),
		method:
			"seeded-monte-carlo-complete-exact-sign-test-holm-dependency-sensitivity-rule" as const,
		iterations: assumptions.simulationIterations,
		seed: assumptions.seed,
		candidates,
		plannedIndependentAuthorClustersByLanguage:
			plan.requiredIndependentAuthorClustersByLanguage,
		plannedCandidate,
		planTargetSatisfiedUnderAssumptions,
		sampleSizeAdequacyVerified: false as const,
		claimEligible: false as const,
		caveat:
			"Power and null calibration are conditional on preregistered Bernoulli probabilities and the enumerated within-cell author-cluster-shock sensitivity scenarios. A positive shock scenario intentionally violates independence across authors to expose effective-sample-size risk; it does not estimate actual dependence, exhaust all structures, establish corpus validity, or permit public claims.",
	};
}
