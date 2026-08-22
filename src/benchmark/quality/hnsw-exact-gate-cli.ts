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
	type CorpusGeometryReceipt,
	GEOMETRY_PAIR_COUNT,
	GEOMETRY_SEED,
	PROVISIONAL_GEOMETRY_LIMITS,
	qualifyCorpusGeometry,
} from "./hnsw-corpus-geometry.js";
import {
	rankingsAreStable,
	resolveFactIds,
	summarizeGeneratedInterference,
	summarizeGeneratedInterferenceDetails,
	summarizePreservationByCategory,
	top1Agreement,
} from "./hnsw-exact-gate.js";
import {
	type ContaminationReceipt,
	buildScaleCorpus,
	scaleFactAxesFromId,
} from "./hnsw-scale-corpus.js";
import { loadVectorCache, saveVectorCache } from "./hnsw-vector-cache.js";

const MODEL = "multilingual-e5-large";
const QDRANT_URL = process.env.QDRANT_URL ?? "http://127.0.0.1:6334";
const TOP_K = 10;
const HNSW_EF_VALUES = (
	process.env.BENCH_HNSW_EF_VALUES ?? "16,32,64,128,256,512"
)
	.split(",")
	.map((value) => Number(value.trim()))
	.filter((value) => Number.isInteger(value) && value > 0);
const REPEATS = 3;
const BUILD_REPEATS = Number(process.env.BENCH_BUILD_REPEATS ?? 3);
const HNSW_M = Number(process.env.BENCH_HNSW_M ?? 16);
const HNSW_EF_CONSTRUCT = Number(process.env.BENCH_HNSW_EF_CONSTRUCT ?? 100);
const TARGET_CORPUS_SIZE = Number(process.env.BENCH_CORPUS_SIZE ?? 100_000);
const EMBEDDING_BATCH_SIZE = Number(process.env.BENCH_EMBED_BATCH_SIZE ?? 32);
const UPSERT_BATCH_SIZE = Number(process.env.BENCH_UPSERT_BATCH_SIZE ?? 500);
const INDEX_TIMEOUT_MS = Number(process.env.BENCH_INDEX_TIMEOUT_MS ?? 600_000);
const INDEX_STABLE_POLLS = Number(process.env.BENCH_INDEX_STABLE_POLLS ?? 5);
const VECTOR_CACHE_DIR =
	process.env.BENCH_VECTOR_CACHE_DIR ?? "/tmp/naia-memory-hnsw-vector-cache";
if (HNSW_EF_VALUES.length === 0)
	throw new Error("BENCH_HNSW_EF_VALUES must contain a positive integer");
if (!Number.isInteger(BUILD_REPEATS) || BUILD_REPEATS < 1)
	throw new Error("BENCH_BUILD_REPEATS must be a positive integer");
const RUN_ID = `${TARGET_CORPUS_SIZE}-m${HNSW_M}-efc${HNSW_EF_CONSTRUCT}-ef${HNSW_EF_VALUES.at(-1)}`;
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
	category?: string;
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

interface PreparedCorpus {
	facts: Array<{ id: string; statement: string }>;
	vectors: Float32Array;
	contaminationReceipt: ContaminationReceipt;
	geometryReceipt: CorpusGeometryReceipt;
}

const preparedCorpora = new Map<string, PreparedCorpus>();

class CorpusGeometryRejectedError extends Error {
	constructor(
		readonly language: string,
		readonly geometryReceipt: CorpusGeometryReceipt,
		readonly contaminationReceipt: ContaminationReceipt,
	) {
		super(
			`${language}: synthetic corpus geometry rejected before HNSW evaluation`,
		);
	}
}

class QdrantRest {
	constructor(private readonly baseUrl: string) {}

