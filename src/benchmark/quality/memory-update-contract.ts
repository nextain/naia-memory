import { createHash } from "node:crypto";

export const MEMORY_UPDATE_LANGUAGES = ["ko", "en", "ja"] as const;
export type MemoryUpdateLanguage = (typeof MEMORY_UPDATE_LANGUAGES)[number];

export type LifecycleOperation =
	| { op: "add"; logicalId: string; content: string; at: string }
	| {
			op: "replace";
			logicalId: string;
			replacesLogicalId: string;
			content: string;
			at: string;
	  }
	| { op: "delete"; logicalId: string; at: string };

export type MemoryUpdateCase = {
	id: string;
	familyId: string;
	split: "diagnostic" | "development" | "test";
	language: MemoryUpdateLanguage;
	turns: Array<{ content: string; at: string }>;
	query: string;
	expectedCurrentIds: string[];
	forbiddenStaleIds: string[];
	expectedDeletedIds: string[];
	noUpdateIds: string[];
	expectedDecision: "create" | "update" | "delete" | "no-update";
	lifecycleOperations?: LifecycleOperation[];
	provenance?: {
		authorId: string;
		constructionClusterId: string;
		authorNativeLanguages: MemoryUpdateLanguage[];
		authoredAt: string;
		reviewerId: string;
		reviewerNativeLanguages: MemoryUpdateLanguage[];
		reviewedAt: string;
		reviewDecision: "accepted" | "revised-and-accepted";
	};
};

export type MemoryUpdateContract = {
	schemaVersion: "naia-memory-update-contract-v1";
	tier: "lifecycle-conformance" | "semantic-update-interpretation";
	construction: "independent-native-reviewed" | "generated-diagnostic";
	familySplitFreeze?: { frozenAt: string; digest: `sha256:${string}` };
	cases: MemoryUpdateCase[];
};

export const SEMANTIC_DIAGNOSTIC_DECISIONS = [
	"update",
	"delete",
	"no-update",
] as const;

export const SEMANTIC_PUBLIC_MINIMUM_CASES = 100;
export const SEMANTIC_PUBLIC_MINIMUM_FAMILIES = 100;
export const SEMANTIC_PUBLIC_MINIMUM_TEST_CASES_PER_LANGUAGE = 30;
export const SEMANTIC_PUBLIC_MINIMUM_TEST_CASES_PER_DECISION = 10;

/**
 * Applies the sample-size floor for public semantic-update claims.
 *
 * The general contract validator intentionally permits small independently
 * reviewed pilot contracts. Callers promoting comparative evidence must use
 * this stricter gate so development cases cannot be counted as held-out test
 * evidence.
 */
