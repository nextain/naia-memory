import type { ContradictionFilterProvider } from "./contradiction-filter.js";
import {
	findStructuredNegationRetirements,
	findStructuredSupersessions,
	sameStructuredSubject,
} from "./structured-facts.js";
import type { Fact, MemoryAdapter, StructuredFact } from "./types.js";

/**
 * Retire stale peers when an extracted fact resolves to an existing canonical
 * duplicate. Without this pass, an early duplicate return can leave an older
 * contradictory fact active indefinitely.
 */
export async function reconcileStructuredDuplicate(options: {
	adapter: MemoryAdapter;
	contradictionFilter: ContradictionFilterProvider;
	existingFacts: Fact[];
	duplicate: Fact;
	structured: StructuredFact;
	content: string;
	now: number;
}): Promise<number> {
	const {
		adapter,
		contradictionFilter,
		existingFacts,
		duplicate,
		structured,
		content,
		now,
	} = options;
	const deterministic = [
		...findStructuredSupersessions(existingFacts, structured),
		...findStructuredNegationRetirements(existingFacts, structured),
	].filter((fact) => fact.id !== duplicate.id);
	const deterministicIds = new Set(deterministic.map((fact) => fact.id));
	const contextualCandidates = existingFacts.filter(
		(fact) =>
			contradictionFilter.name !== "heuristic" &&
			fact.id !== duplicate.id &&
			!deterministicIds.has(fact.id) &&
			fact.status === "active" &&
			!!fact.structured &&
			fact.structured.cardinality === "single" &&
			structured.cardinality === "single" &&
			sameStructuredSubject(fact.structured, structured),
	);
	const verdicts = await contradictionFilter.filter(
		contextualCandidates.map((existing) => ({ existing, newInfo: content })),
	);
	const contextual = verdicts.flatMap((verdict) => {
		const fact = contextualCandidates[verdict.index];
		return fact && verdict.result.action === "update" ? [fact] : [];
	});
	const stale = [
		...new Map(
			[...deterministic, ...contextual].map((f) => [f.id, f]),
		).values(),
	];

	for (const fact of stale) {
		await adapter.semantic.upsert({
			...fact,
			status: "superseded",
			updatedAt: now,
			validTo: now,
			successorId: duplicate.id,
		});
	}
	return stale.length;
}
