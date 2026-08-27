#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
	closeSync,
	createReadStream,
	existsSync,
	fsyncSync,
	linkSync,
	mkdirSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { OfflineEmbeddingProvider } from "../../memory/embeddings.js";
import {
	MIRACL_EN_PRIMARY_EXECUTION,
	MIRACL_EN_PRIMARY_EXPECTED_POLICY_SHA256,
	miraclEnPrimaryExecutionPolicy,
} from "./miracl-en-primary-execution-policy.js";
import {
	createMiraclEnPrimaryPreflightEvidence,
	englishPreflightRetrievalInputSha256,
	englishPreflightVectorArtifactSha256,
	publishEnglishPreflightVectorArtifact,
	rankEnglishPreflightCorpus,
} from "./miracl-en-primary-preflight.js";
import {
	canonicalMiraclEnPrimarySampleReceipt,
	validateMiraclEnPrimarySampleReceipt,
} from "./miracl-en-primary-sample-receipt.js";
import { MIRACL_MULTILINGUAL_CONTRACT } from "./miracl-multilingual-contract.js";
import { miraclSourceRoot } from "./miracl-multilingual-download.js";
import { MIRACL_EMBEDDING_POLICY } from "./native-full-corpus-evidence.js";
import {
	buildNativeRuntimeSourceManifest,
	verifyNativeRuntimeSourceManifest,
} from "./native-runtime-source-manifest.js";
import { parseQrelsTsv, parseTopicsTsv } from "./public-miracl-source.js";
import type { RankedQuery } from "./ranking-ab-analysis.js";

const root = resolve(import.meta.dirname, "../../..");
const samplePath = resolve(
	process.argv[2] ??
		"reports/quality/miracl-en-primary-preflight/source-derived-sample.json",
);
const output = resolve(
	process.argv[3] ??
		"reports/quality/miracl-en-primary-preflight/evidence.json",
);
const vectorOutput = `${output}.vectors.f32`;
const sampleBytes = readFileSync(samplePath);
const sample = JSON.parse(sampleBytes.toString("utf8")) as unknown;
validateMiraclEnPrimarySampleReceipt(sample);
if (
	createHash("sha256").update(sampleBytes).digest("hex") !==
	createHash("sha256")
		.update(canonicalMiraclEnPrimarySampleReceipt(sample))
		.digest("hex")
)
	throw new Error("English sample receipt is not canonical");
verifyNativeRuntimeSourceManifest(root, sample.producerSourceManifest);

const contract = MIRACL_MULTILINGUAL_CONTRACT.en;
const sourceRoot = resolve(
	process.env.MIRACL_SOURCE_DIR ?? miraclSourceRoot("en"),
);
const topicsBytes = readFileSync(join(sourceRoot, contract.topics.path));
const qrelsBytes = readFileSync(join(sourceRoot, contract.qrels.path));
const sha256 = (value: Uint8Array | string) =>
	createHash("sha256").update(value).digest("hex");
if (
	sha256(topicsBytes) !== contract.topics.sha256 ||
	topicsBytes.byteLength !== contract.topics.size ||
	sha256(qrelsBytes) !== contract.qrels.sha256 ||
	qrelsBytes.byteLength !== contract.qrels.size
)
	throw new Error("English topics/qrels bytes do not match the source lock");

const topics = parseTopicsTsv(topicsBytes.toString("utf8"));
const qrels = parseQrelsTsv(qrelsBytes.toString("utf8"));
const queryRows = sample.queries.ids.map((queryId) => {
	const text = topics.get(queryId);
	const relevant = qrels.get(queryId);
	if (!text || !relevant?.length)
		throw new Error(`English preflight query input is missing: ${queryId}`);
	return { queryId, text, relevant: new Set(relevant) };
});

