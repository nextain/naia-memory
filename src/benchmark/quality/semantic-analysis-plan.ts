import { createPublicKey } from "node:crypto";
import type { MemoryUpdateContract } from "./memory-update-contract.js";
import {
	evidenceObjectSha256,
	hasValidEvidenceSignature,
} from "./public-evidence-crypto.js";

const SHA256 = /^[a-f0-9]{64}$/;

export type SemanticAnalysisPlan = {
	schemaVersion: "naia-memory-semantic-analysis-plan-v5";
	administrator: string;
	contractSha256: string;
	engines: string[];
	primaryEngine: "naia";
	primaryMetric: "currentAt1" | "staleExposureRate" | "deletionLeakageRate";
	primaryComparisons: string[];
	claimScope:
		| "direct-lifecycle-competitive-report-v1"
		| "declared-multi-class-competitive-report-v1";
	comparisonLanes: {
		directLifecycle: Array<"hindsight" | "mem0">;
		nativeTemporalCharacterization: [] | ["graphiti-historical"];
		agentManagedCharacterization: [] | ["letta"];
		productIntegrationDiagnostic: [] | ["graphiti"];
	};
	crossLaneAggregation: "prohibited";
	familyWiseAlpha: number;
	multiplicityAdjustment: "holm";
	targetPower: number;
	minimumDetectableDifference: number;
	minimumPracticallyImportantDifference: number;
	decisionRule: "holm-all-language-competitor-superiority";
	requiredIndependentAuthorClustersByLanguage: Record<string, number>;
	requiredIndependentConstructionClustersByLanguage: Record<string, number>;
	independenceUnit: "construction-cluster";
	sensitivityAnalysis: "author-equal-and-family-equal-directional-agreement";
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

export function hasValidSemanticComparisonLanes(
	value: unknown,
	claimScope: unknown,
): value is SemanticAnalysisPlan["comparisonLanes"] {
	if (!isRecord(value)) return false;
	const direct = value.directLifecycle;
	const nativeTemporal = value.nativeTemporalCharacterization;
	const agentManaged = value.agentManagedCharacterization;
	const productDiagnostic = value.productIntegrationDiagnostic;
	const validDirect =
		validUniqueStrings(direct) &&
		direct.every((engine) => ["hindsight", "mem0"].includes(engine));
	const validNative =
		Array.isArray(nativeTemporal) &&
		(nativeTemporal.length === 0 ||
			(nativeTemporal.length === 1 &&
				nativeTemporal[0] === "graphiti-historical"));
	const validAgent =
		Array.isArray(agentManaged) &&
		(agentManaged.length === 0 ||
			(agentManaged.length === 1 && agentManaged[0] === "letta"));
	const validDiagnostic =
		Array.isArray(productDiagnostic) &&
		(productDiagnostic.length === 0 ||
			(productDiagnostic.length === 1 && productDiagnostic[0] === "graphiti"));
	if (!validDirect || !validNative || !validAgent || !validDiagnostic)
		return false;
	return claimScope === "declared-multi-class-competitive-report-v1"
		? direct.length === 2 &&
				nativeTemporal.length === 1 &&
				agentManaged.length === 1
		: claimScope === "direct-lifecycle-competitive-report-v1" &&
				nativeTemporal.length === 0 &&
				agentManaged.length === 0;
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
		value.schemaVersion === "naia-memory-semantic-analysis-plan-v5" &&
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
		[
			"direct-lifecycle-competitive-report-v1",
			"declared-multi-class-competitive-report-v1",
		].includes(value.claimScope as string) &&
		hasValidSemanticComparisonLanes(value.comparisonLanes, value.claimScope) &&
		value.crossLaneAggregation === "prohibited" &&
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
		typeof value.minimumPracticallyImportantDifference === "number" &&
		Number.isFinite(value.minimumPracticallyImportantDifference) &&
		value.minimumPracticallyImportantDifference > 0 &&
		value.minimumPracticallyImportantDifference < 1 &&
		value.minimumDetectableDifference <=
			value.minimumPracticallyImportantDifference &&
		value.decisionRule === "holm-all-language-competitor-superiority" &&
		isRecord(value.requiredIndependentAuthorClustersByLanguage) &&
		Object.values(value.requiredIndependentAuthorClustersByLanguage).every(
			(count) => Number.isInteger(count) && Number(count) > 0,
		) &&
		isRecord(value.requiredIndependentConstructionClustersByLanguage) &&
		Object.values(
			value.requiredIndependentConstructionClustersByLanguage,
		).every((count) => Number.isInteger(count) && Number(count) > 0) &&
		value.independenceUnit === "construction-cluster" &&
		value.sensitivityAnalysis ===
			"author-equal-and-family-equal-directional-agreement" &&
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
	claimScope: SemanticAnalysisPlan["claimScope"];
	comparisonLanes: SemanticAnalysisPlan["comparisonLanes"];
	crossLaneAggregation: "prohibited";
	plannedIndependentAuthorClusterCount: number;
	plannedIndependentConstructionClusterCount: number;
	sampleSizeAdequacyVerified: false;
	analysisPlanTrustedTimestampVerified: false;
} {
	const disclosure = input.campaign.disclosure;
	const planSha256 = evidenceObjectSha256(input.plan);
	if (
		!isRecord(disclosure) ||
		!validUniqueStrings(disclosure.engines) ||
		input.campaign.schemaVersion !== "naia-memory-semantic-campaign-v4" ||
		disclosure.analysisPlanSha256 !== planSha256 ||
		disclosure.claimScope !== input.plan.claimScope ||
		JSON.stringify(disclosure.comparisonLanes) !==
			JSON.stringify(input.plan.comparisonLanes) ||
		disclosure.crossLaneAggregation !== input.plan.crossLaneAggregation
	)
		throw new Error("semantic analysis plan campaign shape is invalid");
	const plan = input.plan;
	const lanes = plan.comparisonLanes;
	const isMultiClassClaim =
		plan.claimScope === "declared-multi-class-competitive-report-v1";
	const validDirect =
		lanes.directLifecycle.length > 0 &&
		new Set(lanes.directLifecycle).size === lanes.directLifecycle.length &&
		lanes.directLifecycle.every((engine) =>
			["hindsight", "mem0"].includes(engine),
		) &&
		(!isMultiClassClaim ||
			["hindsight", "mem0"].every((engine) =>
				lanes.directLifecycle.includes(engine as "hindsight" | "mem0"),
			));
	const validNativeTemporal = isMultiClassClaim
		? lanes.nativeTemporalCharacterization.length === 1 &&
			lanes.nativeTemporalCharacterization[0] === "graphiti-historical"
		: lanes.nativeTemporalCharacterization.length === 0;
	const validAgentManaged = isMultiClassClaim
		? lanes.agentManagedCharacterization.length === 1 &&
			lanes.agentManagedCharacterization[0] === "letta"
		: lanes.agentManagedCharacterization.length === 0;
	const validProductIntegration =
		lanes.productIntegrationDiagnostic.length === 0 ||
		(lanes.productIntegrationDiagnostic.length === 1 &&
			lanes.productIntegrationDiagnostic[0] === "graphiti");
	const scopedEngines = [
		...lanes.directLifecycle,
		...lanes.nativeTemporalCharacterization,
		...lanes.agentManagedCharacterization,
		...lanes.productIntegrationDiagnostic,
		plan.primaryEngine,
	];
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
		!validDirect ||
		!validNativeTemporal ||
		!validAgentManaged ||
		!validProductIntegration ||
		new Set(scopedEngines).size !== scopedEngines.length ||
		scopedEngines.length !== plan.engines.length ||
		scopedEngines.some((engine) => !plan.engines.includes(engine)) ||
		plan.primaryComparisons.length !== lanes.directLifecycle.length ||
		plan.primaryComparisons.some(
			(engine) =>
				!lanes.directLifecycle.includes(engine as "hindsight" | "mem0"),
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
		Object.keys(plan.requiredIndependentAuthorClustersByLanguage)
			.sort()
			.join("\0") !== languages.join("\0")
	)
		throw new Error("semantic analysis plan language coverage is invalid");
	if (
		Object.keys(plan.requiredIndependentConstructionClustersByLanguage)
			.sort()
			.join("\0") !== languages.join("\0")
	)
		throw new Error(
			"semantic analysis plan construction-cluster coverage is invalid",
		);
	for (const language of languages) {
		const languageCases = testCases.filter(
			(item) => item.language === language,
		);
		if (
			languageCases.some(
				(item) =>
					typeof item.provenance?.authorId !== "string" ||
					item.provenance.authorId.trim().length === 0 ||
					typeof item.provenance.constructionClusterId !== "string" ||
					item.provenance.constructionClusterId.trim().length === 0,
			)
		)
			throw new Error("semantic analysis plan provenance cluster is invalid");
		const actual = new Set(
			languageCases.map((item) => item.provenance?.authorId),
		).size;
		if (
			actual < (plan.requiredIndependentAuthorClustersByLanguage[language] ?? 0)
		)
			throw new Error("semantic analysis plan sample-size target is unmet");
		const constructionClusters = new Set(
			languageCases.map((item) => item.provenance?.constructionClusterId),
		).size;
		if (
			constructionClusters <
			(plan.requiredIndependentConstructionClustersByLanguage[language] ?? 0)
		)
			throw new Error(
				"semantic analysis plan construction-cluster target is unmet",
			);
	}
	return {
		analysisPlanIntegrityQualified: true,
		claimScope: plan.claimScope,
		comparisonLanes: plan.comparisonLanes,
		crossLaneAggregation: plan.crossLaneAggregation,
		plannedIndependentAuthorClusterCount: Object.values(
			plan.requiredIndependentAuthorClustersByLanguage,
		).reduce((sum, count) => sum + count, 0),
		plannedIndependentConstructionClusterCount: Object.values(
			plan.requiredIndependentConstructionClustersByLanguage,
		).reduce((sum, count) => sum + count, 0),
		sampleSizeAdequacyVerified: false,
		analysisPlanTrustedTimestampVerified: false,
	};
}
