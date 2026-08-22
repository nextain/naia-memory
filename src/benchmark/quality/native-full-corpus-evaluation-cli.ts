#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import {
	OFFLINE_MODEL_REVISIONS,
	OfflineEmbeddingProvider,
} from "../../memory/embeddings.js";
import { scanNativeCorpusDocuments } from "./native-corpus-extract.js";
import {
	loadFullCorpusChunk,
	recoverIncompleteFullCorpusChunk,
	saveFullCorpusChunk,
} from "./native-full-corpus-checkpoint.js";
import {
	MIRACL_KO_LOCK,
	parseQrelsTsv,
	parseTopicsTsv,
	verifyLockedFile,
} from "./public-miracl-source.js";
import { summarizeRetrievalMetrics } from "./retrieval-metrics.js";

const MODEL = "multilingual-e5-large";
const MODEL_REVISION = OFFLINE_MODEL_REVISIONS[MODEL];
const EXPECTED_DOCUMENTS = 1_486_752;
const EXPECTED_QUERIES = 213;
const TOP_K = 100;
const CHUNK_SIZE = 512;
const EMBEDDING_BATCH_SIZE = 8;
const UPSERT_BATCH_SIZE = 64;
const QDRANT_URL = process.env.QDRANT_URL ?? "http://127.0.0.1:6334";
const PASSAGE_COMPOSITION = 'title + "\\n" + text';
const SOURCE_ROOT =
	process.env.MIRACL_SOURCE_DIR ?? ".cache/benchmark-sources/miracl-ko-v1.0";
const CHECKPOINT_ROOT =
	process.env.MIRACL_FULL_CHECKPOINT_DIR ??
	".cache/benchmark-runs/miracl-ko-full-v1";
const OUTPUT =
	process.env.MIRACL_FULL_OUTPUT ??
	"reports/quality/miracl-ko-full-corpus-vector-exact.json";

function sha256(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function atomicWrite(path: string, contents: string): void {
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, contents, { flag: "wx", mode: 0o600 });
	renameSync(temporary, path);
}

function positiveInteger(name: string, value: number): void {
	if (!Number.isSafeInteger(value) || value < 1)
		throw new Error(`${name} must be a positive safe integer`);
}

