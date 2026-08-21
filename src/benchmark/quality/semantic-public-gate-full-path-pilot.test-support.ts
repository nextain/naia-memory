import { generateKeyPairSync, sign } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type MemoryUpdateContract,
	computeFamilySplitDigest,
} from "./memory-update-contract.js";
import {
	evidenceObjectSha256,
	evidenceSignaturePayload,
} from "./public-evidence-crypto.js";
import type { SemanticSampleSizeAssumptions } from "./semantic-sample-size-simulation.js";

export async function writeAnalysisPlanFixture(
	directory: string,
	contract: MemoryUpdateContract,
	sampleSizeAssumptionsSha256 = "d".repeat(64),
	createdAt = "2026-01-04T00:00:00Z",
	signedAt = "2026-01-04T00:01:00Z",
) {
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	const requiredIndependentAuthorClustersByLanguage = Object.fromEntries(
		(["ko", "en", "ja"] as const).map((language) => [
			language,
			new Set(
				contract.cases
					.filter((item) => item.split === "test" && item.language === language)
					.map((item) => item.provenance?.authorId),
			).size,
		]),
	);
	const requiredIndependentConstructionClustersByLanguage = Object.fromEntries(
		(["ko", "en", "ja"] as const).map((language) => [
			language,
			new Set(
				contract.cases
					.filter((item) => item.split === "test" && item.language === language)
					.map((item) => item.provenance?.constructionClusterId),
			).size,
		]),
	);
	const unsigned = {
		schemaVersion: "naia-memory-semantic-analysis-plan-v4" as const,
		administrator: "external-statistician",
		contractSha256: evidenceObjectSha256(contract),
		engines: ["hindsight", "mem0", "naia"],
		primaryEngine: "naia" as const,
		primaryMetric: "currentAt1" as const,
		primaryComparisons: ["hindsight", "mem0"],
		familyWiseAlpha: 0.05,
		multiplicityAdjustment: "holm" as const,
		targetPower: 0.8,
		minimumDetectableDifference: 0.1,
		minimumPracticallyImportantDifference: 0.1,
		decisionRule: "holm-all-language-competitor-superiority" as const,
		requiredIndependentAuthorClustersByLanguage,
		requiredIndependentConstructionClustersByLanguage,
		independenceUnit: "construction-cluster" as const,
		sensitivityAnalysis:
			"author-equal-and-family-equal-directional-agreement" as const,
		sampleSizeMethod: "paired-family simulation",
		sampleSizeAssumptionsSha256,
		stoppingRule:
			"collect-all-frozen-test-families-no-outcome-peeking" as const,
		createdAt,
		signedAt,
		statement: "ANALYSIS_PLAN_PREREGISTERED" as const,
	};
	const plan = {
		...unsigned,
		signatureBase64: sign(
			null,
			evidenceSignaturePayload(unsigned),
			privateKey,
		).toString("base64"),
	};
	const paths = [
		join(directory, "analysis-plan.json"),
		join(directory, "analysis-plan-trust-policy.json"),
	];
	await Promise.all([
		writeFile(paths[0], JSON.stringify(plan)),
		writeFile(
			paths[1],
			JSON.stringify({
				administratorPublicKeys: {
					"external-statistician": publicKey
						.export({ type: "spki", format: "pem" })
						.toString(),
				},
			}),
		),
	]);
	return paths;
}

