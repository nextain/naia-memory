import { createHash } from "node:crypto";
import type {
	OfflineBatchInferenceMode,
	OfflineEmbeddingPolicyReceipt,
} from "../../memory/embeddings.js";
import { OFFLINE_MODEL_REVISIONS } from "../../memory/embeddings.js";
import { fullCorpusEmbeddingExecutionPolicy } from "./native-full-corpus-policy.js";
import {
	MIRACL_KO_LOCK,
	parseTrecRun,
	validateTrecRunCoverage,
} from "./public-miracl-source.js";

export const MIRACL_FULL_BENCHMARK =
	"miracl-ko-full-corpus-naia-vector-exact-v1";
export const TREC_EVAL_COMMIT = "ba38899cbd4de0fb699b47f39b64ef1c107e4a5c";
export const TREC_EVAL_VERSION = "10.0-rc3";
export const EXPECTED_TREC_EVAL_BINARY_SHA256 =
	"e4b251b339db6ec556dc18e6b14d45fbdcfdb5166f7fb9dce6bb2e4ca6084987";
export const EXPECTED_EVALUATION_SOURCE_SHA256 =
	"d2bb8406d342aba307d254a8aef57b32353246ce06527a3bd4d13a4f9d2ff15b";
export const EXPECTED_TRUE_BATCH_EVALUATION_SOURCE_SHA256 =
	"4f6191926c7e645d95b2023bbd17a0212ed4d80b5cfb48c37cf3b2807f59a7b5";
export const EXPECTED_RUNTIME_MONITOR_SOURCE_SHA256 =
	"65a79853e511cd46a4ce83779b36c34151f21c4fb071312c19a0a2558e7d93f0";
export const EXPECTED_MIRACL_SOURCE_LOCK_SHA256 =
	"742952715d6e31eaf9718f04c2bad0509c9d7c754210aa81d793a14430fbb69c";
export const EXPECTED_MIRACL_QRELS_SHA256 = MIRACL_KO_LOCK.files[1].sha256;
export const EXPECTED_MIRACL_TOPICS_SHA256 = MIRACL_KO_LOCK.files[0].sha256;
export const EXPECTED_QDRANT_COMMIT =
	"48203e414e4e7f639a6d394fb6e4df695f808e51";
export const EXPECTED_QDRANT_VERSION = "1.15.5";
export const METRIC_TOLERANCE = 1e-6;
export const MIRACL_PASSAGE_COMPOSITION = 'title + "\\n" + text';
export const MIRACL_EMBEDDING_POLICY: OfflineEmbeddingPolicyReceipt = {
	model: "Xenova/multilingual-e5-large",
	revision: OFFLINE_MODEL_REVISIONS["multilingual-e5-large"],
	dtype: "q8",
	dimensions: 1024,
	queryPrefix: "query: ",
	passagePrefix: "passage: ",
	pooling: "mean",
	normalize: true,
	tokenizerMaxLength: 512,
	truncation: true,
	titleConcatenation: "provider-receives-precomposed-text",
};

