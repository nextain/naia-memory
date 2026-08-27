import {
	MEMORY_PROPERTY_IDS,
	isMemoryPropertyId,
	isMemorySubjectId,
} from "../../memory/memory-identity-ontology.js";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";

export type QueryIdentityLanguage = "ko" | "en" | "ja";
export type QueryIdentityExpectation =
	| { kind: "identity"; subjectId: "person:self"; propertyId: string }
	| {
			kind: "abstain";
			reason: "ambiguous" | "out-of-ontology" | "not-personal";
	  };

export interface QueryIdentityOracleCase {
	id: string;
	language: QueryIdentityLanguage;
	query: string;
	familyId: string;
	split: "development" | "test";
	expectation: QueryIdentityExpectation;
	provenance: {
		authorId: string;
		authorNativeLanguages: QueryIdentityLanguage[];
		reviewerId: string;
		reviewerNativeLanguages: QueryIdentityLanguage[];
		reviewDecision: "accepted";
	};
}

export interface QueryIdentityOracle {
	schemaVersion: "naia-memory-query-identity-oracle-v1";
	construction: "independent-native-reviewed";
	cases: QueryIdentityOracleCase[];
}

export interface QueryIdentityPrediction {
	subjectId?: unknown;
	propertyId?: unknown;
}

export interface QueryIdentityPredictionArtifact {
	schemaVersion: "naia-memory-query-identity-predictions-v1";
	oracleSha256: string;
	launchReceiptSha256?: string;
	run: {
		engine: string;
		model: string;
		createdAt: string;
	};
	predictions: Array<{ caseId: string; prediction?: QueryIdentityPrediction }>;
}

export type QueryIdentityOutcome =
	| "correct-identity"
	| "correct-abstention"
	| "wrong-valid-identity"
	| "false-positive-on-abstention"
	| "unsupported-identity"
	| "partial-pair"
	| "invalid-output"
	| "missed-identity";

function isPortableIdentityToken(value: unknown): value is string {
	return (
		typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
	);
}

export function validateQueryIdentityOracle(oracle: QueryIdentityOracle): void {
	if (!oracle || typeof oracle !== "object" || Array.isArray(oracle))
		throw new Error("query identity oracle must be an object");
	if (oracle.schemaVersion !== "naia-memory-query-identity-oracle-v1")
		throw new Error("unsupported query identity oracle schema");
	if (oracle.construction !== "independent-native-reviewed")
		throw new Error(
			"oracle must be independently authored and native-reviewed",
		);
	if (!Array.isArray(oracle.cases))
		throw new Error("query identity oracle cases must be an array");
	const ids = new Set<string>();
	const queries = new Set<string>();
	const splitByFamily = new Map<string, string>();
	for (const current of oracle.cases) {
		if (!current || typeof current !== "object")
			throw new Error("oracle case must be an object");
		if (!isPortableIdentityToken(current.id) || ids.has(current.id))
			throw new Error(`duplicate case id: ${current.id}`);
		ids.add(current.id);
		if (typeof current.query !== "string")
			throw new Error(`${current.id}: query must be a string`);
		const query = current.query.normalize("NFKC").trim().toLocaleLowerCase();
		if (!query || queries.has(query))
			throw new Error(`${current.id}: duplicate or empty query`);
		queries.add(query);
		if (!["ko", "en", "ja"].includes(current.language))
			throw new Error(`${current.id}: invalid language`);
		if (current.split !== "development" && current.split !== "test")
			throw new Error(`${current.id}: invalid split`);
		if (!isPortableIdentityToken(current.familyId))
			throw new Error(`${current.id}: missing family id`);
		if (!current.provenance || typeof current.provenance !== "object")
			throw new Error(`${current.id}: missing provenance`);
		if (
			!isPortableIdentityToken(current.provenance.authorId) ||
			!isPortableIdentityToken(current.provenance.reviewerId) ||
			current.provenance.reviewDecision !== "accepted" ||
			!Array.isArray(current.provenance.authorNativeLanguages) ||
			!Array.isArray(current.provenance.reviewerNativeLanguages)
		)
			throw new Error(`${current.id}: invalid native-language provenance`);
		if (!current.provenance.authorNativeLanguages.includes(current.language))
			throw new Error(`${current.id}: author is not native in case language`);
		if (!current.provenance.reviewerNativeLanguages.includes(current.language))
			throw new Error(`${current.id}: reviewer is not native in case language`);
		if (current.provenance.authorId === current.provenance.reviewerId)
			throw new Error(`${current.id}: author and reviewer must be independent`);
		const existingSplit = splitByFamily.get(current.familyId);
		if (existingSplit && existingSplit !== current.split)
			throw new Error(`${current.id}: family leaks across splits`);
		splitByFamily.set(current.familyId, current.split);
		if (
			!current.expectation ||
			(current.expectation.kind !== "identity" &&
				current.expectation.kind !== "abstain")
		)
			throw new Error(`${current.id}: invalid expectation`);
		if (
			current.expectation.kind === "identity" &&
			(!isMemorySubjectId(current.expectation.subjectId) ||
				!isMemoryPropertyId(current.expectation.propertyId))
		)
			throw new Error(
				`${current.id}: expected identity is outside the closed vocabulary`,
			);
		if (
			current.expectation.kind === "abstain" &&
			!["ambiguous", "out-of-ontology", "not-personal"].includes(
				current.expectation.reason,
			)
		)
			throw new Error(`${current.id}: invalid abstention reason`);
	}
}

