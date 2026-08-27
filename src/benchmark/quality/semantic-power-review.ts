import { createPublicKey } from "node:crypto";
import type {
	MemoryUpdateCase,
	MemoryUpdateContract,
} from "./memory-update-contract.js";
import { validateMemoryUpdateContract } from "./memory-update-contract.js";
import {
	evidenceObjectSha256,
	hasValidEvidenceSignature,
} from "./public-evidence-crypto.js";
import type { SemanticAnalysisPlan } from "./semantic-analysis-plan.js";
import type { SemanticSampleSizeAssumptions } from "./semantic-sample-size-simulation.js";

const SHA256 = /^[a-f0-9]{64}$/;

export type SemanticPowerReview = {
	schemaVersion: "naia-memory-semantic-power-review-v1";
	reviewer: string;
	pilotContractSha256: string;
	publicContractSha256: string;
	assumptionsSha256: string;
	collectionPlanSha256: string;
	pilotCompletedAt: string;
	reviewedAt: string;
	purpose: "POWER_ASSUMPTION_ESTIMATION_ONLY";
	verdict: "APPROVED_FOR_PREREGISTRATION_ONLY";
	independenceClaim: "ATTESTED_NOT_EMPIRICALLY_VERIFIED";
	constructionClusters: Array<{
		constructionClusterId: string;
		language: string;
		causeIds: string[];
	}>;
	statement: "PILOT_DISJOINTNESS_AND_CONSTRUCTION_CAUSES_REVIEWED";
	signatureBase64: string;
};

export type SemanticPowerReviewTrustPolicy = {
	reviewerPublicKeys: Record<string, string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEd25519Key(value: unknown): value is string {
	if (typeof value !== "string") return false;
	try {
		return createPublicKey(value).asymmetricKeyType === "ed25519";
	} catch {
		return false;
	}
}

function uniqueStrings(value: unknown): value is string[] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		new Set(value).size === value.length &&
		value.every((item) => typeof item === "string" && item.trim().length > 0)
	);
}

export function isSemanticPowerReview(
	value: unknown,
): value is SemanticPowerReview {
	return (
		isRecord(value) &&
		value.schemaVersion === "naia-memory-semantic-power-review-v1" &&
		typeof value.reviewer === "string" &&
		value.reviewer.trim().length > 0 &&
		typeof value.pilotContractSha256 === "string" &&
		SHA256.test(value.pilotContractSha256) &&
		typeof value.publicContractSha256 === "string" &&
		SHA256.test(value.publicContractSha256) &&
		typeof value.assumptionsSha256 === "string" &&
		SHA256.test(value.assumptionsSha256) &&
		typeof value.collectionPlanSha256 === "string" &&
		SHA256.test(value.collectionPlanSha256) &&
		typeof value.pilotCompletedAt === "string" &&
		typeof value.reviewedAt === "string" &&
		value.purpose === "POWER_ASSUMPTION_ESTIMATION_ONLY" &&
		value.verdict === "APPROVED_FOR_PREREGISTRATION_ONLY" &&
		value.independenceClaim === "ATTESTED_NOT_EMPIRICALLY_VERIFIED" &&
		Array.isArray(value.constructionClusters) &&
		value.constructionClusters.length > 0 &&
		value.constructionClusters.every(
			(cluster) =>
				isRecord(cluster) &&
				typeof cluster.constructionClusterId === "string" &&
				cluster.constructionClusterId.trim().length > 0 &&
				typeof cluster.language === "string" &&
				cluster.language.trim().length > 0 &&
				uniqueStrings(cluster.causeIds),
		) &&
		value.statement === "PILOT_DISJOINTNESS_AND_CONSTRUCTION_CAUSES_REVIEWED" &&
		typeof value.signatureBase64 === "string"
	);
}

export function isSemanticPowerReviewTrustPolicy(
	value: unknown,
): value is SemanticPowerReviewTrustPolicy {
	if (!isRecord(value) || !isRecord(value.reviewerPublicKeys)) return false;
	const entries = Object.entries(value.reviewerPublicKeys);
	if (
		entries.length === 0 ||
		!entries.every(
			([identity, key]) => identity.trim().length > 0 && isEd25519Key(key),
		)
	)
		return false;
	const normalizedKeys = entries.map(([, key]) =>
		createPublicKey(key as string)
			.export({ type: "spki", format: "der" })
			.toString("base64"),
	);
	return new Set(normalizedKeys).size === normalizedKeys.length;
}

function normalizedText(value: string): string {
	return value
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[\p{P}\p{S}\s]/gu, "");
}

function semanticFingerprint(item: MemoryUpdateCase): string {
	return evidenceObjectSha256({
		language: item.language,
		turns: item.turns.map(({ content }) => normalizedText(content)),
		query: normalizedText(item.query),
		expectedCurrentIds: item.expectedCurrentIds,
		forbiddenStaleIds: item.forbiddenStaleIds,
		expectedDeletedIds: item.expectedDeletedIds,
		noUpdateIds: item.noUpdateIds,
		expectedDecision: item.expectedDecision,
		lifecycleOperations: item.lifecycleOperations?.map((operation) => ({
			...operation,
			content:
				"content" in operation && typeof operation.content === "string"
					? normalizedText(operation.content)
					: undefined,
			at: undefined,
		})),
	});
}

