export interface RetrievalMetrics {
	successAt1: number;
	successAt5: number;
	successAt10: number;
	recallAt10: number;
	ndcgAt10: number;
	mrr: number;
}

export interface JudgedRanking {
	relevantIds: readonly string[];
	ranking: readonly string[];
}

function mean(total: number, count: number): number {
	return count === 0 ? 0 : total / count;
}

function discountedGain(
	ranking: readonly string[],
	relevant: Set<string>,
): number {
	return ranking.slice(0, 10).reduce((sum, id, index) => {
		return sum + (relevant.has(id) ? 1 / Math.log2(index + 2) : 0);
	}, 0);
}

/** Binary-relevance metrics. success@k is intentionally distinct from recall@k. */
export function summarizeRetrievalMetrics(
	comparisons: readonly JudgedRanking[],
): RetrievalMetrics {
	let successAt1 = 0;
	let successAt5 = 0;
	let successAt10 = 0;
	let recallAt10 = 0;
	let ndcgAt10 = 0;
	let mrr = 0;
	for (const comparison of comparisons) {
		const relevant = new Set(comparison.relevantIds);
		if (relevant.size === 0) continue;
		const ranking = [...new Set(comparison.ranking)];
		if (ranking.length !== comparison.ranking.length) {
			throw new Error("ranking contains duplicate document ids");
		}
		const firstRank = ranking.findIndex((id) => relevant.has(id));
		if (firstRank === 0) successAt1++;
		if (firstRank >= 0 && firstRank < 5) successAt5++;
		if (firstRank >= 0 && firstRank < 10) successAt10++;
		if (firstRank >= 0) mrr += 1 / (firstRank + 1);
		const retrievedRelevant = new Set(
			ranking.slice(0, 10).filter((id) => relevant.has(id)),
		);
		recallAt10 += retrievedRelevant.size / relevant.size;
		const idealLength = Math.min(10, relevant.size);
		const ideal = Array.from(
			{ length: idealLength },
			(_, index) => 1 / Math.log2(index + 2),
		).reduce((sum, gain) => sum + gain, 0);
		ndcgAt10 += discountedGain(ranking, relevant) / ideal;
	}
	const count = comparisons.filter(
		({ relevantIds }) => relevantIds.length > 0,
	).length;
	return {
		successAt1: mean(successAt1, count),
		successAt5: mean(successAt5, count),
		successAt10: mean(successAt10, count),
		recallAt10: mean(recallAt10, count),
		ndcgAt10: mean(ndcgAt10, count),
		mrr: mean(mrr, count),
	};
}
