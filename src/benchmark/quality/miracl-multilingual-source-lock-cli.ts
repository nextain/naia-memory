#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
	MIRACL_CORPUS_REVISION,
	MIRACL_DATASET_REVISION,
	MIRACL_MULTILINGUAL_CONTRACT,
	type MiraclEvidenceLanguage,
	collectHuggingFaceTreePages,
	parseHuggingFaceCorpusTree,
	resolveMiraclLanguageSelection,
} from "./miracl-multilingual-contract.js";
import { parseQrelsTsv, parseTopicsTsv } from "./public-miracl-source.js";

function sha256(value: Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

async function fetchBytes(url: string): Promise<Uint8Array> {
	const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	return new Uint8Array(await response.arrayBuffer());
}

async function qualifyLanguage(language: MiraclEvidenceLanguage) {
	const contract = MIRACL_MULTILINGUAL_CONTRACT[language];
	const datasetBase = `https://huggingface.co/datasets/miracl/miracl/resolve/${MIRACL_DATASET_REVISION}`;
	const corpusTreeUrl = `https://huggingface.co/api/datasets/miracl/miracl-corpus/tree/${MIRACL_CORPUS_REVISION}/${contract.corpus.directory}?recursive=true&expand=true`;
	const [topics, qrels, tree] = await Promise.all([
		fetchBytes(`${datasetBase}/${contract.topics.path}`),
		fetchBytes(`${datasetBase}/${contract.qrels.path}`),
		collectHuggingFaceTreePages(corpusTreeUrl),
	]);
	const corpus = parseHuggingFaceCorpusTree(language, tree);
	if (
		topics.byteLength !== contract.topics.size ||
		sha256(topics) !== contract.topics.sha256
	)
		throw new Error(`MIRACL-${language} topics identity mismatch`);
	if (
		qrels.byteLength !== contract.qrels.size ||
		sha256(qrels) !== contract.qrels.sha256
	)
		throw new Error(`MIRACL-${language} qrels identity mismatch`);
	const parsedTopics = parseTopicsTsv(
		new TextDecoder("utf-8", { fatal: true }).decode(topics),
	);
	const parsedQrels = parseQrelsTsv(
		new TextDecoder("utf-8", { fatal: true }).decode(qrels),
	);
	if (parsedTopics.size !== contract.topics.queryCount)
		throw new Error(`MIRACL-${language} topic cardinality mismatch`);
	const topicIds = new Set(parsedTopics.keys());
	const missingQrels = [...topicIds].filter((id) => !parsedQrels.has(id));
	const unknownQrels = [...parsedQrels.keys()].filter(
		(id) => !topicIds.has(id),
	);
	if (missingQrels.length > 0 || unknownQrels.length > 0)
		throw new Error(`MIRACL-${language} topics/qrels query set mismatch`);
	return {
		language,
		role: contract.role,
		datasetRevision: MIRACL_DATASET_REVISION,
		corpusRevision: MIRACL_CORPUS_REVISION,
		topics: { ...contract.topics, observedQueries: parsedTopics.size },
		qrels: { ...contract.qrels, observedJudgedQueries: parsedQrels.size },
		corpus: {
			...contract.corpus,
			manifestCompressedBytes: corpus.reduce(
				(sum, entry) => sum + entry.size,
				0,
			),
			provenance: "hugging-face-provider-tree-metadata",
			files: corpus,
		},
	};
}

const { languages, omittedPreregistered, partial } =
	resolveMiraclLanguageSelection(process.argv.slice(2));
const receipt = {
	schemaVersion: 1,
	claimBoundary:
		"Source qualification only; this receipt contains no retrieval score or multilingual quality claim.",
	requestedLanguages: languages,
	omittedPreregistered,
	partial,
	languages: await Promise.all(languages.map(qualifyLanguage)),
};
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