export function validateSemanticPowerReview(input: {
	pilotContract: MemoryUpdateContract;
	publicContract: MemoryUpdateContract;
	assumptions: SemanticSampleSizeAssumptions;
	plan: SemanticAnalysisPlan;
	review: SemanticPowerReview;
	trustPolicy: SemanticPowerReviewTrustPolicy;
	forbiddenTrustIdentities?: Iterable<string>;
	forbiddenTrustPublicKeys?: Iterable<string>;
}): {
	powerReviewQualified: true;
	reviewedConstructionClusterCount: number;
	constructionCauseIndependenceVerified: false;
} {
	const { review } = input;
	validateMemoryUpdateContract(input.pilotContract);
	validateMemoryUpdateContract(input.publicContract);
	const publicKey = input.trustPolicy.reviewerPublicKeys[review.reviewer];
	if (
		review.pilotContractSha256 !== evidenceObjectSha256(input.pilotContract) ||
		review.publicContractSha256 !==
			evidenceObjectSha256(input.publicContract) ||
		review.assumptionsSha256 !== evidenceObjectSha256(input.assumptions) ||
		review.assumptionsSha256 !== input.plan.sampleSizeAssumptionsSha256 ||
		!publicKey ||
		!hasValidEvidenceSignature(review, publicKey)
	)
		throw new Error("semantic power review content is invalid");
	if (
		input.pilotContract.tier !== "semantic-update-interpretation" ||
		input.pilotContract.construction !== "independent-native-reviewed" ||
		input.pilotContract.cases.some((item) => item.split !== "development")
	)
		throw new Error("semantic power pilot must contain development cases only");
	if (
		input.publicContract.tier !== "semantic-update-interpretation" ||
		input.publicContract.construction !== "independent-native-reviewed" ||
		input.publicContract.cases.some((item) => item.split !== "test")
	)
		throw new Error(
			"semantic power public corpus must contain test cases only",
		);
	const pilotCompletedAt = Date.parse(review.pilotCompletedAt);
	const reviewedAt = Date.parse(review.reviewedAt);
	const planSignedAt = Date.parse(input.plan.signedAt);
	const latestPilotReview = Math.max(
		...input.pilotContract.cases.map((item) =>
			Date.parse(item.provenance?.reviewedAt ?? ""),
		),
	);
	if (
		!Number.isFinite(pilotCompletedAt) ||
		!Number.isFinite(reviewedAt) ||
		!Number.isFinite(planSignedAt) ||
		!Number.isFinite(latestPilotReview) ||
		pilotCompletedAt < latestPilotReview ||
		reviewedAt < pilotCompletedAt ||
		reviewedAt >= planSignedAt
	)
		throw new Error("semantic power review chronology is invalid");
	const pilotFamilies = new Set(
		input.pilotContract.cases.map((item) => item.familyId),
	);
	if (
		input.publicContract.cases.some((item) => pilotFamilies.has(item.familyId))
	)
		throw new Error("semantic power pilot and public families overlap");
	const pilotCaseIds = new Set(
		input.pilotContract.cases.map((item) => item.id),
	);
	if (input.publicContract.cases.some((item) => pilotCaseIds.has(item.id)))
		throw new Error("semantic power pilot and public case IDs overlap");
	const pilotCorpusRoles = new Set(
		input.pilotContract.cases.flatMap((item) => [
			item.provenance?.authorId,
			item.provenance?.reviewerId,
		]),
	);
	if (pilotCorpusRoles.has(review.reviewer))
		throw new Error("semantic power reviewer is a pilot corpus participant");
	const publicCorpusRoles = new Set(
		input.publicContract.cases.flatMap((item) => [
			item.provenance?.authorId,
			item.provenance?.reviewerId,
		]),
	);
	if (publicCorpusRoles.has(review.reviewer))
		throw new Error("semantic power reviewer is a public corpus participant");
	if (
		input.publicContract.cases.some(
			(item) =>
				pilotCorpusRoles.has(item.provenance?.authorId) ||
				pilotCorpusRoles.has(item.provenance?.reviewerId),
		)
	)
		throw new Error("semantic power pilot and public corpus roles overlap");
	const pilotConstructionClusters = new Set(
		input.pilotContract.cases.map(
			(item) => item.provenance?.constructionClusterId,
		),
	);
	if (
		input.publicContract.cases.some((item) =>
			pilotConstructionClusters.has(item.provenance?.constructionClusterId),
		)
	)
		throw new Error(
			"semantic power pilot and public construction clusters overlap",
		);
	const pilotFingerprints = new Set(
		input.pilotContract.cases.map(semanticFingerprint),
	);
	if (
		input.publicContract.cases.some((item) =>
			pilotFingerprints.has(semanticFingerprint(item)),
		)
	)
		throw new Error("semantic power pilot and public case content overlap");
	const expectedClusters = new Set(
		input.pilotContract.cases.map(
			(item) =>
				`${item.language}\0${item.provenance?.constructionClusterId ?? ""}`,
		),
	);
	const reviewedClusters = new Set(
		review.constructionClusters.map(
			(item) => `${item.language}\0${item.constructionClusterId}`,
		),
	);
	if (
		expectedClusters.size !== reviewedClusters.size ||
		[...expectedClusters].some((cluster) => !reviewedClusters.has(cluster))
	)
		throw new Error("semantic power review construction clusters mismatch");
	const forbiddenIdentities = new Set(input.forbiddenTrustIdentities ?? []);
	const normalizedKey = createPublicKey(publicKey)
		.export({ type: "spki", format: "der" })
		.toString("base64");
	const forbiddenKeys = new Set(
		[...(input.forbiddenTrustPublicKeys ?? [])].map((key) =>
			createPublicKey(key)
				.export({ type: "spki", format: "der" })
				.toString("base64"),
		),
	);
	if (
		forbiddenIdentities.has(review.reviewer) ||
		forbiddenKeys.has(normalizedKey)
	)
		throw new Error("semantic power reviewer overlaps another role");
	return {
		powerReviewQualified: true,
		reviewedConstructionClusterCount: reviewedClusters.size,
		constructionCauseIndependenceVerified: false,
	};
}
