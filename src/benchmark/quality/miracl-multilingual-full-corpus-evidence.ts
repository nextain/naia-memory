import {
	MIRACL_MULTILINGUAL_CONTRACT,
	type MiraclEvidenceLanguage,
	miraclExecutionNamespace,
} from "./miracl-multilingual-contract.js";
import { parseMiraclSourceLockReceipt } from "./miracl-multilingual-download.js";
import type { FullCorpusCheckpointChainEvidence } from "./native-full-corpus-checkpoint.js";
import {
	type FullCorpusResult,
	MIRACL_EMBEDDING_POLICY,
	MIRACL_PASSAGE_COMPOSITION,
	sha256Bytes,
} from "./native-full-corpus-evidence.js";
import { fullCorpusEmbeddingExecutionPolicy } from "./native-full-corpus-policy.js";
import {
	parseQrelsTsv,
	parseTopicsTsv,
	parseTrecRun,
	validateTrecRunCoverage,
} from "./public-miracl-source.js";

export interface MultilingualFullCorpusResult extends FullCorpusResult {
	inputs: FullCorpusResult["inputs"] & { language: string };
}

export const MULTILINGUAL_FULL_CORPUS_PREFLIGHT_CLAIM_BOUNDARY =
	"Identity and protocol preflight only; no score or public quality claim is established by this receipt.";

export function verifyMultilingualFullCorpusIdentity(input: {
	language: MiraclEvidenceLanguage;
	result: MultilingualFullCorpusResult;
	sourceReceipt: unknown;
	topicsText: string;
	qrelsText: string;
	trecRunText: string;
	checkpointChain: FullCorpusCheckpointChainEvidence;
}) {
	const { language, result } = input;
	if (!Object.hasOwn(MIRACL_MULTILINGUAL_CONTRACT, language))
		throw new Error(`unsupported MIRACL evidence language: ${language}`);
	const contract = MIRACL_MULTILINGUAL_CONTRACT[language];
	if (result.inputs.language !== language)
		throw new Error("result language mismatch");
	if (
		result.benchmark !== `miracl-${language}-full-corpus-naia-vector-exact-v1`
	)
		throw new Error("benchmark language identity mismatch");
	const sourceReceipt = parseMiraclSourceLockReceipt(
		language,
		input.sourceReceipt,
	);
	if (result.inputs.sourceLockSha256 !== sourceReceipt.sourceLockSha256)
		throw new Error("result source lock mismatch");
	const topics = parseTopicsTsv(input.topicsText);
	const qrels = parseQrelsTsv(input.qrelsText);
	if (
		result.inputs.topicsSha256 !== sha256Bytes(input.topicsText) ||
		result.inputs.qrelsSha256 !== sha256Bytes(input.qrelsText) ||
		result.inputs.topicsSha256 !== contract.topics.sha256 ||
		result.inputs.qrelsSha256 !== contract.qrels.sha256 ||
		result.trecSha256 !== sha256Bytes(input.trecRunText)
	)
		throw new Error("retrieval artifact hash mismatch");
	if (
		topics.size !== contract.topics.queryCount ||
		result.inputs.queryCount !== topics.size
	)
		throw new Error("topic cardinality mismatch");
	const topicIds = new Set(topics.keys());
	if (
		[...topicIds].some((id) => !qrels.has(id)) ||
		[...qrels.keys()].some((id) => !topicIds.has(id))
	)
		throw new Error("topics/qrels query set mismatch");
	if (
		!("expectedDocumentCount" in contract.corpus) ||
		!("expectedDocidsSha256" in contract.corpus)
	)
		throw new Error(`MIRACL-${language} corpus cardinality is not qualified`);
	const qualifiedCorpus = contract.corpus;
	if (
		result.inputs.documentCount !== qualifiedCorpus.expectedDocumentCount ||
		result.inputs.corpusDocidsSha256 !== qualifiedCorpus.expectedDocidsSha256
	)
		throw new Error("corpus identity mismatch");
	if (
		input.checkpointChain.documentCount !== result.inputs.documentCount ||
		input.checkpointChain.docidsSha256 !== result.inputs.corpusDocidsSha256 ||
		result.ingestion.lastChunkReceiptSha256 === null ||
		input.checkpointChain.lastChunkReceiptSha256 !==
			result.ingestion.lastChunkReceiptSha256
	)
		throw new Error("checkpoint chain mismatch");
	if (
		result.configuration.passageComposition !== MIRACL_PASSAGE_COMPOSITION ||
		JSON.stringify(result.configuration.embedding) !==
			JSON.stringify(MIRACL_EMBEDDING_POLICY)
	)
		throw new Error("embedding identity mismatch");
	const inferenceMode = result.configuration.embeddingInferenceMode;
	if (
		inferenceMode !== "per-item-v1" &&
		inferenceMode !== "padded-array-batch-v1"
	)
		throw new Error("embedding inference mode mismatch");
	const policy = fullCorpusEmbeddingExecutionPolicy(
		MIRACL_EMBEDDING_POLICY,
		MIRACL_PASSAGE_COMPOSITION,
		inferenceMode,
	);
	if (
		result.configuration.embeddingExecutionPolicySha256 !==
			policy.embeddingPolicySha256 ||
		result.configuration.collectionName !==
			miraclExecutionNamespace(
				language,
				sourceReceipt.sourceLockSha256,
				policy.embeddingPolicySha256,
			)
	)
		throw new Error("language-scoped execution namespace mismatch");
	if (
		result.configuration.vectorStore !== "Qdrant" ||
		result.configuration.distance !== "Cosine" ||
		result.configuration.exactSearch !== true ||
		result.configuration.topK !== 100 ||
		result.configuration.cpuOnly !== true
	)
		throw new Error("execution policy mismatch");
	const run = parseTrecRun(input.trecRunText);
	validateTrecRunCoverage(run, topicIds, result.configuration.topK);
	return {
		language,
		role: contract.role,
		documentCount: result.inputs.documentCount,
		queryCount: result.inputs.queryCount,
		sourceLockSha256: sourceReceipt.sourceLockSha256,
		embeddingExecutionPolicySha256: policy.embeddingPolicySha256,
		collectionName: result.configuration.collectionName,
		claimBoundary: MULTILINGUAL_FULL_CORPUS_PREFLIGHT_CLAIM_BOUNDARY,
	};
}
