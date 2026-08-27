import { createHash } from "node:crypto";

export interface CandidatePoolReceipt {
	version: 3;
	poolKind: "label-conditioned-hard-negative-diagnostic";
	seed: string;
	targetSize: number;
	targetSizeMode: "fixed" | "required-only";
	sourceCorpusSize: number;
	retainedFraction: number;
	minimumHardNegativesPerQuery: number;
	minimumUniqueHardNegativeRatio: number;
	maximumRandomFillerFraction: number;
	positiveCount: number;
	hardNegativeCount: number;
	hardNegativeAssignments: number;
	hardNegativeCountByQuery: Record<string, number>;
	hardNegativeCountBySourceAndQuery: Record<
		"lexical" | "dense",
		Record<string, number>
	>;
	uniqueHardNegativeRatio: number;
	randomFillerCount: number;
	duplicateInputCount: number;
	queryCount: number;
	queriesWithoutMinimumHardNegatives: string[];
	queriesWithoutAnyPositive: string[];
	corpusSha256: string;
	labelsSha256: string;
	hardNegativeRuns: Record<
		"lexical" | "dense",
		{ source: string; sha256: string }
	>;
	poolSha256: string;
}

export interface CandidatePool {
	documentIds: string[];
	receipt: CandidatePoolReceipt;
}

function hashRank(seed: string, id: string): string {
	return createHash("sha256").update(`${seed}\0${id}`).digest("hex");
}

function canonicalEntries(
	entries: ReadonlyMap<string, readonly string[]>,
): Array<[string, string[]]> {
	return [...entries]
		.map(
			([queryId, ids]) =>
				[queryId, [...new Set(ids)].sort()] as [string, string[]],
		)
		.sort(([left], [right]) => left.localeCompare(right));
}

/**
 * Builds a label-conditioned diagnostic pool. It deliberately fails when the
 * supplied full-corpus run lacks enough per-query hard negatives; such a pool
 * must never silently degrade to positives plus random noise.
 */