const policy = miraclEnPrimaryExecutionPolicy(MIRACL_EMBEDDING_POLICY);
const model = "multilingual-e5-large" as const;
const perItemEmbedder = new OfflineEmbeddingProvider(
	model,
	"cpu",
	MIRACL_EMBEDDING_POLICY.revision,
	"per-item-v1",
);
const batchEmbedder = new OfflineEmbeddingProvider(
	model,
	"cpu",
	MIRACL_EMBEDDING_POLICY.revision,
	"padded-array-batch-v1",
);
if (
	perItemEmbedder.dims !== MIRACL_EMBEDDING_POLICY.dimensions ||
	batchEmbedder.dims !== MIRACL_EMBEDDING_POLICY.dimensions ||
	JSON.stringify(perItemEmbedder.policyReceipt) !==
		JSON.stringify(MIRACL_EMBEDDING_POLICY) ||
	JSON.stringify(batchEmbedder.policyReceipt) !==
		JSON.stringify(MIRACL_EMBEDDING_POLICY) ||
	policy.embeddingExecutionPolicySha256 !==
		MIRACL_EN_PRIMARY_EXPECTED_POLICY_SHA256
)
	throw new Error("English preflight embedding policy drifted");

async function embedPassages(
	embedder: OfflineEmbeddingProvider,
	texts: readonly string[],
): Promise<{ vectors: Float32Array; documentsPerSecond: number }> {
	const vectors = new Float32Array(texts.length * embedder.dims);
	const started = performance.now();
	for (
		let offset = 0;
		offset < texts.length;
		offset += MIRACL_EN_PRIMARY_EXECUTION.embeddingBatchSize
	) {
		const rows = await embedder.embedBatch(
			texts.slice(
				offset,
				offset + MIRACL_EN_PRIMARY_EXECUTION.embeddingBatchSize,
			),
		);
		for (const [row, vector] of rows.entries()) {
			if (
				vector.length !== embedder.dims ||
				vector.some((value) => !Number.isFinite(value))
			)
				throw new Error(
					"English preflight embedder returned an invalid vector",
				);
			vectors.set(vector, (offset + row) * embedder.dims);
		}
	}
	const seconds = (performance.now() - started) / 1_000;
	if (!(seconds > 0))
		throw new Error("English preflight timer did not advance");
	return { vectors, documentsPerSecond: texts.length / seconds };
}

function permutation(): number[] {
	return sample.sample.passages
		.map((passage, index) => ({
			index,
			rank: sha256(
				`${sample.sample.seed}\0shuffle\0${passage.ordinal}\0${passage.docid}`,
			),
		}))
		.sort((left, right) =>
			left.rank < right.rank
				? -1
				: left.rank > right.rank
					? 1
					: left.index - right.index,
		)
		.map(({ index }) => index);
}

const sampleTexts = sample.sample.passages.map(({ content }) => content);
const perItem = await embedPassages(perItemEmbedder, sampleTexts);
const batchOrdered = await embedPassages(batchEmbedder, sampleTexts);
const batchOrderedRepeat = await embedPassages(batchEmbedder, sampleTexts);
const shuffled = permutation();
const shuffledObservation = await embedPassages(
	batchEmbedder,
	shuffled.map((index) => sampleTexts[index] as string),
);
const batchShuffledRestored = new Float32Array(
	shuffledObservation.vectors.length,
);
for (const [shuffledRow, originalRow] of shuffled.entries())
	batchShuffledRestored.set(
		shuffledObservation.vectors.subarray(
			shuffledRow * batchEmbedder.dims,
			(shuffledRow + 1) * batchEmbedder.dims,
		),
		originalRow * batchEmbedder.dims,
	);
const vectors = {
	dimensions: MIRACL_EMBEDDING_POLICY.dimensions,
	perItem: perItem.vectors,
	batchOrdered: batchOrdered.vectors,
	batchOrderedRepeat: batchOrderedRepeat.vectors,
	batchShuffledRestored,
};

