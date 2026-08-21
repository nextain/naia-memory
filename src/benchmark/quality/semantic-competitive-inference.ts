import type { SemanticAnalysisPlan } from "./semantic-analysis-plan.js";
import type { SemanticBootstrapSample } from "./semantic-cluster-bootstrap.js";
import { exactBinomialUpperTail } from "./semantic-sign-test.js";

const PRACTICAL_DIFFERENCE_TIE_TOLERANCE = 1e-12;

type Hypothesis = {
	hypothesis: string;
	competitor: string;
	language: string;
	independentAuthorClusters: number;
	effectiveAuthorClusters: number;
	observedMeanDifference: number;
	minimumPracticallyImportantDifference: number;
	rawPValue: number;
	minimumAttainablePValue: number;
	holmAdjustedPValue: number;
	holmRejected: boolean;
	estimable: boolean;
	reason: "qualified" | "resolution-floor" | "no-discordant-author-clusters";
};

type SemanticCompetitiveSample = SemanticBootstrapSample & {
	caseId: string;
	authorClusterId: string;
};

function metricValue(
	sample: SemanticBootstrapSample,
	metric: SemanticAnalysisPlan["primaryMetric"],
): number {
	if (metric === "currentAt1") return sample.currentAt1;
	if (metric === "staleExposureRate") return sample.staleExposureAtK;
	return sample.deletionLeakageAtK;
}

