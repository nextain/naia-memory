import {
	MEMORY_PROPERTY_IDS,
	isMemoryPropertyId,
	isMemorySubjectId,
} from "../../memory/memory-identity-ontology.js";

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

export type QueryIdentityOutcome =
	| "correct-identity"
	| "correct-abstention"
	| "wrong-valid-identity"
	| "false-positive-on-abstention"
	| "unsupported-identity"
	| "partial-pair"
	| "invalid-output"
	| "missed-identity";

export function validateQueryIdentityOracle(oracle: QueryIdentityOracle): void {
	if (oracle.schemaVersion !== "naia-memory-query-identity-oracle-v1")
		throw new Error("unsupported query identity oracle schema");
	if (oracle.construction !== "independent-native-reviewed")
		throw new Error(
			"oracle must be independently authored and native-reviewed",
		);
	const ids = new Set<string>();
	const queries = new Set<string>();
	const splitByFamily = new Map<string, string>();
	for (const current of oracle.cases) {
		if (!current || typeof current !== "object")
			throw new Error("oracle case must be an object");
		if (!current.id || ids.has(current.id))
			throw new Error(`duplicate case id: ${current.id}`);
		ids.add(current.id);
		const query = current.query.normalize("NFKC").trim().toLocaleLowerCase();
		if (!query || queries.has(query))
			throw new Error(`${current.id}: duplicate or empty query`);
		queries.add(query);
		if (current.split !== "development" && current.split !== "test")
			throw new Error(`${current.id}: invalid split`);
		if (!current.familyId) throw new Error(`${current.id}: missing family id`);
		if (!current.provenance || typeof current.provenance !== "object")
			throw new Error(`${current.id}: missing provenance`);
		if (
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
