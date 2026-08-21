import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { OfflineEmbeddingProvider } from "../../memory/embeddings.js";
import { benchmarkReceipt } from "../provenance.js";
import {
	type RankedMetrics,
	meanTopKOverlap,
} from "./binary-quantization-gate.js";
import {
	rankingsAreStable,
	resolveFactIds,
	top1Agreement,
} from "./hnsw-exact-gate.js";

const MODEL = "multilingual-e5-large";
const QDRANT_URL = process.env.QDRANT_URL ?? "http://127.0.0.1:6334";
const TOP_K = 10;
const HNSW_EF_VALUES = [16, 32, 64, 128, 256, 512] as const;
const REPEATS = 3;
const BUILD_REPEATS = 3;
const MIN_OVERLAP = 0.98;
const MIN_TOP1_AGREEMENT = 0.99;
const MAX_RECALL_LOSS = 0.01;
const LANGUAGES = [
	{
		language: "ko",
		facts: "src/benchmark/fact-bank-v2.json",
		background: "src/benchmark/fact-bank.json",
		queries: "src/benchmark/query-templates-v2.json",
	},
	{
		language: "en-translated",
		facts: "src/benchmark/fact-bank-v2.en.json",
		background: "src/benchmark/fact-bank.en.json",
		queries: "src/benchmark/query-templates-v2.en.json",
	},
] as const;

interface Fact {
	id: string;
	statement: string;
	distractor?: { id: string; statement: string };
}

interface Query {
	fact_ref?: string | string[];
	query: string;
}

interface MultiGoldComparison {
	goldIds: string[];
	baseline: string[];
	candidate: string[];
}

interface CollectionInfo {
	status: string;
	indexed_vectors_count?: number | null;
	points_count?: number | null;
	segments_count: number;
	config: {
		hnsw_config: Record<string, unknown>;
		optimizer_config: Record<string, unknown>;
	};
}

class QdrantRest {
	constructor(private readonly baseUrl: string) {}

	private async request<T>(path: string, init?: RequestInit): Promise<T> {
		const response = await fetch(`${this.baseUrl}${path}`, {
			...init,
			headers: { "content-type": "application/json", ...init?.headers },
		});
		const body = (await response.json()) as { result?: T; status?: unknown };
		if (!response.ok)
			throw new Error(`Qdrant ${response.status}: ${JSON.stringify(body)}`);
		return body.result as T;
	}

	collections() {
		return this.request<{ collections: Array<{ name: string }> }>(
			"/collections",
		);
	}

	collection(name: string) {
		return this.request<CollectionInfo>(`/collections/${name}`);
	}

	create(name: string, body: Record<string, unknown>) {
		return this.request<boolean>(`/collections/${name}`, {
			method: "PUT",
			body: JSON.stringify(body),
		});
	}

	delete(name: string) {
		return this.request<boolean>(`/collections/${name}`, { method: "DELETE" });
	}

	upsert(name: string, points: Array<Record<string, unknown>>) {
		return this.request(`/collections/${name}/points?wait=true`, {
			method: "PUT",
			body: JSON.stringify({ points }),
		});
	}