export function validateQueryIdentityPublicCoverage(
	oracle: QueryIdentityOracle,
): void {
	validateQueryIdentityOracle(oracle);
	const testCases = oracle.cases.filter((current) => current.split === "test");
	if (testCases.length < 100)
		throw new Error("public oracle requires at least 100 test cases");
	for (const language of ["ko", "en", "ja"] as const) {
		const languageCases = testCases.filter(
			(current) => current.language === language,
		);
		if (languageCases.length < 30)
			throw new Error(
				`public oracle requires at least 30 ${language} test cases`,
			);
		for (const kind of ["identity", "abstain"] as const)
			if (
				languageCases.filter((current) => current.expectation.kind === kind)
					.length < 10
			)
				throw new Error(
					`public oracle requires at least 10 ${language}/${kind} test cases`,
				);
		for (const reason of [
			"ambiguous",
			"out-of-ontology",
			"not-personal",
		] as const)
			if (
				languageCases.filter(
					(current) =>
						current.expectation.kind === "abstain" &&
						current.expectation.reason === reason,
				).length < 5
			)
				throw new Error(
					`public oracle requires at least 5 ${language}/${reason} abstentions`,
				);
		const representedProperties = new Set(
			languageCases.flatMap((current) =>
				current.expectation.kind === "identity"
					? [current.expectation.propertyId]
					: [],
			),
		);
		if (representedProperties.size < 10)
			throw new Error(
				`public oracle requires at least 10 distinct ${language} identity properties`,
			);
	}
}

export function scoreQueryIdentityPrediction(
	expectation: QueryIdentityExpectation,
	prediction: QueryIdentityPrediction | undefined,
): QueryIdentityOutcome {
	if (
		prediction !== undefined &&
		(!prediction || typeof prediction !== "object" || Array.isArray(prediction))
	)
		return "invalid-output";
	const hasSubject = prediction?.subjectId !== undefined;
	const hasProperty = prediction?.propertyId !== undefined;
	if (hasSubject !== hasProperty) return "partial-pair";
	if (!hasSubject)
		return expectation.kind === "abstain"
			? "correct-abstention"
			: "missed-identity";
	if (
		!isMemorySubjectId(prediction?.subjectId) ||
		!isMemoryPropertyId(prediction?.propertyId)
	)
		return "unsupported-identity";
	if (expectation.kind === "abstain") return "false-positive-on-abstention";
	return prediction?.subjectId === expectation.subjectId &&
		prediction.propertyId === expectation.propertyId
		? "correct-identity"
		: "wrong-valid-identity";
}

export const QUERY_IDENTITY_PROPERTY_IDS = MEMORY_PROPERTY_IDS;

export function buildQueryIdentityBlindPacket(oracle: QueryIdentityOracle) {
	validateQueryIdentityPublicCoverage(oracle);
	const oracleSha256 = evidenceObjectSha256(oracle);
	return {
		schemaVersion: "naia-memory-query-identity-blind-packet-v1" as const,
		oracleSha256,
		cases: oracle.cases
			.filter((current) => current.split === "test")
			.map(({ id: caseId, language, query }) => ({ caseId, language, query })),
	};
}

const OUTCOMES: readonly QueryIdentityOutcome[] = [
	"correct-identity",
	"correct-abstention",
	"wrong-valid-identity",
	"false-positive-on-abstention",
	"unsupported-identity",
	"partial-pair",
	"invalid-output",
	"missed-identity",
];

function ratio(numerator: number, denominator: number): number {
	if (denominator === 0) throw new Error("metric denominator must be positive");
	return numerator / denominator;
}

function wilson95(successes: number, total: number) {
	if (total === 0)
		throw new Error("confidence interval denominator must be positive");
	const z = 1.959963984540054;
	const observed = successes / total;
	const denominator = 1 + (z * z) / total;
	const center = (observed + (z * z) / (2 * total)) / denominator;
	const margin =
		(z / denominator) *
		Math.sqrt(
			(observed * (1 - observed)) / total + (z * z) / (4 * total * total),
		);
	return {
		lower: Math.max(0, center - margin),
		upper: Math.min(1, center + margin),
	};
}