	private async request<T>(path: string, init?: RequestInit): Promise<T> {
		let response: Response | undefined;
		for (let attempt = 1; attempt <= 3; attempt++) {
			try {
				response = await fetch(`${this.baseUrl}${path}`, {
					...init,
					headers: { "content-type": "application/json", ...init?.headers },
				});
				break;
			} catch (error) {
				if (!(error instanceof TypeError) || attempt === 3) throw error;
				console.warn(
					`Qdrant request transiently failed; retrying (${attempt}/3): ${path}`,
				);
				await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
			}
		}
		if (!response)
			throw new Error(`Qdrant request produced no response: ${path}`);
		const body = (await response.json()) as { result?: T; status?: unknown };
		if (!response.ok) {
			throw new Error(`Qdrant ${response.status}: ${JSON.stringify(body)}`);
		}
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

	update(name: string, body: Record<string, unknown>) {
		return this.request<boolean>(`/collections/${name}`, {
			method: "PATCH",
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
	const deadline = Date.now() + INDEX_TIMEOUT_MS;
	let stablePolls = 0;
	while (Date.now() < deadline) {
		const info = await client.collection(collection);
		if (
			info.status === "green" &&
			(info.indexed_vectors_count ?? 0) >= expectedPoints &&
			info.segments_count <= 2
		) {
			stablePolls++;
			if (stablePolls >= INDEX_STABLE_POLLS) return info;
		} else {
			stablePolls = 0;
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

async function prepareCorpus(
	embedder: OfflineEmbeddingProvider,
	language: string,
	baseFacts: Array<{ id: string; statement: string }>,
	referenceTexts: string[],
): Promise<PreparedCorpus> {
	const existing = preparedCorpora.get(language);
	if (existing) return existing;
	const { facts, receipt } = buildScaleCorpus({
		language,
		baseFacts,
		referenceTexts,
		targetSize: TARGET_CORPUS_SIZE,
	});
	const cacheIdentity = {
		directory: VECTOR_CACHE_DIR,
		language,
		corpusSha256: receipt.corpusSha256,
		embeddingSpaceId: embedder.embeddingSpaceId,
		dims: embedder.dims,
		vectorCount: facts.length,
	};
	const cached = loadVectorCache(cacheIdentity);
	if (cached) {
		console.log(`Loaded ${language} vectors from verified cache`);
		const geometryReceipt = qualifyCorpusGeometry({
			vectors: cached,
			dims: embedder.dims,
			baseSize: baseFacts.length,
		});
		const prepared = {
			facts,
			vectors: cached,
			contaminationReceipt: receipt,
			geometryReceipt,
		};
		preparedCorpora.set(language, prepared);
		return prepared;
	}
	const vectors = new Float32Array(facts.length * embedder.dims);
	for (let offset = 0; offset < facts.length; offset += EMBEDDING_BATCH_SIZE) {
		const batch = facts.slice(offset, offset + EMBEDDING_BATCH_SIZE);
		const embedded = await embedder.embedBatch(
			batch.map(({ statement }) => statement),
		);
		for (let row = 0; row < embedded.length; row++) {
			if (embedded[row].length !== embedder.dims) {
				throw new Error(
					`${language}: embedding dimension mismatch at ${offset + row}`,
				);
			}
			vectors.set(embedded[row], (offset + row) * embedder.dims);
		}
		if (offset === 0 || (offset + batch.length) % 1000 === 0) {
			console.log(
				`Embedded ${language}: ${offset + batch.length}/${facts.length}`,
			);
		}
	}
	saveVectorCache({ ...cacheIdentity, vectors });
	const geometryReceipt = qualifyCorpusGeometry({
		vectors,
		dims: embedder.dims,
		baseSize: baseFacts.length,
	});
	const prepared = {
		facts,
		vectors,
		contaminationReceipt: receipt,
		geometryReceipt,
	};
	preparedCorpora.set(language, prepared);
	return prepared;
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
	const baseFacts = [...primaryFacts, ...backgroundFacts];
	const factIds = new Set(baseFacts.map(({ id }) => id));
	const sourceQueries = load<{ queries: Query[] }>(spec.queries).queries;
	const negativeQueryCount = sourceQueries.filter(
		(query) => query.fact_ref === "NONE",
	).length;
	const queries = sourceQueries.flatMap((query) => {
		const goldIds = resolveFactIds(query.fact_ref, factIds);
		return goldIds.length > 0
			? [
					{
						query: query.query,
						goldIds,
						category: query.category ?? "uncategorized",
					},
				]
			: [];
	});
	if (queries.length + negativeQueryCount !== sourceQueries.length) {
		throw new Error(
			`${spec.language}: resolved ${queries.length} positive and ${negativeQueryCount} explicit negative queries from ${sourceQueries.length} source queries`,
		);
	}
	const prepared = await prepareCorpus(
		embedder,
		spec.language,
		baseFacts,
		sourceQueries.map(({ query }) => query),
	);
	const { facts, vectors: factVectors } = prepared;
	if (!prepared.geometryReceipt.passed) {
		throw new CorpusGeometryRejectedError(
			spec.language,
			prepared.geometryReceipt,
			prepared.contaminationReceipt,
		);
	}
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
		hnsw_config: { m: 0, ef_construct: 100, full_scan_threshold: 10 },
		optimizers_config: { indexing_threshold: 0, default_segment_number: 1 },
	});
	for (let offset = 0; offset < facts.length; offset += UPSERT_BATCH_SIZE) {
		await client.upsert(
			collection,
			facts
				.slice(offset, offset + UPSERT_BATCH_SIZE)
				.map((fact, batchIndex) => ({
					id: offset + batchIndex + 1,
					vector: Array.from(
						factVectors.subarray(
							(offset + batchIndex) * embedder.dims,
							(offset + batchIndex + 1) * embedder.dims,
						),
					),
					payload: { factId: fact.id },
				})),
		);
	}
	await client.update(collection, {
		hnsw_config: {
			m: HNSW_M,
			ef_construct: HNSW_EF_CONSTRUCT,
			full_scan_threshold: 10,
		},
		optimizers_config: { indexing_threshold: 1, default_segment_number: 1 },
	});
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
			preservationByCategory: summarizePreservationByCategory(
				rankingPairs,
				queries.map(({ category }) => category),
			),
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
		contaminationReceipt: prepared.contaminationReceipt,
		geometryReceipt: prepared.geometryReceipt,
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
			generatedInterference: summarizeGeneratedInterference(exactRankings),
			generatedInterferenceDetails: summarizeGeneratedInterferenceDetails(
				exactRankings,
				queries.map(({ category }) => category),
				(id) => scaleFactAxesFromId(id)?.templateIndex ?? null,
			),
			latencyMs: {
				p50: percentile(exactLatencies, 0.5),
				p95: percentile(exactLatencies, 0.95),
			},
		},
		candidates,
	};
}

async function main() {
	for (const [name, value] of Object.entries({
		BENCH_CORPUS_SIZE: TARGET_CORPUS_SIZE,
		BENCH_EMBED_BATCH_SIZE: EMBEDDING_BATCH_SIZE,
		BENCH_UPSERT_BATCH_SIZE: UPSERT_BATCH_SIZE,
		BENCH_INDEX_TIMEOUT_MS: INDEX_TIMEOUT_MS,
		BENCH_INDEX_STABLE_POLLS: INDEX_STABLE_POLLS,
	})) {
		if (!Number.isSafeInteger(value) || value <= 0) {
			throw new Error(`${name} must be a positive safe integer`);
		}
	}
	const client = new QdrantRest(QDRANT_URL);
	const service = (await fetch(QDRANT_URL).then((response) =>
		response.json(),
	)) as {
		version?: string;
	};
	const embedder = new OfflineEmbeddingProvider(MODEL, "cpu");
	const results = [];
	const paths = LANGUAGES.flatMap(({ facts, background, queries }) => [
		facts,
		background,
		queries,
	]);
	for (const language of LANGUAGES) {
		for (let buildIndex = 1; buildIndex <= BUILD_REPEATS; buildIndex++) {
			console.log(
				`Evaluating ${language.language} build ${buildIndex}/${BUILD_REPEATS} against exact Qdrant search...`,
			);
			try {
				results.push(
					await evaluateLanguage(client, embedder, language, buildIndex),
				);
			} catch (error) {
				if (!(error instanceof CorpusGeometryRejectedError)) throw error;
				const output = `reports/quality/hnsw-exact-scale-gate-geometry-rejected-${RUN_ID}.json`;
				const artifact = {
					benchmark: "qdrant-hnsw-exact-quality-gate",
					status: "corpus_geometry_rejected",
					language: error.language,
					geometryReceipt: error.geometryReceipt,
					contaminationReceipt: error.contaminationReceipt,
					gate: {
						policy: "density-inflation-guard",
						maxAllowedDelta: PROVISIONAL_GEOMETRY_LIMITS,
						pairCount: GEOMETRY_PAIR_COUNT,
						seed: GEOMETRY_SEED,
					},
					model: {
						name: MODEL,
						dims: embedder.dims,
						embeddingSpaceId: embedder.embeddingSpaceId,
						device: "cpu",
					},
					receipt: benchmarkReceipt(
						paths,
						{
							model: MODEL,
							device: "cpu",
							targetCorpusSize: TARGET_CORPUS_SIZE,
							geometryPolicy: "density-inflation-guard",
							geometryMaxAllowedDelta: PROVISIONAL_GEOMETRY_LIMITS,
							geometryPairCount: GEOMETRY_PAIR_COUNT,
							geometrySeed: GEOMETRY_SEED,
						},
						[
							"src/benchmark/quality/hnsw-exact-gate-cli.ts",
							"src/benchmark/quality/hnsw-scale-corpus.ts",
							"src/benchmark/quality/hnsw-vector-cache.ts",
							"src/benchmark/quality/hnsw-corpus-geometry.ts",
							"src/benchmark/quality/hnsw-corpus-geometry.test.ts",
						],
					),
				};
				mkdirSync(join(process.cwd(), "reports/quality"), { recursive: true });
				writeFileSync(
					join(process.cwd(), output),
					`${JSON.stringify(artifact, null, 2)}\n`,
				);
				console.log(
					JSON.stringify({ output, status: artifact.status }, null, 2),
				);
				return;
			}
		}
		preparedCorpora.delete(language.language);
	}
	const selectedEf =
		HNSW_EF_VALUES.find((hnswEf) =>
			results.every(
				(result) =>
					result.candidates.find((candidate) => candidate.hnswEf === hnswEf)
						?.passesQualityGate,
			),
		) ?? null;
	const artifact = {
		benchmark: "qdrant-hnsw-exact-quality-gate",
		status: selectedEf
			? TARGET_CORPUS_SIZE >= 100_000
				? "scale_quality_gate_passed"
				: "diagnostic_only_below_scale_floor"
			: "quality_gate_rejected",
		selectedEf,
		gate: {
			topK: TOP_K,
			minOverlapAt10: MIN_OVERLAP,
			minTop1Agreement: MIN_TOP1_AGREEMENT,
			maxRecallLoss: MAX_RECALL_LOSS,
			geometryPolicy: "density-inflation-guard",
			geometryMaxAllowedDelta: PROVISIONAL_GEOMETRY_LIMITS,
			geometryPairCount: GEOMETRY_PAIR_COUNT,
			geometrySeed: GEOMETRY_SEED,
			hnswM: HNSW_M,
			hnswEfConstruct: HNSW_EF_CONSTRUCT,
		},
		service: { engine: "Qdrant", version: service.version, url: QDRANT_URL },
		model: {
			name: MODEL,
			dims: embedder.dims,
			embeddingSpaceId: embedder.embeddingSpaceId,
			device: "cpu",
		},
		limitations: [
			"This experiment qualifies approximate-vs-exact retrieval preservation only; it does not establish cross-engine superiority.",
			"Scale distractors are deterministic synthetic facts, not independently authored user memories; passing does not establish production workload validity.",
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
				hnswM: HNSW_M,
				hnswEfConstruct: HNSW_EF_CONSTRUCT,
				repeats: REPEATS,
				buildRepeats: BUILD_REPEATS,
				targetCorpusSize: TARGET_CORPUS_SIZE,
				embeddingBatchSize: EMBEDDING_BATCH_SIZE,
				upsertBatchSize: UPSERT_BATCH_SIZE,
				indexTimeoutMs: INDEX_TIMEOUT_MS,
				indexStablePolls: INDEX_STABLE_POLLS,
				indexBuildStrategy:
					"upload-with-indexing-disabled-then-build-single-segment",
			},
			[
				"src/benchmark/quality/binary-quantization-gate.ts",
				"src/benchmark/quality/hnsw-exact-gate.ts",
				"src/benchmark/quality/hnsw-exact-gate-cli.ts",
				"src/benchmark/quality/hnsw-exact-gate-cli.test.ts",
				"src/benchmark/quality/hnsw-scale-corpus.ts",
				"src/benchmark/quality/hnsw-scale-corpus.test.ts",
				"src/benchmark/quality/hnsw-vector-cache.ts",
				"src/benchmark/quality/hnsw-vector-cache.test.ts",
				"src/benchmark/quality/hnsw-corpus-geometry.ts",
				"src/benchmark/quality/hnsw-corpus-geometry.test.ts",
			],
		),
	};
	const output = `reports/quality/hnsw-exact-scale-gate-${RUN_ID}-2026-08-22.json`;
	mkdirSync(join(process.cwd(), "reports/quality"), { recursive: true });
	writeFileSync(
		join(process.cwd(), output),
		`${JSON.stringify(artifact, null, 2)}\n`,
	);
	console.log(
		JSON.stringify(
			{
				output,
				status: artifact.status,
				selectedEf,
				resultCount: results.length,
				corpusSizes: [...new Set(results.map(({ corpusSize }) => corpusSize))],
			},
			null,
			2,
		),
	);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