export async function writePowerReviewFixture(
	directory: string,
	publicEvidenceContract: MemoryUpdateContract,
	futureChronology = false,
) {
	const authoredAt = futureChronology
		? "2098-01-01T01:00:00Z"
		: "2026-01-01T01:00:00Z";
	const reviewedAt = futureChronology
		? "2098-01-01T02:00:00Z"
		: "2026-01-01T02:00:00Z";
	const frozenAt = futureChronology
		? "2098-01-01T02:30:00Z"
		: "2026-01-01T02:30:00Z";
	const cases = (["ko", "en", "ja"] as const).flatMap((language) =>
		(["update", "delete", "no-update"] as const).map((decision) => ({
			id: `pilot-${language}-${decision}`,
			familyId: `pilot-family-${language}-${decision}`,
			split: "development" as const,
			language,
			turns: [
				{
					content: `pilot-${language}-${decision}`,
					at: "2026-01-01T00:00:00Z",
				},
			],
			query: `pilot-query-${language}-${decision}`,
			expectedCurrentIds: ["current"],
			forbiddenStaleIds: ["stale"],
			expectedDeletedIds: decision === "delete" ? ["deleted"] : [],
			noUpdateIds: decision === "no-update" ? ["unchanged"] : [],
			expectedDecision: decision,
			provenance: {
				authorId: `pilot-author-${language}`,
				constructionClusterId: `pilot-construction-${language}-${decision}`,
				authorNativeLanguages: [language],
				authoredAt,
				reviewerId: `pilot-native-reviewer-${language}`,
				reviewerNativeLanguages: [language],
				reviewedAt,
				reviewDecision: "accepted" as const,
			},
		})),
	);
	const pilotContract: MemoryUpdateContract = {
		schemaVersion: "naia-memory-update-contract-v1",
		tier: "semantic-update-interpretation",
		construction: "independent-native-reviewed",
		familySplitFreeze: {
			frozenAt,
			digest: computeFamilySplitDigest(cases) as `sha256:${string}`,
		},
		cases,
	};
	const assumptions = {
		schemaVersion: "naia-memory-semantic-sample-size-assumptions-v4",
		languages: ["ko", "en", "ja"],
		competitors: ["hindsight", "mem0"],
		nullConstructionClusterExceedanceProbability: 0.5,
		alternativeConstructionClusterExceedanceProbability: {
			ko: { hindsight: 0.7, mem0: 0.7 },
			en: { hindsight: 0.7, mem0: 0.7 },
			ja: { hindsight: 0.7, mem0: 0.7 },
		},
		dependencyModel:
			"shared-uniform-within-cell-construction-cluster-shock-mixture",
		dependencyScenarios: [
			{ id: "independent", sharedCellShockProbability: 0 },
			{ id: "shock", sharedCellShockProbability: 0.1 },
		],
		candidateIndependentConstructionClustersByLanguage: [
			{ ko: 34, en: 34, ja: 34 },
		],
		simulationIterations: 1000,
		seed: 1,
		statement: "FROZEN_BEFORE_CAMPAIGN_EXECUTION",
	} satisfies SemanticSampleSizeAssumptions;
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	const collectionPlan = {
		schemaVersion: "naia-memory-semantic-pilot-collection-plan-v1" as const,
		publicContractSha256: evidenceObjectSha256(publicEvidenceContract),
		powerReviewerId: "external-power-reviewer",
		createdAt: "2025-12-31T00:00:00Z",
		assignments: cases.map((item) => ({
			assignmentId: item.id,
			language: item.language,
			decision: item.expectedDecision,
			authorId: item.provenance.authorId,
			reviewerId: item.provenance.reviewerId,
			constructionClusterId: item.provenance.constructionClusterId,
			causeIds: [`source-${item.language}`, `editor-${item.language}`],
		})),
	};
	const unsigned = {
		schemaVersion: "naia-memory-semantic-power-review-v1" as const,
		reviewer: "external-power-reviewer",
		pilotContractSha256: evidenceObjectSha256(pilotContract),
		publicContractSha256: evidenceObjectSha256(publicEvidenceContract),
		assumptionsSha256: evidenceObjectSha256(assumptions),
		collectionPlanSha256: evidenceObjectSha256(collectionPlan),
		pilotCompletedAt: futureChronology
			? "2098-01-01T03:00:00Z"
			: "2026-01-01T03:00:00Z",
		reviewedAt: futureChronology
			? "2098-01-03T00:00:00Z"
			: "2026-01-03T00:00:00Z",
		purpose: "POWER_ASSUMPTION_ESTIMATION_ONLY" as const,
		verdict: "APPROVED_FOR_PREREGISTRATION_ONLY" as const,
		independenceClaim: "ATTESTED_NOT_EMPIRICALLY_VERIFIED" as const,
		constructionClusters: cases.map((item) => ({
			constructionClusterId: item.provenance.constructionClusterId,
			language: item.language,
			causeIds: [`source-${item.language}`, `editor-${item.language}`],
		})),
		statement: "PILOT_DISJOINTNESS_AND_CONSTRUCTION_CAUSES_REVIEWED" as const,
	};
	const review = {
		...unsigned,
		signatureBase64: sign(
			null,
			evidenceSignaturePayload(unsigned),
			privateKey,
		).toString("base64"),
	};
	const paths = [
		join(directory, "power-pilot-collection-plan.json"),
		join(directory, "power-pilot-contract.json"),
		join(directory, "sample-size-assumptions.json"),
		join(directory, "power-review.json"),
		join(directory, "power-review-trust-policy.json"),
	];
	await Promise.all([
		writeFile(paths[0], JSON.stringify(collectionPlan)),
		writeFile(paths[1], JSON.stringify(pilotContract)),
		writeFile(paths[2], JSON.stringify(assumptions)),
		writeFile(paths[3], JSON.stringify(review)),
		writeFile(
			paths[4],
			JSON.stringify({
				reviewerPublicKeys: {
					"external-power-reviewer": publicKey
						.export({ type: "spki", format: "pem" })
						.toString(),
				},
			}),
		),
	]);
	return {
		paths,
		assumptionsSha256: evidenceObjectSha256(assumptions),
		collectionPlan,
		pilotContract,
	};
}