function mean(values: number[]): number {
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function calculateSemanticCompetitiveInference(input: {
	samples: SemanticCompetitiveSample[];
	plan: SemanticAnalysisPlan;
}) {
	const { samples, plan } = input;
	if (samples.length === 0)
		throw new Error("competitive inference requires samples");
	for (const sample of samples) {
		if (
			!sample.engine ||
			!sample.language ||
			!sample.familyId ||
			!sample.caseId ||
			!sample.authorClusterId ||
			![
				sample.currentAt1,
				sample.currentAtK,
				sample.staleExposureAtK,
				sample.deletionLeakageAtK,
			].every((value) => value === 0 || value === 1)
		)
			throw new Error(
				"competitive inference requires identified binary samples",
			);
	}
	const sampleEngines = [
		...new Set(samples.map((sample) => sample.engine)),
	].sort();
	if ([...plan.engines].sort().join("\0") !== sampleEngines.join("\0"))
		throw new Error("competitive inference engine coverage mismatch");
	const languages = Object.keys(
		plan.requiredIndependentAuthorClustersByLanguage,
	).sort();
	const sampleLanguages = [
		...new Set(samples.map((sample) => sample.language)),
	].sort();
	if (languages.join("\0") !== sampleLanguages.join("\0"))
		throw new Error("competitive inference language coverage mismatch");

	const hypotheses: Hypothesis[] = [];
	const lowerIsBetter = plan.primaryMetric !== "currentAt1";
	for (const competitor of [...plan.primaryComparisons].sort()) {
		for (const language of languages) {
			const languageSamples = samples.filter(
				(sample) => sample.language === language,
			);
			const families = [
				...new Set(languageSamples.map((sample) => sample.familyId)),
			].sort();
			const familyDifferences = families.map((family) => {
				const select = (engine: string) =>
					languageSamples.filter(
						(sample) => sample.engine === engine && sample.familyId === family,
					);
				const primary = select(plan.primaryEngine);
				const comparison = select(competitor);
				const caseCounts = (items: SemanticCompetitiveSample[]) => {
					const counts = new Map<string, number>();
					for (const item of items)
						counts.set(item.caseId, (counts.get(item.caseId) ?? 0) + 1);
					return [...counts].sort(([left], [right]) =>
						left.localeCompare(right),
					);
				};
				if (
					primary.length === 0 ||
					JSON.stringify(caseCounts(primary)) !==
						JSON.stringify(caseCounts(comparison))
				)
					throw new Error(
						`competitive inference pairing mismatch: ${language}/${family}`,
					);
				const raw =
					mean(
						primary.map((sample) => metricValue(sample, plan.primaryMetric)),
					) -
					mean(
						comparison.map((sample) => metricValue(sample, plan.primaryMetric)),
					);
				const authorClusters = new Set(
					[...primary, ...comparison].map((sample) => sample.authorClusterId),
				);
				if (authorClusters.size !== 1)
					throw new Error(
						`competitive inference author-cluster mismatch: ${language}/${family}`,
					);
				return {
					authorClusterId: [...authorClusters][0],
					difference: lowerIsBetter ? -raw : raw,
				};
			});
			const authorClusters = [
				...new Set(familyDifferences.map((item) => item.authorClusterId)),
			].sort();
			if (
				authorClusters.length <
				plan.requiredIndependentAuthorClustersByLanguage[language]
			)
				throw new Error(
					`competitive inference author-cluster target unmet: ${language}`,
				);
			const differences = authorClusters.map((authorClusterId) =>
				mean(
					familyDifferences
						.filter((item) => item.authorClusterId === authorClusterId)
						.map((item) => item.difference),
				),
			);
			const shifted = differences.map(
				(value) => value - plan.minimumPracticallyImportantDifference,
			);
			const discordant = shifted.filter(
				(value) => Math.abs(value) > PRACTICAL_DIFFERENCE_TIE_TOLERANCE,
			);
			const successes = shifted.filter(
				(value) => value > PRACTICAL_DIFFERENCE_TIE_TOLERANCE,
			).length;
			const minimumAttainablePValue = 2 ** -shifted.length;
			let rawPValue: number;
			try {
				rawPValue = exactBinomialUpperTail(successes, shifted.length);
			} catch {
				throw new Error(
					"competitive inference exact sign test exceeds numerical range",
				);
			}
			hypotheses.push({
				hypothesis: `${plan.primaryEngine}>${competitor}/${language}/${plan.primaryMetric}`,
				competitor,
				language,
				independentAuthorClusters: authorClusters.length,
				effectiveAuthorClusters: shifted.length,
				observedMeanDifference: mean(differences),
				minimumPracticallyImportantDifference:
					plan.minimumPracticallyImportantDifference,
				rawPValue,
				minimumAttainablePValue,
				holmAdjustedPValue: 1,
				holmRejected: false,
				estimable: discordant.length > 0,
				reason:
					discordant.length === 0
						? "no-discordant-author-clusters"
						: "qualified",
			});
		}
	}

	const ordered = [...hypotheses].sort(
		(left, right) =>
			left.rawPValue - right.rawPValue ||
			left.hypothesis.localeCompare(right.hypothesis),
	);
	let runningAdjusted = 0;
	let rejectionOpen = true;
	ordered.forEach((item, index) => {
		const remaining = ordered.length - index;
		if (
			item.reason !== "no-discordant-author-clusters" &&
			item.minimumAttainablePValue > plan.familyWiseAlpha / remaining
		) {
			item.estimable = false;
			item.reason = "resolution-floor";
		}
		runningAdjusted = Math.max(
			runningAdjusted,
			Math.min(1, item.rawPValue * remaining),
		);
		item.holmAdjustedPValue = runningAdjusted;
		item.holmRejected =
			rejectionOpen && item.rawPValue <= plan.familyWiseAlpha / remaining;
		if (!item.holmRejected) rejectionOpen = false;
	});

	return {
		method: "exact-author-cluster-sign-test-shifted-null-v1" as const,
		testedNull:
			"at most half of independent paired author clusters have a family-mean direction-normalized difference exceeding the preregistered MPID",
		multiplicityAdjustment: "holm" as const,
		decisionRule: plan.decisionRule,
		hypotheses: hypotheses.sort((a, b) =>
			a.hypothesis.localeCompare(b.hypothesis),
		),
		allHypothesesEstimable: hypotheses.every((item) => item.estimable),
		allHypothesesRejected: hypotheses.every((item) => item.holmRejected),
		competitiveThresholdsPassed:
			hypotheses.every((item) => item.estimable) &&
			hypotheses.every((item) => item.holmRejected),
		internalIntegrityGateOnly: true as const,
		claimEligible: false as const,
		publicQuotable: false as const,
		methodAdequacyVerified: false as const,
		sampleSizeAdequacyVerified: false as const,
		caveat:
			"This exact sign test targets author-cluster-majority superiority beyond MPID, not mean superiority; each signed corpus author contributes one equally weighted cluster mean per language. Independence across authors remains a preregistered design assumption. Shifted differences within 1e-12 are ties. Holm plus an all-cells rule is conservative; power must be verified for this complete rule before any public claim.",
	};
}