export function buildNativeCandidatePool(options: {
	corpusDocumentIds: readonly string[];
	relevantByQuery: ReadonlyMap<string, readonly string[]>;
	hardNegativeRuns: Record<
		"lexical" | "dense",
		{
			source: string;
			byQuery: ReadonlyMap<string, readonly string[]>;
		}
	>;
	targetSize: number | "required-only";
	minimumHardNegativesPerQuery: number;
	minimumUniqueHardNegativeRatio: number;
	maximumRandomFillerFraction: number;
	seed: string;
}): CandidatePool {
	if (
		options.targetSize !== "required-only" &&
		(!Number.isSafeInteger(options.targetSize) || options.targetSize < 1)
	) {
		throw new Error("targetSize must be a positive safe integer");
	}
	if (
		!Number.isSafeInteger(options.minimumHardNegativesPerQuery) ||
		options.minimumHardNegativesPerQuery < 1
	) {
		throw new Error("minimumHardNegativesPerQuery must be positive");
	}
	if (
		!Number.isFinite(options.minimumUniqueHardNegativeRatio) ||
		options.minimumUniqueHardNegativeRatio <= 0 ||
		options.minimumUniqueHardNegativeRatio > 1
	) {
		throw new Error("minimumUniqueHardNegativeRatio must be in (0, 1]");
	}
	for (const kind of ["lexical", "dense"] as const) {
		if (options.hardNegativeRuns[kind].source.trim().length === 0) {
			throw new Error(
				`${kind} hard-negative source must identify an independent full-corpus run`,
			);
		}
	}
	if (
		options.hardNegativeRuns.lexical.source ===
		options.hardNegativeRuns.dense.source
	) {
		throw new Error("lexical and dense hard-negative sources must be distinct");
	}
	if (
		!Number.isFinite(options.maximumRandomFillerFraction) ||
		options.maximumRandomFillerFraction < 0 ||
		options.maximumRandomFillerFraction >= 1
	) {
		throw new Error("maximumRandomFillerFraction must be in [0, 1)");
	}
	if (options.relevantByQuery.size === 0) {
		throw new Error("at least one judged query is required");
	}
	const corpus = new Set(options.corpusDocumentIds);
	const duplicateInputCount = options.corpusDocumentIds.length - corpus.size;
	const positiveIds = new Set<string>();
	const hardNegativeIds = new Set<string>();
	const queriesWithoutMinimumHardNegatives: string[] = [];
	const queriesWithoutAnyPositive: string[] = [];
	for (const [queryId, relevantIds] of options.relevantByQuery) {
		let retained = 0;
		for (const id of relevantIds) {
			if (corpus.has(id)) {
				positiveIds.add(id);
				retained++;
			}
		}
		if (retained === 0) queriesWithoutAnyPositive.push(queryId);
	}
	if (queriesWithoutAnyPositive.length > 0) {
		throw new Error(
			`positive coverage failed for ${queriesWithoutAnyPositive.length} queries`,
		);
	}
	const hardNegativeCountByQuery: Record<string, number> = {};
	const hardNegativeCountBySourceAndQuery = {
		lexical: {} as Record<string, number>,
		dense: {} as Record<string, number>,
	};
	let hardNegativeAssignments = 0;
	for (const [queryId] of options.relevantByQuery) {
		const accepted = new Set<string>();
		for (const kind of ["lexical", "dense"] as const) {
			let sourceAccepted = 0;
			for (const id of options.hardNegativeRuns[kind].byQuery.get(queryId) ??
				[]) {
				if (!corpus.has(id) || positiveIds.has(id)) continue;
				if (!accepted.has(id)) {
					accepted.add(id);
					hardNegativeIds.add(id);
					sourceAccepted++;
				}
				if (sourceAccepted >= options.minimumHardNegativesPerQuery) break;
			}
			hardNegativeCountBySourceAndQuery[kind][queryId] = sourceAccepted;
			if (sourceAccepted < options.minimumHardNegativesPerQuery) {
				queriesWithoutMinimumHardNegatives.push(`${kind}:${queryId}`);
			}
		}
		hardNegativeCountByQuery[queryId] = accepted.size;
		hardNegativeAssignments += accepted.size;
	}
	if (queriesWithoutMinimumHardNegatives.length > 0) {
		throw new Error(
			`hard-negative coverage failed for ${queriesWithoutMinimumHardNegatives.length} queries`,
		);
	}
	const uniqueHardNegativeRatio =
		hardNegativeIds.size / hardNegativeAssignments;
	if (uniqueHardNegativeRatio < options.minimumUniqueHardNegativeRatio) {
		throw new Error(
			`unique hard-negative ratio ${uniqueHardNegativeRatio.toFixed(6)} is below ${options.minimumUniqueHardNegativeRatio}`,
		);
	}
	const required = new Set([...positiveIds, ...hardNegativeIds]);
	const targetSize =
		options.targetSize === "required-only" ? required.size : options.targetSize;
	if (required.size > targetSize) {
		throw new Error(
			`required positives and hard negatives (${required.size}) exceed targetSize (${targetSize})`,
		);
	}
	const fillers = [...corpus]
		.filter((id) => !required.has(id))
		.map((id) => ({ id, rank: hashRank(options.seed, id) }))
		.sort((a, b) =>
			a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : 1,
		)
		.map(({ id }) => id)
		.slice(0, targetSize - required.size);
	const documentIds = [...required, ...fillers].sort();
	if (documentIds.length !== targetSize) {
		throw new Error(
			`corpus only supplied ${documentIds.length}/${targetSize} unique candidates`,
		);
	}
	if (
		fillers.length / documentIds.length >
		options.maximumRandomFillerFraction
	) {
		throw new Error(
			`random filler fraction ${(fillers.length / documentIds.length).toFixed(6)} exceeds ${options.maximumRandomFillerFraction}`,
		);
	}
	return {
		documentIds,
		receipt: {
			version: 3,
			poolKind: "label-conditioned-hard-negative-diagnostic",
			seed: options.seed,
			targetSize,
			targetSizeMode:
				options.targetSize === "required-only" ? "required-only" : "fixed",
			sourceCorpusSize: corpus.size,
			retainedFraction: documentIds.length / corpus.size,
			minimumHardNegativesPerQuery: options.minimumHardNegativesPerQuery,
			minimumUniqueHardNegativeRatio: options.minimumUniqueHardNegativeRatio,
			maximumRandomFillerFraction: options.maximumRandomFillerFraction,
			positiveCount: positiveIds.size,
			hardNegativeCount: hardNegativeIds.size,
			hardNegativeAssignments,
			hardNegativeCountByQuery,
			hardNegativeCountBySourceAndQuery,
			uniqueHardNegativeRatio,
			randomFillerCount: fillers.length,
			duplicateInputCount,
			queryCount: options.relevantByQuery.size,
			queriesWithoutMinimumHardNegatives,
			queriesWithoutAnyPositive,
			corpusSha256: createHash("sha256")
				.update(`${[...corpus].sort().join("\n")}\n`)
				.digest("hex"),
			labelsSha256: createHash("sha256")
				.update(JSON.stringify(canonicalEntries(options.relevantByQuery)))
				.digest("hex"),
			hardNegativeRuns: Object.fromEntries(
				(["lexical", "dense"] as const).map((kind) => [
					kind,
					{
						source: options.hardNegativeRuns[kind].source,
						sha256: createHash("sha256")
							.update(
								JSON.stringify(
									canonicalEntries(options.hardNegativeRuns[kind].byQuery),
								),
							)
							.digest("hex"),
					},
				]),
			) as CandidatePoolReceipt["hardNegativeRuns"],
			poolSha256: createHash("sha256")
				.update(`${documentIds.join("\n")}\n`)
				.digest("hex"),
		},
	};
}