export function sha256Bytes(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

export function parseTrecEvalAll(stdout: string): Map<string, number> {
	const metrics = new Map<string, number>();
	for (const [index, line] of stdout.trim().split(/\r?\n/).entries()) {
		const columns = line.trim().split(/\s+/);
		if (columns.length !== 3 || columns[1] !== "all")
			throw new Error(`invalid trec_eval row ${index + 1}`);
		const value = Number(columns[2]);
		if (!columns[0] || !Number.isFinite(value))
			throw new Error(`invalid trec_eval value at row ${index + 1}`);
		if (metrics.has(columns[0]))
			throw new Error(`duplicate trec_eval metric: ${columns[0]}`);
		metrics.set(columns[0], value);
	}
	return metrics;
}

export interface FullCorpusResult {
	benchmark: string;
	inputs: {
		sourceLockSha256: string;
		topicsSha256: string;
		qrelsSha256: string;
		documentCount: number;
		queryCount: number;
		corpusDocidsSha256: string;
	};
	configuration: {
		passageComposition?: string;
		embedding?: OfflineEmbeddingPolicyReceipt;
		embeddingInferenceMode?: OfflineBatchInferenceMode;
		embeddingExecutionPolicySha256?: string;
		vectorStore: string;
		distance: string;
		exactSearch: boolean;
		topK: number;
		cpuOnly: boolean;
		collectionName: string;
	};
	metrics: { ndcgAt10: number; recallAt100: number };
	ingestion: {
		lastChunkReceiptSha256: string | null;
	};
	trecSha256: string;
}

export function createFullCorpusEvidenceReceipt(input: {
	result: FullCorpusResult;
	resultSha256: string;
	trecSha256: string;
	trecRunText: string;
	qrelsSha256: string;
	trecEvalStdout: string;
	trecEvalBinarySha256: string;
	trecEvalSourceCommit: string;
	trecEvalPath: string;
	qrelsPath: string;
	trecPath: string;
	checkpointChain: {
		directory: string;
		chunkCount: number;
		documentCount: number;
		docidsSha256: string;
		lastChunkReceiptSha256: string;
	};
	launchReceipt: {
		pid: number;
		capturedAt: string;
		procStartTicks: string;
		bootId: string;
		cmdline: string[];
		cudaVisibleDevices: string;
		qdrantUrl: string;
		outputPath: string;
		evaluationSourceSha256: string;
		embeddingInferenceMode?: OfflineBatchInferenceMode;
	};
	launchReceiptSha256: string;
	runtimeObservation: {
		schemaVersion: number;
		monitor: { source: string; sourceSha256: string };
		launchReceipt: { path: string; sha256: string };
		process: {
			pid: number;
			bootId: string;
			procStartTicks: string;
			cmdlineSha256: string;
		};
		observation: {
			startedAt: string;
			completedAt: string;
			pollMilliseconds: number;
			samples: number;
			peakRssBytes: number;
		};
		result: { path: string; sha256: string };
	};
	qdrant: {
		version: string;
		commit: string;
		pointsCount: number;
		status: string;
		vectorSize: number;
		distance: string;
		hnswM: number;
		indexingThreshold: number;
	};
}) {
	const { result } = input;
	if (result.benchmark !== MIRACL_FULL_BENCHMARK)
		throw new Error("benchmark identity mismatch");
	if (
		result.inputs.documentCount !== 1_486_752 ||
		result.inputs.queryCount !== 213
	)
		throw new Error("benchmark cardinality mismatch");
	if (result.inputs.sourceLockSha256 !== EXPECTED_MIRACL_SOURCE_LOCK_SHA256)
		throw new Error("benchmark source lock mismatch");
	if (
		sha256Bytes(`${JSON.stringify(MIRACL_KO_LOCK, null, 2)}\n`) !==
		EXPECTED_MIRACL_SOURCE_LOCK_SHA256
	)
		throw new Error("pinned benchmark source lock is stale");
	if (
		input.checkpointChain.chunkCount !== 2_904 ||
		input.checkpointChain.documentCount !== result.inputs.documentCount ||
		input.checkpointChain.docidsSha256 !== result.inputs.corpusDocidsSha256 ||
		result.ingestion.lastChunkReceiptSha256 === null ||
		input.checkpointChain.lastChunkReceiptSha256 !==
			result.ingestion.lastChunkReceiptSha256
	)
		throw new Error("benchmark checkpoint chain mismatch");
	if (
		result.configuration.vectorStore !== "Qdrant" ||
		result.configuration.distance !== "Cosine" ||
		result.configuration.exactSearch !== true ||
		result.configuration.topK !== 100 ||
		result.configuration.cpuOnly !== true
	)
		throw new Error("benchmark execution policy mismatch");
	if (result.trecSha256 !== input.trecSha256)
		throw new Error("TREC hash mismatch");
	if (sha256Bytes(input.trecRunText) !== input.trecSha256)
		throw new Error("TREC content hash mismatch");
	if (result.inputs.topicsSha256 !== EXPECTED_MIRACL_TOPICS_SHA256)
		throw new Error("canonical topics hash mismatch");
	const run = parseTrecRun(input.trecRunText);
	if (run.size !== result.inputs.queryCount)
		throw new Error("TREC query cardinality mismatch");
	validateTrecRunCoverage(run, new Set(run.keys()), result.configuration.topK);
	if (result.inputs.qrelsSha256 !== input.qrelsSha256)
		throw new Error("qrels hash mismatch");
	if (input.qrelsSha256 !== EXPECTED_MIRACL_QRELS_SHA256)
		throw new Error("canonical qrels hash mismatch");
	if (input.trecEvalBinarySha256 !== EXPECTED_TREC_EVAL_BINARY_SHA256)
		throw new Error("trec_eval binary hash mismatch");
	if (input.trecEvalSourceCommit !== TREC_EVAL_COMMIT)
		throw new Error("trec_eval source commit mismatch");
	const inferenceMode = result.configuration.embeddingInferenceMode;
	if (
		(inferenceMode !== "per-item-v1" &&
			inferenceMode !== "padded-array-batch-v1") ||
		result.configuration.passageComposition !== MIRACL_PASSAGE_COMPOSITION ||
		JSON.stringify(result.configuration.embedding) !==
			JSON.stringify(MIRACL_EMBEDDING_POLICY)
	)
		throw new Error("benchmark embedding identity mismatch");
	const expectedPolicy = fullCorpusEmbeddingExecutionPolicy(
		MIRACL_EMBEDDING_POLICY,
		MIRACL_PASSAGE_COMPOSITION,
		inferenceMode,
	);
	const expectedCollection = `naia_miracl_ko_${result.inputs.sourceLockSha256.slice(0, 8)}_${expectedPolicy.embeddingPolicySha256.slice(0, 8)}`;
	if (
		result.configuration.embeddingExecutionPolicySha256 !==
			expectedPolicy.embeddingPolicySha256 ||
		result.configuration.collectionName !== expectedCollection
	)
		throw new Error("benchmark embedding execution policy mismatch");
	const expectedEvaluationSourceSha256 =
		inferenceMode === "per-item-v1"
			? EXPECTED_EVALUATION_SOURCE_SHA256
			: EXPECTED_TRUE_BATCH_EVALUATION_SOURCE_SHA256;
	if (
		input.launchReceipt.cudaVisibleDevices !== "" ||
		input.launchReceipt.evaluationSourceSha256 !==
			expectedEvaluationSourceSha256 ||
		!input.launchReceipt.cmdline.some((argument) =>
			argument.endsWith("native-full-corpus-evaluation-cli.ts"),
		) ||
		input.launchReceipt.outputPath !== input.trecPath.replace(/\.trec$/, "") ||
		(inferenceMode === "padded-array-batch-v1" &&
			input.launchReceipt.embeddingInferenceMode !== inferenceMode)
	)
		throw new Error("benchmark launch evidence mismatch");
	const runtime = input.runtimeObservation;
	const launchCapturedAt = Date.parse(input.launchReceipt.capturedAt);
	const observationStartedAt = Date.parse(runtime.observation.startedAt);
	const observationCompletedAt = Date.parse(runtime.observation.completedAt);
	if (
		runtime.schemaVersion !== 1 ||
		!runtime.monitor.source.endsWith(
			"/src/benchmark/quality/native-full-corpus-runtime-monitor-cli.ts",
		) ||
		runtime.monitor.sourceSha256 !== EXPECTED_RUNTIME_MONITOR_SOURCE_SHA256 ||
		runtime.launchReceipt.sha256 !== input.launchReceiptSha256 ||
		runtime.process.pid !== input.launchReceipt.pid ||
		runtime.process.bootId !== input.launchReceipt.bootId ||
		runtime.process.procStartTicks !== input.launchReceipt.procStartTicks ||
		runtime.process.cmdlineSha256 !==
			sha256Bytes(input.launchReceipt.cmdline.join("\0")) ||
		!Number.isFinite(launchCapturedAt) ||
		!Number.isFinite(observationStartedAt) ||
		!Number.isFinite(observationCompletedAt) ||
		observationStartedAt < launchCapturedAt ||
		observationCompletedAt < observationStartedAt ||
		runtime.observation.pollMilliseconds !== 5_000 ||
		!Number.isSafeInteger(runtime.observation.samples) ||
		runtime.observation.samples < 1 ||
		!Number.isSafeInteger(runtime.observation.peakRssBytes) ||
		runtime.observation.peakRssBytes <= 0 ||
		runtime.result.path !== input.launchReceipt.outputPath ||
		runtime.result.sha256 !== input.resultSha256
	)
		throw new Error("benchmark runtime observation mismatch");
	const attachmentDelayMilliseconds = observationStartedAt - launchCapturedAt;
	if (
		input.qdrant.version !== EXPECTED_QDRANT_VERSION ||
		input.qdrant.commit !== EXPECTED_QDRANT_COMMIT ||
		input.qdrant.pointsCount !== result.inputs.documentCount ||
		input.qdrant.status !== "green" ||
		input.qdrant.vectorSize !== 1024 ||
		input.qdrant.distance !== "Cosine" ||
		input.qdrant.hnswM !== 0 ||
		input.qdrant.indexingThreshold !== 0
	)
		throw new Error("Qdrant runtime evidence mismatch");
	const independentlyMeasured = parseTrecEvalAll(input.trecEvalStdout);
	const ndcgAt10 = independentlyMeasured.get("ndcg_cut_10");
	const recallAt100 = independentlyMeasured.get("recall_100");
	if (ndcgAt10 === undefined || recallAt100 === undefined)
		throw new Error("required trec_eval metrics are missing");
	const deltas = {
		ndcgAt10: Math.abs(result.metrics.ndcgAt10 - ndcgAt10),
		recallAt100: Math.abs(result.metrics.recallAt100 - recallAt100),
	};
	if (
		deltas.ndcgAt10 > METRIC_TOLERANCE ||
		deltas.recallAt100 > METRIC_TOLERANCE
	)
		throw new Error("independent metric reproduction mismatch");
	return {
		schemaVersion: 2,
		verdict: "LOCAL_PASS",
		assurance: "self-observed-local",
		publicClaimEligible: false,
		publicClaimRequirement:
			"independent signed execution attestation from a runner outside the benchmark operator trust boundary",
		benchmark: MIRACL_FULL_BENCHMARK,
		artifacts: {
			result: {
				path: input.trecPath.replace(/\.trec$/, ""),
				sha256: input.resultSha256,
			},
			trec: { path: input.trecPath, sha256: input.trecSha256 },
			qrels: { path: input.qrelsPath, sha256: input.qrelsSha256 },
			checkpointChain: input.checkpointChain,
		},
		independentEvaluatorTool: {
			name: "usnistgov/trec_eval",
			version: TREC_EVAL_VERSION,
			commit: TREC_EVAL_COMMIT,
			binaryPath: input.trecEvalPath,
			binarySha256: input.trecEvalBinarySha256,
			sourceCommit: input.trecEvalSourceCommit,
			argv: [
				"-m",
				"ndcg_cut.10",
				"-m",
				"recall.100",
				input.qrelsPath,
				input.trecPath,
			],
			stdout: input.trecEvalStdout,
			stdoutSha256: sha256Bytes(input.trecEvalStdout),
		},
		metrics: {
			inProcess: result.metrics,
			reproducedByIndependentTool: { ndcgAt10, recallAt100 },
			deltas,
			tolerance: METRIC_TOLERANCE,
		},
		runtime: {
			cpuOnly: true,
			launchReceipt: input.launchReceipt,
			observation: runtime,
			attachmentDelayMilliseconds,
			observationBoundary:
				"monitor-attached-after-launch; Linux VmHWM is cumulative for the observed process lifetime",
			qdrant: input.qdrant,
			collectionName: result.configuration.collectionName,
			latencySemantics: "query-embedding-plus-exact-qdrant-search",
		},
	};
}
