export interface RankedQuery {
	queryId: string;
	ranking: string[];
}

export interface RankingAbAnalysisOptions {
	baseline: RankedQuery[];
	candidate: RankedQuery[];
	relevantByQuery: ReadonlyMap<string, ReadonlySet<string>>;
	bootstrapRepetitions?: number;
	bootstrapSeed?: number;
}

interface QueryMetrics {
	ndcgAt10: number;
	recallAt100: number;
}

export interface RankingAbAnalysis {
	queryCount: number;
	bootstrap: {
		method: "paired-query-percentile-bootstrap-v1";
		repetitions: number;
		seed: number;
	};
	metrics: {
		ndcgAt10: MetricComparison;
		recallAt100: MetricComparison;
	};
	rankingStability: {
		meanTop10Jaccard: number;
		meanTop100Jaccard: number;
	};
}

interface MetricComparison {
	baseline: number;
	candidate: number;
	delta: number;
	delta95PercentileInterval: { lower: number; upper: number };
}

export interface BoundRankingResult {
	benchmark?: string;
	inputs?: {
		sourceLockSha256?: string;
		topicsSha256?: string;
		qrelsSha256?: string;
		corpusDocidsSha256?: string;
		documentCount?: number;
		queryCount?: number;
	};
	configuration?: {
		passageComposition?: string;
		embedding?: unknown;
		vectorStore?: string;
		distance?: string;
		exactSearch?: boolean;
		topK?: number;
		cpuOnly?: boolean;
	};
	metrics?: { ndcgAt10?: number; recallAt100?: number };
	trecSha256?: string;
}

const EXPECTED_BENCHMARK = "miracl-ko-full-corpus-naia-vector-exact-v1";
const EXPECTED_DOCUMENTS = 1_486_752;

function sharedProtocol(result: BoundRankingResult): unknown {
	return {
		benchmark: result.benchmark,
		inputs: {
			sourceLockSha256: result.inputs?.sourceLockSha256,
			topicsSha256: result.inputs?.topicsSha256,
			qrelsSha256: result.inputs?.qrelsSha256,
			corpusDocidsSha256: result.inputs?.corpusDocidsSha256,
			documentCount: result.inputs?.documentCount,
			queryCount: result.inputs?.queryCount,
		},
		configuration: {
			passageComposition: result.configuration?.passageComposition,
			embedding: result.configuration?.embedding,
			vectorStore: result.configuration?.vectorStore,
			distance: result.configuration?.distance,
			exactSearch: result.configuration?.exactSearch,
			topK: result.configuration?.topK,
			cpuOnly: result.configuration?.cpuOnly,
		},
	};
}

export function validateBoundRankingResult(
	text: string,
	trecSha256: string,
	qrelsSha256: string,
	expectedQueries: number,
): void {
	const result = JSON.parse(text) as BoundRankingResult;
	if (
		result.benchmark !== EXPECTED_BENCHMARK ||
		result.trecSha256 !== trecSha256 ||
		result.inputs?.qrelsSha256 !== qrelsSha256 ||
		result.inputs.documentCount !== EXPECTED_DOCUMENTS ||
		result.inputs.queryCount !== expectedQueries ||
		result.configuration?.vectorStore !== "Qdrant" ||
		result.configuration.distance !== "Cosine" ||
		result.configuration?.exactSearch !== true ||
		result.configuration.topK !== 100 ||
		result.configuration.cpuOnly !== true
	)
		throw new Error(
			"A/B result does not bind the expected TREC/qrels protocol",
		);
}

export function validateSharedRankingProtocol(
	baselineText: string,
	candidateText: string,
): void {
	const baseline = JSON.parse(baselineText) as BoundRankingResult;
	const candidate = JSON.parse(candidateText) as BoundRankingResult;
	if (
		JSON.stringify(sharedProtocol(baseline)) !==
		JSON.stringify(sharedProtocol(candidate))
	)
		throw new Error("A/B results do not share the same ranking protocol");
}

export function validateReportedRankingMetrics(
	resultText: string,
	recomputed: { ndcgAt10: number; recallAt100: number },
	tolerance = 1e-6,
): void {
	const result = JSON.parse(resultText) as BoundRankingResult;
	const reportedNdcg = result.metrics?.ndcgAt10;
	const reportedRecall = result.metrics?.recallAt100;
	if (
		!Number.isFinite(reportedNdcg) ||
		!Number.isFinite(reportedRecall) ||
		!Number.isFinite(tolerance) ||
		tolerance < 0 ||
		Math.abs((reportedNdcg ?? Number.NaN) - recomputed.ndcgAt10) > tolerance ||
		Math.abs((reportedRecall ?? Number.NaN) - recomputed.recallAt100) >
			tolerance
	)
		throw new Error("reported ranking metrics do not match TREC recomputation");
}