export function validateSemanticPublicEvidenceCoverage(
	contract: MemoryUpdateContract,
): void {
	validateMemoryUpdateContract(contract);
	if (
		contract.tier !== "semantic-update-interpretation" ||
		contract.construction !== "independent-native-reviewed"
	)
		throw new Error(
			"public semantic gate requires independent native-reviewed evidence",
		);
	const testCases = contract.cases.filter(
		(current) => current.split === "test",
	);
	if (testCases.length < SEMANTIC_PUBLIC_MINIMUM_CASES)
		throw new Error(
			`public semantic gate requires at least ${SEMANTIC_PUBLIC_MINIMUM_CASES} test cases`,
		);
	const familyCount = new Set(testCases.map((current) => current.familyId))
		.size;
	if (familyCount < SEMANTIC_PUBLIC_MINIMUM_FAMILIES)
		throw new Error(
			`public semantic gate requires at least ${SEMANTIC_PUBLIC_MINIMUM_FAMILIES} distinct test families`,
		);
	const constructionClusterFamilies = new Map<string, Set<string>>();
	for (const current of testCases) {
		const constructionClusterId = current.provenance?.constructionClusterId;
		if (!constructionClusterId) continue;
		const families =
			constructionClusterFamilies.get(constructionClusterId) ??
			new Set<string>();
		families.add(current.familyId);
		constructionClusterFamilies.set(constructionClusterId, families);
	}
	if (
		[...constructionClusterFamilies.values()].some(
			(families) => families.size > 1,
		)
	)
		throw new Error(
			"public semantic gate forbids construction clusters shared across test families",
		);
	if (testCases.some((current) => current.expectedDecision === "create"))
		throw new Error(
			"public semantic update gate does not admit create decisions",
		);
	for (const current of testCases) {
		if (
			current.expectedDecision === "update" &&
			(current.expectedCurrentIds.length === 0 ||
				current.forbiddenStaleIds.length === 0)
		)
			throw new Error(
				`${current.id}: public update decision requires current and stale labels`,
			);
		if (
			current.expectedDecision === "delete" &&
			current.expectedDeletedIds.length === 0
		)
			throw new Error(
				`${current.id}: public delete decision requires deleted labels`,
			);
		if (
			current.expectedDecision === "no-update" &&
			current.noUpdateIds.length === 0
		)
			throw new Error(
				`${current.id}: public no-update decision requires no-update labels`,
			);
	}
	const authorIds = new Set(
		testCases.map((current) => current.provenance?.authorId),
	);
	const reviewerIds = new Set(
		testCases.map((current) => current.provenance?.reviewerId),
	);
	if ([...authorIds].some((authorId) => reviewerIds.has(authorId)))
		throw new Error(
			"public semantic gate requires globally independent author and reviewer roles",
		);
	for (const language of MEMORY_UPDATE_LANGUAGES) {
		const languageCases = testCases.filter(
			(current) => current.language === language,
		);
		if (languageCases.length < SEMANTIC_PUBLIC_MINIMUM_TEST_CASES_PER_LANGUAGE)
			throw new Error(
				`public semantic gate requires at least ${SEMANTIC_PUBLIC_MINIMUM_TEST_CASES_PER_LANGUAGE} ${language} test cases`,
			);
		for (const decision of SEMANTIC_DIAGNOSTIC_DECISIONS) {
			const decisionCount = languageCases.filter(
				(current) => current.expectedDecision === decision,
			).length;
			if (decisionCount < SEMANTIC_PUBLIC_MINIMUM_TEST_CASES_PER_DECISION)
				throw new Error(
					`public semantic gate requires at least ${SEMANTIC_PUBLIC_MINIMUM_TEST_CASES_PER_DECISION} ${language}/${decision} test cases`,
				);
		}
	}
}

export function validateSemanticDiagnosticCoverage(
	contract: MemoryUpdateContract,
): void {
	validateMemoryUpdateContract(contract);
	if (
		contract.tier !== "semantic-update-interpretation" ||
		contract.construction !== "generated-diagnostic"
	)
		throw new Error("coverage gate requires a generated semantic diagnostic");
	for (const language of MEMORY_UPDATE_LANGUAGES)
		for (const decision of SEMANTIC_DIAGNOSTIC_DECISIONS)
			if (
				!contract.cases.some(
					(current) =>
						current.language === language &&
						current.expectedDecision === decision,
				)
			)
				throw new Error(`semantic diagnostic requires ${language}/${decision}`);
}

export function computeFamilySplitDigest(cases: MemoryUpdateCase[]): string {
	const assignments = cases
		.map(
			(item) =>
				`${item.id}\u0000${item.familyId}\u0000${item.provenance?.constructionClusterId ?? ""}\u0000${item.split}`,
		)
		.sort((left, right) => left.localeCompare(right))
		.join("\n");
	return `sha256:${createHash("sha256").update(assignments).digest("hex")}`;
}

function normalized(value: string): string {
	return value
		.normalize("NFKC")
		.toLocaleLowerCase()
		.replace(/[\p{P}\p{S}\s]+/gu, "");
}

function assertUnique(values: string[], label: string): void {
	if (new Set(values).size !== values.length)
		throw new Error(`${label} contains duplicates`);
}

