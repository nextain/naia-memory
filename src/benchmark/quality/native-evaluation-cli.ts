import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { searchLocalSemanticMemory } from "../../memory/adapters/local-semantic-search.js";
import {
	OFFLINE_MODEL_REVISIONS,
	OfflineEmbeddingProvider,
} from "../../memory/embeddings.js";
import { KnowledgeGraph, emptyKGState } from "../../memory/knowledge-graph.js";
import type { Fact } from "../../memory/types.js";
import {
	canonicalNativeCorpusJsonl,
	extractNativeCorpusDocuments,
	sha256Text,
} from "./native-corpus-extract.js";
import {
	MIRACL_KO_LOCK,
	parseQrelsTsv,
	parseTopicsTsv,
} from "./public-miracl-source.js";
import { summarizeRetrievalMetrics } from "./retrieval-metrics.js";

const MODEL = "multilingual-e5-large";
const MODEL_REVISION = OFFLINE_MODEL_REVISIONS[MODEL];
const TOP_K = 100;
const BATCH_SIZE = 8;
const FIXED_NOW = 1_720_000_000_000;

function requiredEnvironment(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required`);
	return value;
}

async function atomicWrite(path: string, contents: string | Uint8Array) {
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, contents);
	await rename(temporary, path);
}

function sha256Bytes(value: Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function factForDocument(document: {
	docid: string;
	title: string;
	text: string;
}): Fact {
	return {
		id: document.docid,
		content: `${document.title}\n${document.text}`,
		entities: [],
		topics: [],
		importance: 0.5,
		maxEmotion: 0.5,
		strength: 0.5,
		status: "active",
		createdAt: FIXED_NOW,
		updatedAt: FIXED_NOW,
		lastAccessed: FIXED_NOW,
		recallCount: 0,
		validFrom: FIXED_NOW,
		validTo: null,
		sourceEpisodes: [],
		encodingContext: {},
	};
}

async function main() {
	if (process.env.CUDA_VISIBLE_DEVICES !== "")
		throw new Error(
			"CUDA_VISIBLE_DEVICES must be the empty string for CPU-only evidence",
		);
	const sourceRoot =
		process.env.MIRACL_SOURCE_DIR ?? ".cache/benchmark-sources/miracl-ko-v1.0";
	const candidateListPath = requiredEnvironment(
		"MIRACL_CANDIDATE_DOCUMENT_IDS",
	);
	const outputPrefix = requiredEnvironment("MIRACL_NATIVE_EVALUATION_PREFIX");
	const candidateIdsText = await readFile(candidateListPath, "utf8");
	const candidateIds = candidateIdsText.trim().split(/\r?\n/);
	if (new Set(candidateIds).size !== 20_015)
		throw new Error("candidate list must contain exactly 20,015 unique IDs");
	const expectedPoolHash =
		"e758692d71d0ab640927f3d9aaad741b88952b22e25707130adfe8e6d903ef08";
	if (sha256Text(candidateIdsText) !== expectedPoolHash)
		throw new Error("candidate list hash does not match the preregistration");

	const topicsPath = join(sourceRoot, MIRACL_KO_LOCK.files[0].path);
	const qrelsPath = join(sourceRoot, MIRACL_KO_LOCK.files[1].path);
	const topicsText = await readFile(topicsPath, "utf8");
	const qrelsText = await readFile(qrelsPath, "utf8");
	const topics = parseTopicsTsv(topicsText);
	const relevantByQuery = parseQrelsTsv(qrelsText);
	if (topics.size !== 213 || relevantByQuery.size !== 213)
		throw new Error(
			"locked evaluation requires 213 topics and qrels query sets",
		);

	const shards = MIRACL_KO_LOCK.files
		.slice(2)
		.map(({ path }) => join(sourceRoot, path));
	const extractionStarted = performance.now();
	const documents = await extractNativeCorpusDocuments(
		shards,
		new Set(candidateIds),
	);
	const corpusJsonl = canonicalNativeCorpusJsonl(documents);
	await atomicWrite(`${outputPrefix}.corpus.jsonl`, corpusJsonl);
	const facts = documents.map(factForDocument);
	console.error(
		`extracted ${facts.length} documents in ${((performance.now() - extractionStarted) / 1000).toFixed(1)}s`,
	);

	const embedder = new OfflineEmbeddingProvider(MODEL, "cpu", MODEL_REVISION);
	const vectorPath = `${outputPrefix}.vectors.f32`;
	const expectedVectorBytes =
		facts.length * embedder.dims * Float32Array.BYTES_PER_ELEMENT;
	let vectorBytes: Uint8Array;
	let embeddingSeconds = 0;
	try {
		vectorBytes = new Uint8Array(await readFile(vectorPath));
		if (vectorBytes.byteLength !== expectedVectorBytes)
			throw new Error("cached vector byte length mismatch");
		console.error(`reused ${vectorBytes.byteLength} vector bytes`);
	} catch (error) {
		if (
			error instanceof Error &&
			!/ENOENT/.test(String((error as NodeJS.ErrnoException).code))
		) {
			throw error;
		}
		const vectors = new Float32Array(facts.length * embedder.dims);
		const embeddingStarted = performance.now();
		for (let offset = 0; offset < facts.length; offset += BATCH_SIZE) {
			const batch = facts.slice(offset, offset + BATCH_SIZE);
			const embedded = await embedder.embedBatch(
				batch.map(({ content }) => content),
			);
			if (
				embedded.length !== batch.length ||
				embedded.some(
					(vector) =>
						vector.length !== embedder.dims ||
						vector.some((value) => !Number.isFinite(value)),
				)
			)
				throw new Error(`invalid embedding batch at offset ${offset}`);
			for (const [index, vector] of embedded.entries())
				vectors.set(vector, (offset + index) * embedder.dims);
			if (offset % 400 === 0)
				console.error(
					`embedded ${Math.min(offset + BATCH_SIZE, facts.length)}/${facts.length}`,
				);
		}
		embeddingSeconds = (performance.now() - embeddingStarted) / 1000;
		vectorBytes = new Uint8Array(vectors.buffer);
		await atomicWrite(vectorPath, vectorBytes);
	}

	const vectorFloats = new Float32Array(
		vectorBytes.buffer,
		vectorBytes.byteOffset,
		vectorBytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
	);
	const factEmbeddings: Record<string, number[]> = {};
	for (const [index, fact] of facts.entries())
		factEmbeddings[fact.id] = Array.from(
			vectorFloats.subarray(index * embedder.dims, (index + 1) * embedder.dims),
		);
	const kg = new KnowledgeGraph(emptyKGState());
	process.env.NAIA_MMR = "off";
	process.env.NAIA_SEARCH_MODE = undefined;
	const rankings: Array<{
		queryId: string;
		ranking: string[];
		milliseconds: number;
	}> = [];
	const retrievalStarted = performance.now();
	for (const [index, [queryId, query]] of [...topics].entries()) {
		const queryStarted = performance.now();
		const ranking = await searchLocalSemanticMemory(
			{
				facts,
				factEmbeddings,
				embedder,
				disableKGSpreading: true,
				kg,
				reranker: null,
				embedWithCache: (text) => embedder.embed(text),
				factsInTimeRange: () => facts,
				factsValidAtTime: () => facts,
				getEpochs: () => [],
				markDirty: () => {},
				save: () => {},
			},
			query,
			TOP_K,
			true,
		).then((rows) => rows.map(({ id }) => id));
		if (ranking.length !== TOP_K || new Set(ranking).size !== TOP_K)
			throw new Error(`${queryId}: expected ${TOP_K} unique results`);
		rankings.push({
			queryId,
			ranking,
			milliseconds: performance.now() - queryStarted,
		});
		console.error(`searched ${index + 1}/${topics.size}`);
	}
	const retrievalSeconds = (performance.now() - retrievalStarted) / 1000;
	const comparisons = rankings.map(({ queryId, ranking }) => ({
		relevantIds: relevantByQuery.get(queryId) ?? [],
		ranking,
	}));
	const metrics = summarizeRetrievalMetrics(comparisons);
	const recallAt100 =
		comparisons.reduce((sum, { relevantIds, ranking }) => {
			const relevant = new Set(relevantIds);
			const hits = new Set(ranking.filter((id) => relevant.has(id))).size;
			return sum + hits / relevant.size;
		}, 0) / comparisons.length;
	const trec = `${rankings
		.flatMap(({ queryId, ranking }) =>
			ranking.map(
				(documentId, index) =>
					`${queryId} Q0 ${documentId} ${index + 1} ${TOP_K - index} naia-local-rrf`,
			),
		)
		.join("\n")}\n`;
	const result = {
		benchmark: "miracl-ko-native-label-conditioned-diagnostic-v1",
		claimBoundary: "not-full-corpus-not-leaderboard-not-global-comparison",
		inputs: {
			candidateDocumentIdsSha256: expectedPoolHash,
			corpusJsonlSha256: sha256Text(corpusJsonl),
			topicsSha256: sha256Text(topicsText),
			qrelsSha256: sha256Text(qrelsText),
			datasetRevision: MIRACL_KO_LOCK.datasetRevision,
			corpusRevision: MIRACL_KO_LOCK.corpusRevision,
		},
		configuration: {
			productFunction: "searchLocalSemanticMemory",
			searchMode: "rrf",
			topK: TOP_K,
			deepRecall: true,
			mmr: "off",
			kgSpreading: false,
			reranker: null,
			passageComposition: 'title + "\\n" + text',
			embedding: embedder.policyReceipt,
			device: "cpu",
			cudaVisibleDevices: process.env.CUDA_VISIBLE_DEVICES,
		},
		counts: {
			documents: facts.length,
			queries: topics.size,
			returnedPerQuery: TOP_K,
		},
		timing: { embeddingSeconds, retrievalSeconds },
		metrics: { ...metrics, recallAt100 },
		outputs: {
			vectorsSha256: sha256Bytes(vectorBytes),
			trecSha256: sha256Text(trec),
		},
		queries: rankings,
	};
	await atomicWrite(`${outputPrefix}.trec`, trec);
	await atomicWrite(
		`${outputPrefix}.result.json`,
		`${JSON.stringify(result, null, 2)}\n`,
	);
	console.log(JSON.stringify(result.metrics));
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
