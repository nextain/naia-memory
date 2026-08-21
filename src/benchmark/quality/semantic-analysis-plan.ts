import { createPublicKey } from "node:crypto";
import type { MemoryUpdateContract } from "./memory-update-contract.js";
import {
	evidenceObjectSha256,
	hasValidEvidenceSignature,
} from "./public-evidence-crypto.js";

const SHA256 = /^[a-f0-9]{64}$/;

export type SemanticAnalysisPlan = {
	schemaVersion: "naia-memory-semantic-analysis-plan-v1";
	administrator: string;
	contractSha256: string;
	engines: string[];
	primaryEngine: "naia";
	primaryMetric: "currentAt1" | "staleExposureRate" | "deletionLeakageRate";
	primaryComparisons: string[];
	familyWiseAlpha: number;
	multiplicityAdjustment: "holm";
	targetPower: number;
	minimumDetectableDifference: number;
	requiredIndependentFamiliesByLanguage: Record<string, number>;
	sampleSizeMethod: string;
	sampleSizeAssumptionsSha256: string;
	stoppingRule: "collect-all-frozen-test-families-no-outcome-peeking";
	createdAt: string;
	signedAt: string;
	statement: "ANALYSIS_PLAN_PREREGISTERED";
	signatureBase64: string;
};

export type SemanticAnalysisPlanTrustPolicy = {
	administratorPublicKeys: Record<string, string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validUniqueStrings(value: unknown): value is string[] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		new Set(value).size === value.length &&
		value.every((item) => typeof item === "string" && item.trim().length > 0)
	);
}

function isEd25519Key(value: unknown): value is string {
	if (typeof value !== "string") return false;
	try {
		return createPublicKey(value).asymmetricKeyType === "ed25519";
	} catch {
		return false;
	}
}

export function isSemanticAnalysisPlan(
	value: unknown,
): value is SemanticAnalysisPlan {
	return (
		isRecord(value) &&
		value.schemaVersion === "naia-memory-semantic-analysis-plan-v1" &&
		typeof value.administrator === "string" &&
		value.administrator.trim().length > 0 &&
		typeof value.contractSha256 === "string" &&
		SHA256.test(value.contractSha256) &&
		validUniqueStrings(value.engines) &&
		value.primaryEngine === "naia" &&
		["currentAt1", "staleExposureRate", "deletionLeakageRate"].includes(
			value.primaryMetric as string,
		) &&
		validUniqueStrings(value.primaryComparisons) &&
		typeof value.familyWiseAlpha === "number" &&
		Number.isFinite(value.familyWiseAlpha) &&
		value.familyWiseAlpha > 0 &&
		value.familyWiseAlpha < 1 &&
		value.multiplicityAdjustment === "holm" &&
		typeof value.targetPower === "number" &&
		Number.isFinite(value.targetPower) &&
		value.targetPower >= 0.8 &&
		value.targetPower < 1 &&
		typeof value.minimumDetectableDifference === "number" &&
		Number.isFinite(value.minimumDetectableDifference) &&
		value.minimumDetectableDifference > 0 &&
		value.minimumDetectableDifference <= 1 &&
		isRecord(value.requiredIndependentFamiliesByLanguage) &&
		Object.values(value.requiredIndependentFamiliesByLanguage).every(
			(count) => Number.isInteger(count) && Number(count) > 0,
		) &&
		typeof value.sampleSizeMethod === "string" &&
		value.sampleSizeMethod.trim().length > 0 &&
		typeof value.sampleSizeAssumptionsSha256 === "string" &&
		SHA256.test(value.sampleSizeAssumptionsSha256) &&
		value.stoppingRule ===
			"collect-all-frozen-test-families-no-outcome-peeking" &&
		typeof value.createdAt === "string" &&
		typeof value.signedAt === "string" &&
		value.statement === "ANALYSIS_PLAN_PREREGISTERED" &&
		typeof value.signatureBase64 === "string"
	);
}

export function isSemanticAnalysisPlanTrustPolicy(
	value: unknown,
): value is SemanticAnalysisPlanTrustPolicy {
	return (
		isRecord(value) &&
		isRecord(value.administratorPublicKeys) &&
		Object.keys(value.administratorPublicKeys).length > 0 &&
		Object.entries(value.administratorPublicKeys).every(
			([identity, key]) => identity.trim().length > 0 && isEd25519Key(key),
		)
	);
}

export function validateSemanticAnalysisPlan(input: {
	contract: MemoryUpdateContract;
	plan: SemanticAnalysisPlan;
	trustPolicy: SemanticAnalysisPlanTrustPolicy;
	campaign: Record<string, unknown>;
	firstExecutionStartedAt: string;
	forbiddenTrustIdentities?: Iterable<string>;
	forbiddenTrustPublicKeys?: Iterable<string>;
}): {
	analysisPlanIntegrityQualified: true;
	plannedFamilyCount: number;
	sampleSizeAdequacyVerified: false;
	trustedTimestampVerified: false;
} {
	const disclosure = input.campaign.disclosure;
	if (!isRecord(disclosure) || !validUniqueStrings(disclosure.engines))
		throw new Error("semantic analysis plan campaign shape is invalid");
	const plan = input.plan;
	const publicKey =
		input.trustPolicy.administratorPublicKeys[plan.administrator];
	const createdAt = Date.parse(plan.createdAt);
	const signedAt = Date.parse(plan.signedAt);
	const executionStartedAt = Date.parse(input.firstExecutionStartedAt);
	if (
		plan.contractSha256 !== evidenceObjectSha256(input.contract) ||
		plan.engines.length !== disclosure.engines.length ||
		plan.engines.some(
			(engine, index) => engine !== disclosure.engines[index],
		) ||
		plan.primaryComparisons.length !== plan.engines.length - 1 ||
		plan.primaryComparisons.some(
			(engine) =>
				engine === plan.primaryEngine || !plan.engines.includes(engine),
		) ||
		!plan.engines.includes(plan.primaryEngine) ||
		!Number.isFinite(createdAt) ||
		!Number.isFinite(signedAt) ||
		!Number.isFinite(executionStartedAt) ||
		signedAt < createdAt ||
		signedAt >= executionStartedAt ||
		!publicKey ||
		!hasValidEvidenceSignature(plan, publicKey)
	)
		throw new Error("semantic analysis plan content is invalid");
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
		forbiddenIdentities.has(plan.administrator) ||
		forbiddenKeys.has(normalizedKey)
	)
		throw new Error("semantic analysis administrator overlaps another role");
	const testCases = input.contract.cases.filter(
		(item) => item.split === "test",
	);
	const languages = [...new Set(testCases.map((item) => item.language))].sort();
	if (
		Object.keys(plan.requiredIndependentFamiliesByLanguage)
			.sort()
			.join("\0") !== languages.join("\0")
	)
		throw new Error("semantic analysis plan language coverage is invalid");
	for (const language of languages) {
		const actual = new Set(
			testCases
				.filter((item) => item.language === language)
				.map((item) => item.familyId),
		).size;
		if (actual < (plan.requiredIndependentFamiliesByLanguage[language] ?? 0))
			throw new Error("semantic analysis plan sample-size target is unmet");
	}
	return {
		analysisPlanIntegrityQualified: true,
		plannedFamilyCount: Object.values(
			plan.requiredIndependentFamiliesByLanguage,
		).reduce((sum, count) => sum + count, 0),
		sampleSizeAdequacyVerified: false,
		trustedTimestampVerified: false,
	};
}