function assertStrictChronology(values: string[], label: string): void {
	let previous = Number.NEGATIVE_INFINITY;
	for (const value of values) {
		const current = Date.parse(value);
		if (!Number.isFinite(current) || current <= previous)
			throw new Error(`${label} must be strictly chronological`);
		previous = current;
	}
}

export function validateMemoryUpdateContract(
	contract: MemoryUpdateContract,
): void {
	if (contract.schemaVersion !== "naia-memory-update-contract-v1")
		throw new Error("unsupported memory-update contract schema");
	if (!contract.cases.length)
		throw new Error("memory-update contract requires cases");
	const ids = new Set<string>();
	const queries = new Set<string>();
	const familySplits = new Map<string, MemoryUpdateCase["split"]>();
	const constructionClusterSplits = new Map<
		string,
		MemoryUpdateCase["split"]
	>();
	for (const current of contract.cases) {
		if (!current.id.trim() || ids.has(current.id))
			throw new Error(`invalid or duplicate case ID: ${current.id}`);
		ids.add(current.id);
		if (!current.familyId.trim())
			throw new Error(`${current.id}: familyId is required`);
		const existingSplit = familySplits.get(current.familyId);
		if (existingSplit !== undefined && existingSplit !== current.split)
			throw new Error(`${current.id}: family crosses evaluation splits`);
		familySplits.set(current.familyId, current.split);
		if (
			contract.construction === "generated-diagnostic" &&
			current.split !== "diagnostic"
		)
			throw new Error(`${current.id}: generated cases must remain diagnostic`);
		if (
			contract.construction === "independent-native-reviewed" &&
			current.split === "diagnostic"
		)
			throw new Error(
				`${current.id}: independently reviewed cases require development or test split`,
			);
		if (!MEMORY_UPDATE_LANGUAGES.includes(current.language))
			throw new Error(`${current.id}: unsupported language`);
		if (contract.construction === "independent-native-reviewed") {
			const provenance = current.provenance;
			if (
				!provenance ||
				!provenance.authorId.trim() ||
				!provenance.constructionClusterId.trim() ||
				!provenance.reviewerId.trim()
			)
				throw new Error(`${current.id}: independent case requires provenance`);
			if (
				provenance.constructionClusterId !==
				provenance.constructionClusterId.normalize("NFKC").trim()
			)
				throw new Error(
					`${current.id}: constructionClusterId must use canonical form`,
				);
			if (provenance.authorId === provenance.reviewerId)
				throw new Error(
					`${current.id}: author and reviewer must be independent`,
				);
			const existingConstructionSplit = constructionClusterSplits.get(
				provenance.constructionClusterId,
			);
			if (
				existingConstructionSplit !== undefined &&
				existingConstructionSplit !== current.split
			)
				throw new Error(
					`${current.id}: construction cluster crosses evaluation splits`,
				);
			constructionClusterSplits.set(
				provenance.constructionClusterId,
				current.split,
			);
			if (!provenance.authorNativeLanguages.includes(current.language))
				throw new Error(
					`${current.id}: author must be native in case language`,
				);
			if (!provenance.reviewerNativeLanguages.includes(current.language))
				throw new Error(
					`${current.id}: reviewer must be native in case language`,
				);
			const authoredAt = Date.parse(provenance.authoredAt);
			const reviewedAt = Date.parse(provenance.reviewedAt);
			if (
				!Number.isFinite(authoredAt) ||
				!Number.isFinite(reviewedAt) ||
				reviewedAt < authoredAt
			)
				throw new Error(`${current.id}: invalid provenance chronology`);
		} else if (current.provenance !== undefined) {
			throw new Error(
				`${current.id}: diagnostic case must not claim provenance`,
			);
		}
		if (
			!current.turns.length ||
			current.turns.some(
				(turn) => !turn.content.trim() || !Number.isFinite(Date.parse(turn.at)),
			)
		)
			throw new Error(`${current.id}: invalid turns`);
		assertStrictChronology(
			current.turns.map((turn) => turn.at),
			`${current.id}.turns`,
		);
		const query = normalized(current.query);
		if (!query || queries.has(query))
			throw new Error(`${current.id}: empty or duplicate query`);
		queries.add(query);
		for (const [label, values] of Object.entries({
			expectedCurrentIds: current.expectedCurrentIds,
			forbiddenStaleIds: current.forbiddenStaleIds,
			expectedDeletedIds: current.expectedDeletedIds,
			noUpdateIds: current.noUpdateIds,
		}))
			assertUnique(values, `${current.id}.${label}`);
		const positive = new Set([
			...current.expectedCurrentIds,
			...current.noUpdateIds,
		]);
		for (const id of [
			...current.forbiddenStaleIds,
			...current.expectedDeletedIds,
		])
			if (positive.has(id))
				throw new Error(
					`${current.id}: positive and forbidden lifecycle labels overlap`,
				);
		if (contract.tier === "lifecycle-conformance") {
			if (!current.lifecycleOperations?.length)
				throw new Error(`${current.id}: lifecycle tier requires operations`);
			if (
				current.lifecycleOperations.some(
					(operation) => !operation.logicalId.trim(),
				)
			)
				throw new Error(
					`${current.id}: lifecycle operations require logical IDs`,
				);
			if (
				current.lifecycleOperations.some(
					(operation) => "content" in operation && !operation.content.trim(),
				)
			)
				throw new Error(
					`${current.id}: lifecycle operation content is required`,
				);
			for (const operation of current.lifecycleOperations) {
				if (
					operation.op === "replace" &&
					(!operation.replacesLogicalId.trim() ||
						operation.replacesLogicalId === operation.logicalId)
				)
					throw new Error(
						`${current.id}: replacement requires distinct predecessor and successor IDs`,
					);
			}
			assertStrictChronology(
				current.lifecycleOperations.map((operation) => operation.at),
				`${current.id}.lifecycleOperations`,
			);
			const derivedActive = new Set<string>();
			for (const operation of current.lifecycleOperations) {
				if (operation.op === "add") {
					if (derivedActive.has(operation.logicalId))
						throw new Error(`${current.id}: add targets an active logical ID`);
					derivedActive.add(operation.logicalId);
				} else if (operation.op === "replace") {
					if (!derivedActive.has(operation.replacesLogicalId))
						throw new Error(`${current.id}: replace predecessor is not active`);
					if (derivedActive.has(operation.logicalId))
						throw new Error(
							`${current.id}: replace successor is already active`,
						);
					derivedActive.delete(operation.replacesLogicalId);
					derivedActive.add(operation.logicalId);
				} else {
					if (!derivedActive.delete(operation.logicalId))
						throw new Error(`${current.id}: delete target is not active`);
				}
			}
			const labeledActive = new Set([
				...current.expectedCurrentIds,
				...current.noUpdateIds,
			]);
			if (
				derivedActive.size !== labeledActive.size ||
				[...derivedActive].some((id) => !labeledActive.has(id))
			)
				throw new Error(
					`${current.id}: lifecycle labels do not match derived active state`,
				);
		} else if (current.lifecycleOperations !== undefined) {
			throw new Error(
				`${current.id}: semantic tier forbids fixture-supplied lifecycle operations`,
			);
		}
	}
	if (contract.construction === "independent-native-reviewed") {
		if (!contract.familySplitFreeze)
			throw new Error("independent contract requires family split freeze");
		if (!Number.isFinite(Date.parse(contract.familySplitFreeze.frozenAt)))
			throw new Error("family split freeze timestamp is invalid");
		if (
			contract.familySplitFreeze.digest !==
			computeFamilySplitDigest(contract.cases)
		)
			throw new Error("family split freeze digest does not match cases");
		for (const language of MEMORY_UPDATE_LANGUAGES)
			if (!contract.cases.some((current) => current.language === language))
				throw new Error(`independent contract requires ${language} coverage`);
	}
}
