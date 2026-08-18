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
};

export type MemoryUpdateContract = {
	schemaVersion: "naia-memory-update-contract-v1";
	tier: "lifecycle-conformance" | "semantic-update-interpretation";
	construction: "independent-native-reviewed" | "generated-diagnostic";
	cases: MemoryUpdateCase[];
};

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
		for (const language of MEMORY_UPDATE_LANGUAGES)
			if (!contract.cases.some((current) => current.language === language))
				throw new Error(`independent contract requires ${language} coverage`);
	}
}
