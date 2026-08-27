import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { OfflineEmbeddingProvider } from "../../memory/embeddings.js";
import { benchmarkReceipt } from "../provenance.js";
import {
	BinaryCandidateIndex,
	type QueryComparison,
	exactTopK,
	meanTopKOverlap,
	rerankCandidates,
	summarizeRanked,
} from "./binary-quantization-gate.js";

const MODEL = "multilingual-e5-large";
const TOP_K = 10;
const MAX_RECALL_LOSS = 0.01;
const MAX_MRR_LOSS = 0.01;
const MIN_OVERLAP = 0.95;
// A coarse pass over more than one quarter of the corpus is not useful
// pruning. Reproducing exact search by reranking most rows is not a win.
const MAX_CANDIDATE_FRACTION = 0.25;
const LANGUAGES = [
	{
		language: "ko",
		facts: "src/benchmark/fact-bank-v2.json",
		queries: "src/benchmark/query-templates-v2.json",
	},
	{
		language: "en-translated",
		facts: "src/benchmark/fact-bank-v2.en.json",
		queries: "src/benchmark/query-templates-v2.en.json",
	},
] as const;

interface Fact {
	id: string;
	statement: string;
	distractor?: { id: string; statement: string };
}

interface Query {
	fact_ref?: string;
	query: string;
}

function load<T>(path: string): T {
	return JSON.parse(readFileSync(join(process.cwd(), path), "utf8")) as T;
}

function percentile(values: number[], quantile: number): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[
		Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))
	];
}

async function evaluateLanguage(
	embedder: OfflineEmbeddingProvider,
	spec: (typeof LANGUAGES)[number],
) {
	const factDocument = load<{ facts: Fact[] }>(spec.facts);
	const queryDocument = load<{ queries: Query[] }>(spec.queries);
	const corpus = factDocument.facts.flatMap((fact) => [
		{ id: fact.id, text: fact.statement },
		...(fact.distractor?.statement
			? [{ id: fact.distractor.id, text: fact.distractor.statement }]
			: []),
	]);
	const corpusIds = new Set(corpus.map(({ id }) => id));
	const queries = queryDocument.queries.filter(
		(query): query is Query & { fact_ref: string } =>
			Boolean(query.fact_ref && corpusIds.has(query.fact_ref)),
	);
	const vectors = await embedder.embedBatch(corpus.map(({ text }) => text));
	const vectorsById = new Map(
		corpus.map(({ id }, index) => [id, vectors[index]]),
	);
	const queryVectors: number[][] = [];
	for (const query of queries)
		queryVectors.push(await embedder.embed(query.query));
	const index = new BinaryCandidateIndex(
		corpus.map(({ id }) => id),
		vectors,
		embedder.dims,
	);
	const coarseSizes = [20, 50, 100, 200, corpus.length].filter(
		(value, i, all) => value <= corpus.length && all.indexOf(value) === i,
	);
	const baseline = queries.map((query, queryIndex) => ({
		goldId: query.fact_ref,
		baseline: exactTopK(
			corpus.map(({ id }) => id),
			vectors,
			queryVectors[queryIndex],
			TOP_K,
		),
	}));
	const baselineMetrics = summarizeRanked(
		baseline.map((value) => ({ ...value, candidate: value.baseline })),
		"baseline",
	);
	const candidates = coarseSizes.map((coarse) => {
		const comparisons: QueryComparison[] = [];
		const latenciesMs: number[] = [];
		for (let queryIndex = 0; queryIndex < queries.length; queryIndex++) {
			const started = performance.now();
			const binaryIds = index.candidates(queryVectors[queryIndex], coarse);
			const candidate = rerankCandidates(
				binaryIds,
				vectorsById,
				queryVectors[queryIndex],
				TOP_K,
			);
			latenciesMs.push(performance.now() - started);
			comparisons.push({ ...baseline[queryIndex], candidate });
		}
		const metrics = summarizeRanked(comparisons, "candidate");
		const losses = {
			recall1: baselineMetrics.recall1 - metrics.recall1,
			recall5: baselineMetrics.recall5 - metrics.recall5,
			recall10: baselineMetrics.recall10 - metrics.recall10,
			mrr: baselineMetrics.mrr - metrics.mrr,
		};
		const overlap = meanTopKOverlap(comparisons);
		return {
			coarse,
			corpusFraction: coarse / corpus.length,
			overlapAt10: overlap,
			metrics,
			losses,
			searchLatencyMs: {
				p50: percentile(latenciesMs, 0.5),
				p95: percentile(latenciesMs, 0.95),
			},
			passesInternalGate:
				overlap >= MIN_OVERLAP &&
				coarse / corpus.length <= MAX_CANDIDATE_FRACTION &&
				losses.recall1 <= MAX_RECALL_LOSS &&
				losses.recall5 <= MAX_RECALL_LOSS &&
				losses.recall10 <= MAX_RECALL_LOSS &&
				losses.mrr <= MAX_MRR_LOSS,
		};
	});
	index.close();
	return {
		language: spec.language,
		corpusSize: corpus.length,
		queryCount: queries.length,
		baseline: baselineMetrics,
		candidates,
	};
}

