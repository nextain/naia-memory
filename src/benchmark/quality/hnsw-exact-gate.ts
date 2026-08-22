import {
	type QueryComparison,
	meanTopKOverlap,
} from "./binary-quantization-gate.js";

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

export function summarizeGeneratedInterference(rankings: string[][]): {
	top1Rate: number;
	top10QueryRate: number;
	meanGeneratedAt10: number;
} {
	if (rankings.length === 0) {
		return { top1Rate: 0, top10QueryRate: 0, meanGeneratedAt10: 0 };
	}
	const generatedCounts = rankings.map(
		(ranking) => ranking.filter((id) => id.startsWith("scale-")).length,
	);
	return {
		top1Rate:
			rankings.filter((ranking) => ranking[0]?.startsWith("scale-")).length /
			rankings.length,
		top10QueryRate:
			generatedCounts.filter((count) => count > 0).length / rankings.length,
		meanGeneratedAt10:
			generatedCounts.reduce((sum, count) => sum + count, 0) / rankings.length,
	};
}

export function summarizeGeneratedInterferenceDetails(
	rankings: string[][],
	categories: string[],
	templateForId: (id: string) => number | null,
): {
	byCategory: Record<
		string,
		{
			queryCount: number;
			top1Rate: number;
			top10QueryRate: number;
			meanGeneratedAt10: number;
		}
	>;
	byTemplate: Array<{
		templateIndex: number;
		hitCount: number;
		top1Count: number;
	}>;
} {
	if (rankings.length !== categories.length) {
		throw new Error("rankings and categories must have equal length");
	}
	const grouped = new Map<string, string[][]>();
	const templates = new Map<number, { hitCount: number; top1Count: number }>();
	for (let index = 0; index < rankings.length; index++) {
		const category = categories[index] || "uncategorized";
		const ranking = rankings[index];
		grouped.set(category, [...(grouped.get(category) ?? []), ranking]);
		for (let rank = 0; rank < ranking.length; rank++) {
			const templateIndex = templateForId(ranking[rank]);
			if (templateIndex === null) continue;
			const counts = templates.get(templateIndex) ?? {
				hitCount: 0,
				top1Count: 0,
			};
			counts.hitCount++;
			if (rank === 0) counts.top1Count++;
			templates.set(templateIndex, counts);
		}
	}
	return {
		byCategory: Object.fromEntries(
			[...grouped.entries()]
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([category, categoryRankings]) => [
					category,
					{
						queryCount: categoryRankings.length,
						...summarizeGeneratedInterference(categoryRankings),
					},
				]),
		),
		byTemplate: [...templates.entries()]
			.map(([templateIndex, counts]) => ({ templateIndex, ...counts }))
			.sort(
				(left, right) =>
					right.hitCount - left.hitCount ||
					right.top1Count - left.top1Count ||
					left.templateIndex - right.templateIndex,
			),
	};
}

export function summarizePreservationByCategory(
	comparisons: QueryComparison[],
	categories: string[],
): Record<
	string,
	{ queryCount: number; overlapAt10: number; agreementAt1: number }
> {
	if (comparisons.length !== categories.length) {
		throw new Error("comparisons and categories must have equal length");
	}
	const grouped = new Map<string, QueryComparison[]>();
	for (let index = 0; index < comparisons.length; index++) {
		const category = categories[index] || "uncategorized";
		grouped.set(category, [
			...(grouped.get(category) ?? []),
			comparisons[index],
		]);
	}
	return Object.fromEntries(
		[...grouped.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([category, categoryComparisons]) => [
				category,
				{
					queryCount: categoryComparisons.length,
					overlapAt10: meanTopKOverlap(categoryComparisons),
					agreementAt1: top1Agreement(categoryComparisons),
				},
			]),
	);
}