	search(name: string, body: Record<string, unknown>) {
		return this.request<Array<{ payload?: { factId?: string } }>>(
			`/collections/${name}/points/search`,
			{ method: "POST", body: JSON.stringify(body) },
		);
	}
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

function summarizeMultiGold(
	comparisons: MultiGoldComparison[],
	key: "baseline" | "candidate",
): RankedMetrics {
	let recall1 = 0;
	let recall5 = 0;
	let recall10 = 0;
	let reciprocalRank = 0;
	for (const comparison of comparisons) {
		const accepted = new Set(comparison.goldIds);
		const rank = comparison[key].findIndex((id) => accepted.has(id));
		if (rank === 0) recall1++;
		if (rank >= 0 && rank < 5) recall5++;
		if (rank >= 0 && rank < 10) recall10++;
		if (rank >= 0) reciprocalRank += 1 / (rank + 1);
	}
	const count = comparisons.length;
	return {
		recall1: recall1 / count,
		recall5: recall5 / count,
		recall10: recall10 / count,
		mrr: reciprocalRank / count,
	};
}

async function waitForIndex(
	client: QdrantRest,
	collection: string,
	expectedPoints: number,
) {
	const deadline = Date.now() + 120_000;
	while (Date.now() < deadline) {
		const info = await client.collection(collection);
		if (
			info.status === "green" &&
			(info.indexed_vectors_count ?? 0) >= expectedPoints
		) {
			return info;
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`HNSW index did not become ready for ${collection}`);
}

async function rankedSearch(
	client: QdrantRest,
	collection: string,
	vector: number[],
	params: { exact: boolean; hnsw_ef?: number },
): Promise<string[]> {
	const points = await client.search(collection, {
		vector,
		limit: TOP_K,
		with_payload: true,
		params,
	});
	return points.map((point) => String(point.payload?.factId));
}

async function evaluateLanguage(
	client: QdrantRest,
	embedder: OfflineEmbeddingProvider,
	spec: (typeof LANGUAGES)[number],
	buildIndex: number,
) {
	const primaryFacts = load<{ facts: Fact[] }>(spec.facts).facts.flatMap(
		(fact) => [
			{ id: fact.id, statement: fact.statement },
			...(fact.distractor
				? [{ id: fact.distractor.id, statement: fact.distractor.statement }]
				: []),
		],
	);
	const backgroundFacts = load<{ facts: Fact[] }>(spec.background).facts.map(
		(fact) => ({
			id: `background-${fact.id}`,
			statement: fact.statement,
		}),
	);
	const facts = [...primaryFacts, ...backgroundFacts];
	const factIds = new Set(facts.map(({ id }) => id));
	const sourceQueries = load<{ queries: Query[] }>(spec.queries).queries;
	const negativeQueryCount = sourceQueries.filter(
		(query) => query.fact_ref === "NONE",
	).length;
	const queries = sourceQueries.flatMap((query) => {
		const goldIds = resolveFactIds(query.fact_ref, factIds);
		return goldIds.length > 0 ? [{ query: query.query, goldIds }] : [];
	});
	if (queries.length + negativeQueryCount !== sourceQueries.length) {
		throw new Error(
			`${spec.language}: resolved ${queries.length} positive and ${negativeQueryCount} explicit negative queries from ${sourceQueries.length} source queries`,
		);
	}
	const factVectors = await embedder.embedBatch(
		facts.map(({ statement }) => statement),
	);
	const queryVectors: number[][] = [];
	for (const query of queries)
		queryVectors.push(await embedder.embed(query.query));

	const collection = `naia_hnsw_gate_${spec.language.replaceAll("-", "_")}_${buildIndex}`;
	const existing = await client.collections();
	if (existing.collections.some(({ name }) => name === collection)) {
		await client.delete(collection);
	}
	await client.create(collection, {
		vectors: { size: embedder.dims, distance: "Cosine" },
		hnsw_config: { m: 16, ef_construct: 100, full_scan_threshold: 10 },
		optimizers_config: { indexing_threshold: 1 },
	});
	for (let offset = 0; offset < facts.length; offset += 100) {
		await client.upsert(
			collection,
			facts.slice(offset, offset + 100).map((fact, batchIndex) => ({
				id: offset + batchIndex + 1,
				vector: factVectors[offset + batchIndex],
				payload: { factId: fact.id },
			})),
		);
	}
	const indexInfo = await waitForIndex(client, collection, facts.length);

	const exactRankings: string[][] = [];
	const exactLatencies: number[] = [];
	for (const vector of queryVectors) {
		const started = performance.now();
		exactRankings.push(
			await rankedSearch(client, collection, vector, { exact: true }),
		);
		exactLatencies.push(performance.now() - started);
	}
	const baselineComparisons: MultiGoldComparison[] = queries.map(
		(query, index) => ({
			goldIds: query.goldIds,
			baseline: exactRankings[index],
			candidate: exactRankings[index],
		}),
	);
	const baselineMetrics = summarizeMultiGold(baselineComparisons, "baseline");

	const candidates = [];
	for (const hnswEf of HNSW_EF_VALUES) {
		const comparisons: MultiGoldComparison[] = [];
		const latencies: number[] = [];
		let stableAcrossRepeats = true;
		for (let queryIndex = 0; queryIndex < queries.length; queryIndex++) {
			let candidate: string[] = [];
			const repeatRankings: string[][] = [];
			for (let repeat = 0; repeat < REPEATS; repeat++) {
				const started = performance.now();
				candidate = await rankedSearch(
					client,
					collection,
					queryVectors[queryIndex],
					{
						exact: false,
						hnsw_ef: hnswEf,
					},
				);
				latencies.push(performance.now() - started);
				repeatRankings.push(candidate);
			}
			stableAcrossRepeats &&= rankingsAreStable(repeatRankings);
			comparisons.push({
				goldIds: queries[queryIndex].goldIds,
				baseline: exactRankings[queryIndex],
				candidate,
			});
		}
		const metrics = summarizeMultiGold(comparisons, "candidate");
		const recallLoss = {
			recall1: baselineMetrics.recall1 - metrics.recall1,
			recall5: baselineMetrics.recall5 - metrics.recall5,
			recall10: baselineMetrics.recall10 - metrics.recall10,
			mrr: baselineMetrics.mrr - metrics.mrr,
		};
		const rankingPairs = comparisons.map(({ baseline, candidate }) => ({
			goldId: "unused",
			baseline,
			candidate,
		}));
		const overlapAt10 = meanTopKOverlap(rankingPairs);
		const agreementAt1 = top1Agreement(rankingPairs);
		candidates.push({
			hnswEf,
			overlapAt10,
			agreementAt1,
			metrics,
			recallLoss,
			stableAcrossRepeats,
			latencyMs: {
				p50: percentile(latencies, 0.5),
				p95: percentile(latencies, 0.95),
			},
			passesQualityGate:
				stableAcrossRepeats &&
				overlapAt10 >= MIN_OVERLAP &&
				agreementAt1 >= MIN_TOP1_AGREEMENT &&
				recallLoss.recall1 <= MAX_RECALL_LOSS &&
				recallLoss.recall5 <= MAX_RECALL_LOSS &&
				recallLoss.recall10 <= MAX_RECALL_LOSS &&
				recallLoss.mrr <= MAX_RECALL_LOSS,
		});
	}
	await client.delete(collection);
	return {
		language: spec.language,
		buildIndex,
		corpusSize: facts.length,
		sourceQueryCount: sourceQueries.length,
		queryCount: queries.length,
		negativeQueryCount,
		indexReceipt: {
			status: indexInfo.status,
			pointsCount: indexInfo.points_count,
			indexedVectorsCount: indexInfo.indexed_vectors_count,
			segmentsCount: indexInfo.segments_count,
			hnswConfig: indexInfo.config.hnsw_config,
			optimizerConfig: indexInfo.config.optimizer_config,
		},
		baseline: {
			metrics: baselineMetrics,
			latencyMs: {
				p50: percentile(exactLatencies, 0.5),
				p95: percentile(exactLatencies, 0.95),
			},
		},
		candidates,
	};
}

async function main() {
	const client = new QdrantRest(QDRANT_URL);
	const service = (await fetch(QDRANT_URL).then((response) =>
		response.json(),
	)) as {
		version?: string;
	};
	const embedder = new OfflineEmbeddingProvider(MODEL, "cpu");
	const results = [];
	for (const language of LANGUAGES) {
		for (let buildIndex = 1; buildIndex <= BUILD_REPEATS; buildIndex++) {
			console.log(
				`Evaluating ${language.language} build ${buildIndex}/${BUILD_REPEATS} against exact Qdrant search...`,
			);
			results.push(
				await evaluateLanguage(client, embedder, language, buildIndex),
			);
		}
	}
	const selectedEf =
		HNSW_EF_VALUES.find((hnswEf) =>
			results.every(
				(result) =>
					result.candidates.find((candidate) => candidate.hnswEf === hnswEf)
						?.passesQualityGate,
			),
		) ?? null;
	const paths = LANGUAGES.flatMap(({ facts, background, queries }) => [
		facts,
		background,
		queries,
	]);
	const artifact = {
		benchmark: "qdrant-hnsw-exact-quality-gate",
		status: selectedEf
			? "candidate_for_100k_scale_validation"
			: "quality_gate_rejected",
		selectedEf,
		gate: {
			topK: TOP_K,
			minOverlapAt10: MIN_OVERLAP,
			minTop1Agreement: MIN_TOP1_AGREEMENT,
			maxRecallLoss: MAX_RECALL_LOSS,
		},
		service: { engine: "Qdrant", version: service.version, url: QDRANT_URL },
		model: {
			name: MODEL,
			dims: embedder.dims,
			embeddingSpaceId: embedder.embeddingSpaceId,
			device: "cpu",
		},
		limitations: [
			"This 1,310-fact experiment qualifies retrieval quality only; naia-memory requires at least 100,000 facts for scale or latency claims.",
			"The labeled v2 corpus is augmented with 1,000 namespaced legacy facts as background distractors; this is not an independently authored scale corpus.",
			"English is a deterministic translation of the Korean corpus, not an independently authored multilingual benchmark.",
			"Exact and approximate searches use the same Qdrant service, so latency includes local REST overhead and is not a cross-engine comparison.",
			"Passing does not authorize product integration or a public competitiveness claim.",
		],
		results,
		receipt: benchmarkReceipt(
			paths,
			{
				model: MODEL,
				device: "cpu",
				qdrantVersion: service.version,
				topK: TOP_K,
				hnswEfValues: HNSW_EF_VALUES,
				repeats: REPEATS,
				buildRepeats: BUILD_REPEATS,
			},
			[
				"src/benchmark/quality/binary-quantization-gate.ts",
				"src/benchmark/quality/hnsw-exact-gate.ts",
				"src/benchmark/quality/hnsw-exact-gate-cli.ts",
				"src/benchmark/quality/hnsw-exact-gate-cli.test.ts",
			],
		),
	};
	const output = "reports/quality/hnsw-exact-gate-2026-08-22.json";
	mkdirSync(join(process.cwd(), "reports/quality"), { recursive: true });
	writeFileSync(
		join(process.cwd(), output),
		`${JSON.stringify(artifact, null, 2)}\n`,
	);
	console.log(
		JSON.stringify(
			{ output, status: artifact.status, selectedEf, results },
			null,
			2,
		),
	);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