async function main() {
	const embedder = new OfflineEmbeddingProvider(MODEL, "cpu");
	const results = [];
	for (const language of LANGUAGES) {
		console.log(
			`Evaluating ${language.language} with real ${MODEL} embeddings on CPU...`,
		);
		results.push(await evaluateLanguage(embedder, language));
	}
	const viable = results[0].candidates
		.filter(
			(candidate) =>
				candidate.passesInternalGate &&
				results.every(
					(result) =>
						result.candidates.find((other) => other.coarse === candidate.coarse)
							?.passesInternalGate,
				),
		)
		.map(({ coarse }) => coarse);
	const selectedCoarse = viable[0] ?? null;
	const datasetPaths = LANGUAGES.flatMap(({ facts, queries }) => [
		facts,
		queries,
	]);
	const artifact = {
		benchmark: "binary-quantization-quality-gate",
		status: selectedCoarse
			? "candidate_for_large_scale_validation"
			: "no_practical_candidate_at_internal_scale",
		limitations: [
			"English is deterministically translated from Korean and is not an independent multilingual corpus.",
			"The 310-row corpus is too small to predict candidate fractions or latency at production scale.",
			"Only single-fact labeled retrieval is evaluated; synthesis, abstention, and lifecycle correctness are out of scope.",
			"Passing this internal gate does not authorize production integration or a public competitiveness claim.",
		],
		selectedCoarse,
		gate: {
			topK: TOP_K,
			minOverlapAt10: MIN_OVERLAP,
			maxRecallLoss: MAX_RECALL_LOSS,
			maxMrrLoss: MAX_MRR_LOSS,
			maxCandidateFraction: MAX_CANDIDATE_FRACTION,
		},
		model: {
			name: MODEL,
			embeddingSpaceId: embedder.embeddingSpaceId,
			dims: embedder.dims,
			device: "cpu",
		},
		results,
		receipt: benchmarkReceipt(
			datasetPaths,
			{
				model: MODEL,
				device: "cpu",
				topK: TOP_K,
				coarseSizes: [20, 50, 100, 200, 310],
			},
			[
				"src/benchmark/quality/binary-quantization-gate.ts",
				"src/benchmark/quality/binary-quantization-gate-cli.ts",
			],
		),
	};
	const output = "reports/quality/binary-quantization-gate-2026-08-22.json";
	mkdirSync(join(process.cwd(), "reports/quality"), { recursive: true });
	writeFileSync(
		join(process.cwd(), output),
		`${JSON.stringify(artifact, null, 2)}\n`,
	);
	console.log(
		JSON.stringify(
			{ output, status: artifact.status, selectedCoarse, results },
			null,
			2,
		),
	);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