async function retrievalVectors(
	embedder: OfflineEmbeddingProvider,
	sampleVectors: Float32Array,
): Promise<Float32Array> {
	const sampleIndex = new Map(
		sample.sample.passages.map(({ docid }, index) => [docid, index]),
	);
	const missing = sample.retrievalCorpus.passages.filter(
		({ docid }) => !sampleIndex.has(docid),
	);
	const missingVectors = await embedPassages(
		embedder,
		missing.map(({ content }) => content),
	);
	const missingIndex = new Map(
		missing.map(({ docid }, index) => [docid, index]),
	);
	const result = new Float32Array(
		sample.retrievalCorpus.passages.length * embedder.dims,
	);
	for (const [row, passage] of sample.retrievalCorpus.passages.entries()) {
		const sourceRow = sampleIndex.get(passage.docid);
		const extraRow = missingIndex.get(passage.docid);
		const source =
			sourceRow === undefined ? missingVectors.vectors : sampleVectors;
		const index = sourceRow ?? extraRow;
		if (index === undefined)
			throw new Error("English retrieval vector identity is missing");
		result.set(
			source.subarray(index * embedder.dims, (index + 1) * embedder.dims),
			row * embedder.dims,
		);
	}
	return result;
}

const perItemCorpus = await retrievalVectors(perItemEmbedder, perItem.vectors);
const batchCorpus = await retrievalVectors(batchEmbedder, batchOrdered.vectors);
const queryVectors = await Promise.all(
	queryRows.map(({ text }) => perItemEmbedder.embed(text)),
);

function rankings(corpusVectors: Float32Array): RankedQuery[] {
	const dimensions = MIRACL_EMBEDDING_POLICY.dimensions;
	return queryRows.map(({ queryId }, queryIndex) => {
		const query = queryVectors[queryIndex];
		if (!query) throw new Error("English query vector is missing");
		return rankEnglishPreflightCorpus({
			queryId,
			query,
			corpusVectors,
			passages: sample.retrievalCorpus.passages,
			dimensions,
		});
	});
}

const retrieval = {
	perItemRankings: rankings(perItemCorpus),
	batchRankings: rankings(batchCorpus),
	relevantByQuery: new Map(
		queryRows.map(({ queryId, relevant }) => [queryId, relevant]),
	),
	rankingArtifactSha256: "",
	corpusPassagesSha256: sample.retrievalCorpus.passagesSha256,
};
retrieval.rankingArtifactSha256 =
	englishPreflightRetrievalInputSha256(retrieval);
const vectorArtifactInput = {
	passages: sample.sample.passages,
	vectors,
};
const vectorArtifactSha256 =
	englishPreflightVectorArtifactSha256(vectorArtifactInput);
const evidence = createMiraclEnPrimaryPreflightEvidence({
	passages: sample.sample.passages,
	vectors,
	producerSourceManifest: buildNativeRuntimeSourceManifest({
		root,
		entryPoint: "src/benchmark/quality/miracl-en-primary-preflight-cli.ts",
		additionalInputs: ["pnpm-lock.yaml"],
	}),
	vectorArtifactSha256,
	perItemDocumentsPerSecond: perItem.documentsPerSecond,
	batchDocumentsPerSecond: batchOrdered.documentsPerSecond,
	retrieval,
});
async function fileSha256(path: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest("hex");
}

if (existsSync(output))
	throw new Error("English preflight evidence already exists");
if (!existsSync(vectorOutput)) {
	try {
		publishEnglishPreflightVectorArtifact(vectorOutput, vectorArtifactInput);
	} catch (error) {
		if (!existsSync(vectorOutput)) throw error;
	}
}
if ((await fileSha256(vectorOutput)) !== vectorArtifactSha256)
	throw new Error("existing English vector artifact digest mismatch");
mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
const temporary = `${output}.${process.pid}.tmp`;
try {
	writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
	const temporaryDescriptor = openSync(temporary, "r");
	try {
		fsyncSync(temporaryDescriptor);
	} finally {
		closeSync(temporaryDescriptor);
	}
	linkSync(temporary, output);
	const directoryDescriptor = openSync(dirname(output), "r");
	try {
		fsyncSync(directoryDescriptor);
	} finally {
		closeSync(directoryDescriptor);
	}
} finally {
	rmSync(temporary, { force: true });
}
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