export function scoreQueryIdentityArtifact(
	oracle: QueryIdentityOracle,
	artifact: QueryIdentityPredictionArtifact,
) {
	validateQueryIdentityPublicCoverage(oracle);
	const oracleSha256 = evidenceObjectSha256(oracle);
	if (!artifact || typeof artifact !== "object" || Array.isArray(artifact))
		throw new Error("prediction artifact must be an object");
	if (artifact.schemaVersion !== "naia-memory-query-identity-predictions-v1")
		throw new Error("unsupported query identity prediction schema");
	if (artifact.oracleSha256 !== oracleSha256)
		throw new Error("prediction artifact oracle hash mismatch");
	if (
		!artifact.run ||
		typeof artifact.run !== "object" ||
		typeof artifact.run.engine !== "string" ||
		!artifact.run.engine.trim() ||
		typeof artifact.run.model !== "string" ||
		!artifact.run.model.trim() ||
		typeof artifact.run.createdAt !== "string"
	)
		throw new Error("prediction artifact run identity is required");
	if (Number.isNaN(Date.parse(artifact.run.createdAt)))
		throw new Error("prediction artifact createdAt is invalid");
	if (!Array.isArray(artifact.predictions))
		throw new Error("prediction artifact predictions must be an array");
	const predictions = new Map<string, QueryIdentityPrediction | undefined>();
	for (const current of artifact.predictions) {
		if (
			!current ||
			typeof current !== "object" ||
			typeof current.caseId !== "string" ||
			predictions.has(current.caseId)
		)
			throw new Error(
				`duplicate or invalid prediction case id: ${current?.caseId}`,
			);
		predictions.set(current.caseId, current.prediction);
	}
	const testCases = oracle.cases.filter((current) => current.split === "test");
	const expectedIds = new Set(testCases.map((current) => current.id));
	for (const id of predictions.keys())
		if (!expectedIds.has(id))
			throw new Error(`unexpected prediction case id: ${id}`);
	for (const id of expectedIds)
		if (!predictions.has(id))
			throw new Error(`missing prediction case id: ${id}`);

	const rows = testCases.map((current) => ({
		caseId: current.id,
		language: current.language,
		expectationKind: current.expectation.kind,
		outcome: scoreQueryIdentityPrediction(
			current.expectation,
			predictions.get(current.id),
		),
	}));
	const summarize = (selected: typeof rows) => {
		const outcomes = Object.fromEntries(
			OUTCOMES.map((outcome) => [
				outcome,
				selected.filter((row) => row.outcome === outcome).length,
			]),
		) as Record<QueryIdentityOutcome, number>;
		const identities = selected.filter(
			(row) => row.expectationKind === "identity",
		);
		const abstentions = selected.filter(
			(row) => row.expectationKind === "abstain",
		);
		return {
			total: selected.length,
			outcomes,
			overallAccuracy: ratio(
				outcomes["correct-identity"] + outcomes["correct-abstention"],
				selected.length,
			),
			identityAccuracy: ratio(outcomes["correct-identity"], identities.length),
			identityAccuracyWilson95: wilson95(
				outcomes["correct-identity"],
				identities.length,
			),
			abstentionAccuracy: ratio(
				outcomes["correct-abstention"],
				abstentions.length,
			),
			abstentionAccuracyWilson95: wilson95(
				outcomes["correct-abstention"],
				abstentions.length,
			),
			unsafeIdentityRate: ratio(
				outcomes["wrong-valid-identity"] +
					outcomes["false-positive-on-abstention"] +
					outcomes["unsupported-identity"] +
					outcomes["partial-pair"],
				selected.length,
			),
		};
	};
	const byLanguage = Object.fromEntries(
		(["ko", "en", "ja"] as const).map((language) => [
			language,
			summarize(rows.filter((row) => row.language === language)),
		]),
	);
	const gate = Object.values(byLanguage).every(
		(current) =>
			current.identityAccuracy >= 0.95 &&
			current.abstentionAccuracy >= 0.95 &&
			current.unsafeIdentityRate <= 0.01,
	);
	return {
		schemaVersion: "naia-memory-query-identity-score-v1" as const,
		evidenceAssurance: {
			level: "scoring-only" as const,
			oraclePriorExistenceVerified: false as const,
			hiddenPacketDeliveryVerified: false as const,
			predictionChronologyVerified: false as const,
		},
		scoringPolicyVersion: "query-identity-point-gate-wilson-report-v1" as const,
		oracleSha256,
		predictionSha256: evidenceObjectSha256(artifact),
		run: artifact.run,
		thresholds: {
			minimumIdentityAccuracyPerLanguage: 0.95,
			minimumAbstentionAccuracyPerLanguage: 0.95,
			maximumUnsafeIdentityRatePerLanguage: 0.01,
		},
		overall: summarize(rows),
		byLanguage,
		gate: gate ? "pass" : "fail",
	};
}
