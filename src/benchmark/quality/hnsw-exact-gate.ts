import type { QueryComparison } from "./binary-quantization-gate.js";

export function resolveFactId(
	reference: string | undefined,
	factIds: Set<string>,
): string | null {
	if (!reference) return null;
	if (factIds.has(reference)) return reference;
	const match = /^F0*(\d+)$/.exec(reference);
	if (!match) return null;
	const normalized = `F${Number(match[1])}`;
	return factIds.has(normalized) ? normalized : null;
}

export function resolveFactIds(
	references: string | string[] | undefined,
	factIds: Set<string>,
): string[] {
	const values = Array.isArray(references) ? references : [references];
	return [
		...new Set(
			values
				.map((reference) => resolveFactId(reference, factIds))
				.filter((id): id is string => id !== null),
		),
	];
}

export function top1Agreement(comparisons: QueryComparison[]): number {
	return (
		comparisons.filter(
			({ baseline, candidate }) => baseline[0] === candidate[0],
		).length / comparisons.length
	);
}

export function rankingsAreStable(rankings: string[][]): boolean {
	if (rankings.length < 2) return true;
	const first = JSON.stringify(rankings[0]);
	return rankings
		.slice(1)
		.every((ranking) => JSON.stringify(ranking) === first);
}