interface QdrantCollectionInfo {
	status: string;
	points_count?: number | null;
	config: {
		params: { vectors: { size: number; distance: string } };
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

	async collectionOrNull(name: string): Promise<QdrantCollectionInfo | null> {
		const response = await fetch(`${this.baseUrl}/collections/${name}`);
		if (response.status === 404) return null;
		const body = (await response.json()) as {
			result?: QdrantCollectionInfo;
			status?: unknown;
		};
		if (!response.ok)
			throw new Error(`Qdrant ${response.status}: ${JSON.stringify(body)}`);
		if (!body.result)
			throw new Error("Qdrant collection response has no result");
		return body.result;
	}

	create(name: string, dimensions: number) {
		return this.request<boolean>(`/collections/${name}`, {
			method: "PUT",
			body: JSON.stringify({
				vectors: { size: dimensions, distance: "Cosine", on_disk: true },
				hnsw_config: { m: 0 },
				optimizers_config: { indexing_threshold: 0 },
			}),
		});
	}

	upsert(
		name: string,
		points: Array<{ id: number; vector: number[]; payload: { docid: string } }>,
	) {
		return this.request(`/collections/${name}/points?wait=true`, {
			method: "PUT",
			body: JSON.stringify({ points }),
		});
	}

	search(name: string, vector: number[]) {
		return this.request<Array<{ payload?: { docid?: string }; score: number }>>(
			`/collections/${name}/points/search`,
			{
				method: "POST",
				body: JSON.stringify({
					vector,
					limit: TOP_K,
					with_payload: true,
					params: { exact: true },
				}),
			},
		);
	}
}

async function main(): Promise<void> {
	if (process.env.CUDA_VISIBLE_DEVICES !== "")
		throw new Error(
			"CUDA_VISIBLE_DEVICES must be the empty string for CPU-only evidence",
		);
	positiveInteger("CHUNK_SIZE", CHUNK_SIZE);
	positiveInteger("EMBEDDING_BATCH_SIZE", EMBEDDING_BATCH_SIZE);
	positiveInteger("UPSERT_BATCH_SIZE", UPSERT_BATCH_SIZE);
	if (existsSync(OUTPUT)) throw new Error("full-corpus output already exists");
	await Promise.all(
		MIRACL_KO_LOCK.files.map(({ path, size, sha256: expectedSha256 }) =>
			verifyLockedFile(join(SOURCE_ROOT, path), {
				size,
				sha256: expectedSha256,
			}),
		),
	);

	const sourceLockSha256 = sha256(canonical(MIRACL_KO_LOCK));
	const embedder = new OfflineEmbeddingProvider(MODEL, "cpu", MODEL_REVISION);
	const embeddingPolicySha256 = sha256(
		canonical({
			modelPolicy: embedder.policyReceipt,
			passageComposition: PASSAGE_COMPOSITION,
		}),
	);
	const collectionName = `naia_miracl_ko_${sourceLockSha256.slice(0, 8)}_${embeddingPolicySha256.slice(0, 8)}`;
	const checkpointDirectory = join(CHECKPOINT_ROOT, "vectors");
	mkdirSync(checkpointDirectory, { recursive: true, mode: 0o700 });
	const client = new QdrantRest(QDRANT_URL);
	const existing = await client.collectionOrNull(collectionName);
	if (existing) {
		if (
			existing.config.params.vectors.size !== embedder.dims ||
			existing.config.params.vectors.distance.toLowerCase() !== "cosine"
		)
			throw new Error(
				"existing Qdrant collection does not match locked policy",
			);
	} else await client.create(collectionName, embedder.dims);

	let previousReceiptSha256: string | null = null;
	let cachedDocuments = 0;
	let embeddedDocuments = 0;
	let indexedDocuments = 0;
	let batch: Array<{ docid: string; content: string; ordinal: number }> = [];
	const ingestionStarted = performance.now();

	const processChunk = async () => {
		if (batch.length === 0) return;
		const startOrdinal = batch[0]?.ordinal;
		if (startOrdinal === undefined) throw new Error("empty chunk ordinal");
		const identity = {
			sourceLockSha256,
			embeddingPolicySha256,
			dimensions: embedder.dims,
			startOrdinal,
			documentCount: batch.length,
		};
		recoverIncompleteFullCorpusChunk({
			directory: checkpointDirectory,
			startOrdinal,
		});
		let loaded = loadFullCorpusChunk({
			directory: checkpointDirectory,
			identity,
			expectedPreviousReceiptSha256: previousReceiptSha256,
		});
		if (loaded?.docids.some((docid, index) => docid !== batch[index]?.docid))
			throw new Error(`checkpoint corpus order mismatch at ${startOrdinal}`);
		if (!loaded) {
			const vectors = new Float32Array(batch.length * embedder.dims);
			for (
				let offset = 0;
				offset < batch.length;
				offset += EMBEDDING_BATCH_SIZE
			) {
				const rows = batch.slice(offset, offset + EMBEDDING_BATCH_SIZE);
				const embedded = await embedder.embedBatch(
					rows.map(({ content }) => content),
				);
				if (
					embedded.length !== rows.length ||
					embedded.some(
						(vector) =>
							vector.length !== embedder.dims ||
							vector.some((value) => !Number.isFinite(value)),
					)
				)
					throw new Error(
						`invalid embedding batch at ${startOrdinal + offset}`,
					);
				for (const [index, vector] of embedded.entries())
					vectors.set(vector, (offset + index) * embedder.dims);
			}
			const saved = saveFullCorpusChunk({
				directory: checkpointDirectory,
				identity,
				docids: batch.map(({ docid }) => docid),
				vectors,
				previousReceiptSha256,
			});
			loaded = {
				docids: batch.map(({ docid }) => docid),
				vectors,
				receipt: saved.receipt,
				receiptSha256: saved.receiptSha256,
			};
			embeddedDocuments += batch.length;
		} else cachedDocuments += batch.length;

		for (let offset = 0; offset < batch.length; offset += UPSERT_BATCH_SIZE) {
			const rows = batch.slice(offset, offset + UPSERT_BATCH_SIZE);
			await client.upsert(
				collectionName,
				rows.map((row, index) => {
					const vectorIndex = offset + index;
					return {
						id: row.ordinal + 1,
						vector: Array.from(
							loaded?.vectors.subarray(
								vectorIndex * embedder.dims,
								(vectorIndex + 1) * embedder.dims,
							) ?? [],
						),
						payload: { docid: row.docid },
					};
				}),
			);
		}
		previousReceiptSha256 = loaded.receiptSha256;
		indexedDocuments += batch.length;
		if (indexedDocuments % 10_240 === 0 || batch.length < CHUNK_SIZE)
			console.error(
				`indexed ${indexedDocuments}/${EXPECTED_DOCUMENTS} (embedded=${embeddedDocuments}, cached=${cachedDocuments})`,
			);
		batch = [];
	};

	const shards = MIRACL_KO_LOCK.files
		.slice(2)
		.map(({ path }) => join(SOURCE_ROOT, path));
	const scanReceipt = await scanNativeCorpusDocuments(
		shards,
		async (document, ordinal) => {
			batch.push({
				docid: document.docid,
				content: `${document.title}\n${document.text}`,
				ordinal,
			});
			if (batch.length === CHUNK_SIZE) await processChunk();
		},
	);
	await processChunk();
	if (
		scanReceipt.documentCount !== EXPECTED_DOCUMENTS ||
		indexedDocuments !== EXPECTED_DOCUMENTS
	)
		throw new Error("full corpus document count mismatch");
	const collection = await client.collectionOrNull(collectionName);
	if (collection?.points_count !== EXPECTED_DOCUMENTS)
		throw new Error(
			`Qdrant point count mismatch: ${collection?.points_count ?? "missing"}`,
		);

	const topicsText = readFileSync(
		join(SOURCE_ROOT, MIRACL_KO_LOCK.files[0].path),
		"utf8",
	);
	const qrelsText = readFileSync(
		join(SOURCE_ROOT, MIRACL_KO_LOCK.files[1].path),
		"utf8",
	);
	const topics = parseTopicsTsv(topicsText);
	const qrels = parseQrelsTsv(qrelsText);
	if (topics.size !== EXPECTED_QUERIES || qrels.size !== EXPECTED_QUERIES)
		throw new Error("full corpus query count mismatch");
	const rankings: Array<{
		queryId: string;
		ranking: string[];
		milliseconds: number;
	}> = [];
	for (const [index, [queryId, query]] of [...topics].entries()) {
		const started = performance.now();
		const vector = await embedder.embed(query);
		const results = await client.search(collectionName, vector);
		const ranking = results.map(({ payload }) => payload?.docid ?? "");
		if (
			ranking.length !== TOP_K ||
			ranking.some((docid) => docid.length === 0) ||
			new Set(ranking).size !== TOP_K
		)
			throw new Error(`${queryId}: invalid Qdrant ranking`);
		rankings.push({
			queryId,
			ranking,
			milliseconds: performance.now() - started,
		});
		console.error(`searched ${index + 1}/${topics.size}`);
	}
	const comparisons = rankings.map(({ queryId, ranking }) => ({
		relevantIds: qrels.get(queryId) ?? [],
		ranking,
	}));
	const metrics = summarizeRetrievalMetrics(comparisons);
	const recallAt100 =
		comparisons.reduce((sum, { relevantIds, ranking }) => {
			const relevant = new Set(relevantIds);
			return (
				sum + ranking.filter((id) => relevant.has(id)).length / relevant.size
			);
		}, 0) / comparisons.length;
	const trec = `${rankings
		.flatMap(({ queryId, ranking }) =>
			ranking.map(
				(documentId, index) =>
					`${queryId} Q0 ${documentId} ${index + 1} ${TOP_K - index} naia-vector-exact`,
			),
		)
		.join("\n")}\n`;
	const result = {
		benchmark: "miracl-ko-full-corpus-naia-vector-exact-v1",
		claimBoundary:
			"full-corpus embedding retrieval only; excludes Naia lifecycle, lexical fusion, and ANN quality",
		inputs: {
			sourceLockSha256,
			topicsSha256: sha256(topicsText),
			qrelsSha256: sha256(qrelsText),
			corpusDocidsSha256: scanReceipt.docidsSha256,
			documentCount: scanReceipt.documentCount,
			queryCount: topics.size,
		},
		configuration: {
			passageComposition: PASSAGE_COMPOSITION,
			embedding: embedder.policyReceipt,
			vectorStore: "Qdrant",
			distance: "Cosine",
			exactSearch: true,
			topK: TOP_K,
			cpuOnly: true,
			collectionName,
		},
		metrics: { ...metrics, recallAt100 },
		latencyMilliseconds: {
			mean:
				rankings.reduce((sum, row) => sum + row.milliseconds, 0) /
				rankings.length,
			max: Math.max(...rankings.map(({ milliseconds }) => milliseconds)),
		},
		ingestion: {
			seconds: (performance.now() - ingestionStarted) / 1000,
			embeddedDocuments,
			cachedDocuments,
			lastChunkReceiptSha256: previousReceiptSha256,
		},
		trecSha256: sha256(trec),
	};
	mkdirSync(dirname(OUTPUT), { recursive: true });
	atomicWrite(`${OUTPUT}.trec`, trec);
	atomicWrite(OUTPUT, canonical(result));
	process.stdout.write(canonical(result));
}

await main();