function mean(values: readonly number[]): number {
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function assertRanking(row: RankedQuery, label: string): void {
	if (row.queryId.length === 0) throw new Error(`${label}: empty query ID`);
	if (row.ranking.length !== 100)
		throw new Error(
			`${label}/${row.queryId}: ranking must contain exactly 100`,
		);
	if (row.ranking.some((id) => id.length === 0))
		throw new Error(`${label}/${row.queryId}: empty document ID`);
	if (new Set(row.ranking).size !== row.ranking.length)
		throw new Error(`${label}/${row.queryId}: duplicate document ID`);
}

function metricFor(
	ranking: readonly string[],
	relevant: ReadonlySet<string>,
): QueryMetrics {
	if (relevant.size === 0) throw new Error("relevance set must not be empty");
	let dcg = 0;
	for (const [index, docid] of ranking.slice(0, 10).entries())
		if (relevant.has(docid)) dcg += 1 / Math.log2(index + 2);
	let ideal = 0;
	for (let index = 0; index < Math.min(10, relevant.size); index += 1)
		ideal += 1 / Math.log2(index + 2);
	const recalled = ranking
		.slice(0, 100)
		.filter((id) => relevant.has(id)).length;
	return { ndcgAt10: dcg / ideal, recallAt100: recalled / relevant.size };
}

function jaccard(
	a: readonly string[],
	b: readonly string[],
	depth: number,
): number {
	const left = new Set(a.slice(0, depth));
	const right = new Set(b.slice(0, depth));
	let intersection = 0;
	for (const value of left) if (right.has(value)) intersection += 1;
	return intersection / (left.size + right.size - intersection);
}

function percentile(sorted: readonly number[], probability: number): number {
	const position = (sorted.length - 1) * probability;
	const lower = Math.floor(position);
	const fraction = position - lower;
	const lowerValue = sorted[lower];
	const upperValue = sorted[Math.min(lower + 1, sorted.length - 1)];
	if (lowerValue === undefined || upperValue === undefined)
		throw new Error("percentile requires a non-empty distribution");
	return lowerValue + (upperValue - lowerValue) * fraction;
}

function randomGenerator(seed: number): () => number {
	let state = seed >>> 0;
	if (state === 0) state = 0x6d2b79f5;
	return () => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return (state >>> 0) / 0x1_0000_0000;
	};
}

function comparison(
	baseline: readonly number[],
	candidate: readonly number[],
	repetitions: number,
	random: () => number,
): MetricComparison {
	const deltas: number[] = [];
	for (let repetition = 0; repetition < repetitions; repetition += 1) {
		let sum = 0;
		for (let index = 0; index < baseline.length; index += 1) {
			const sampled = Math.floor(random() * baseline.length);
			sum += (candidate[sampled] ?? 0) - (baseline[sampled] ?? 0);
		}
		deltas.push(sum / baseline.length);
	}
	deltas.sort((a, b) => a - b);
	const baselineMean = mean(baseline);
	const candidateMean = mean(candidate);
	return {
		baseline: baselineMean,
		candidate: candidateMean,
		delta: candidateMean - baselineMean,
		delta95PercentileInterval: {
			lower: percentile(deltas, 0.025),
			upper: percentile(deltas, 0.975),
		},
	};
}

export function analyzeRankingAb(
	options: RankingAbAnalysisOptions,
): RankingAbAnalysis {
	const repetitions = options.bootstrapRepetitions ?? 10_000;
	const seed = options.bootstrapSeed ?? 0x4e414941;
	if (!Number.isInteger(repetitions) || repetitions < 1_000)
		throw new Error(
			"bootstrap repetitions must be an integer of at least 1000",
		);
	if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff)
		throw new Error("bootstrap seed must be an unsigned 32-bit integer");
	if (options.baseline.length === 0)
		throw new Error("A/B analysis requires queries");
	if (options.baseline.length !== options.candidate.length)
		throw new Error("A/B query count mismatch");

	const candidateById = new Map(
		options.candidate.map((row) => [row.queryId, row]),
	);
	if (candidateById.size !== options.candidate.length)
		throw new Error("candidate contains duplicate query IDs");
	const baselineIds = new Set<string>();
	const baselineMetrics: QueryMetrics[] = [];
	const candidateMetrics: QueryMetrics[] = [];
	const top10Jaccards: number[] = [];
	const top100Jaccards: number[] = [];

	for (const baseline of options.baseline) {
		assertRanking(baseline, "baseline");
		if (baselineIds.has(baseline.queryId))
			throw new Error("baseline contains duplicate query IDs");
		baselineIds.add(baseline.queryId);
		const candidate = candidateById.get(baseline.queryId);
		if (!candidate)
			throw new Error(`candidate missing query ${baseline.queryId}`);
		assertRanking(candidate, "candidate");
		const relevant = options.relevantByQuery.get(baseline.queryId);
		if (!relevant) throw new Error(`missing qrels for ${baseline.queryId}`);
		baselineMetrics.push(metricFor(baseline.ranking, relevant));
		candidateMetrics.push(metricFor(candidate.ranking, relevant));
		top10Jaccards.push(jaccard(baseline.ranking, candidate.ranking, 10));
		top100Jaccards.push(jaccard(baseline.ranking, candidate.ranking, 100));
	}

	const random = randomGenerator(seed);
	return {
		queryCount: options.baseline.length,
		bootstrap: {
			method: "paired-query-percentile-bootstrap-v1",
			repetitions,
			seed,
		},
		metrics: {
			ndcgAt10: comparison(
				baselineMetrics.map((row) => row.ndcgAt10),
				candidateMetrics.map((row) => row.ndcgAt10),
				repetitions,
				random,
			),
			recallAt100: comparison(
				baselineMetrics.map((row) => row.recallAt100),
				candidateMetrics.map((row) => row.recallAt100),
				repetitions,
				random,
			),
		},
		rankingStability: {
			meanTop10Jaccard: mean(top10Jaccards),
			meanTop100Jaccard: mean(top100Jaccards),
		},
	};
}
