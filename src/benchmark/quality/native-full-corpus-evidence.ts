import { createHash } from "node:crypto";
import type {
	OfflineBatchInferenceMode,
	OfflineEmbeddingPolicyReceipt,
} from "../../memory/embeddings.js";
import { OFFLINE_MODEL_REVISIONS } from "../../memory/embeddings.js";
import { fullCorpusEmbeddingExecutionPolicy } from "./native-full-corpus-policy.js";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
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
export const EXPECTED_MIRACL_TOPIC_IDS = new Set(
	"2,4,21,24,36,37,40,45,49,58,61,68,88,94,105,106,130,145,155,156,159,163,166,167,184,199,200,202,205,215,239,242,247,249,252,263,264,268,269,276,284,285,289,292,294,303,305,311,313,317,318,325,334,344,347,356,364,369,373,389,403,405,409,412,423,425,426,440,448,450,460,474,485,486,494,496,504,523,546,552,557,558,573,575,586,591,597,606,608,613,629,635,644,657,679,691,693,695,700,718,720,731,755,758,763,769,777,806,811,827,829,834,838,848,881,883,897,901,906,907,915,919,927,930,931,932,934,941,946,947,948,950,953,1003,1009,1010,1011,1012,1019,1021,1033,1044,1048,1052,1055,1058,1059,1065,1068,1075,1076,1078,1082,1094,1108,1129,1138,1139,1140,1154,1176,1183,1187,1192,1195,1202,1206,1213,1228,1240,1248,1249,1252,1259,1262,1266,1272,1273,1276,1301,1304,1306,1314,1330,1333,1354,1357,1368,1378,1391,1399,1400,1402,1406,1409,1436,1437,1440,1450,1467,1476,1478,1491,1492,1495,1497,1511,1518,1520,1523,1539,1551,1582".split(
		",",
	),
);
if (EXPECTED_MIRACL_TOPIC_IDS.size !== 213)
	throw new Error("pinned MIRACL topic IDs are stale");
export const EXPECTED_QDRANT_COMMIT =
	"48203e414e4e7f639a6d394fb6e4df695f808e51";
export const EXPECTED_QDRANT_VERSION = "1.15.5";
// trec_eval's aggregate stdout is fixed to four decimal places. Preserve the
// maximum representational delta in receipts, but gate on exact equality after
// formatting the in-process metric to that same precision.
export const METRIC_TOLERANCE = 5e-5;
export const TREC_EVAL_OUTPUT_DECIMALS = 4;
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

export function matchesTrecEvalOutputPrecision(
	inProcess: number,
	reproduced: number,
): boolean {
	return (
		Number.isFinite(inProcess) &&
		Number.isFinite(reproduced) &&
		Math.abs(inProcess - reproduced) <= METRIC_TOLERANCE &&
		Number(inProcess.toFixed(TREC_EVAL_OUTPUT_DECIMALS)) === reproduced
	);
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
		qdrantServiceReceiptSha256?: string | null;
	};
	metrics: { ndcgAt10: number; recallAt100: number };
	ingestion: {
		lastChunkReceiptSha256: string | null;
	};
	trecSha256: string;
}

interface FullCorpusLaunchReceipt {
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
}

interface FullCorpusRuntimeObservation {
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
}

export function resolveFullCorpusInferenceMode(
	result: FullCorpusResult,
	evaluationSourceSha256: string,
): OfflineBatchInferenceMode {
	const mode = result.configuration.embeddingInferenceMode;
	if (mode === "per-item-v1" || mode === "padded-array-batch-v1") return mode;
	// The frozen baseline source predates explicit inference-mode and execution-
	// policy fields. Its exact source hash, baseline collection namespace, and
	// checkpoint policy bind the only admissible legacy interpretation.
	if (
		mode === undefined &&
		result.configuration.embeddingExecutionPolicySha256 === undefined &&
		evaluationSourceSha256 === EXPECTED_EVALUATION_SOURCE_SHA256
	)
		return "per-item-v1";
	throw new Error("result embedding inference mode is missing or invalid");
}

export function createFullCorpusEvidenceReceipt(input: {
	resultText: string;
	resultSha256: string;
	trecSha256: string;
	trecRunText: string;
	topicsSha256: string;
	qrelsSha256: string;
	trecEvalStdout: string;
	trecEvalBinarySha256: string;
	trecEvalSourceCommit: string;
	trecEvalPath: string;
	evaluationStability: {
		trecBeforeSha256: string;
		trecAfterSha256: string;
		qrelsBeforeSha256: string;
		qrelsAfterSha256: string;
		binaryBeforeSha256: string;
		binaryAfterSha256: string;
		sourceCommitBefore: string;
		sourceCommitAfter: string;
	};
	topicsPath: string;
	qrelsPath: string;
	trecPath: string;
	checkpointChain: {
		directory: string;
		chunkCount: number;
		documentCount: number;
		docidsSha256: string;
		lastChunkReceiptSha256: string;
	};
	launchReceiptPath: string;
	launchReceiptText: string;
	runtimeObservationPath: string;
	runtimeObservationText: string;
	qdrant: {
		version: string;
		commit: string;
		pointsCount: number;
		status: string;
		vectorSize: number;
		distance: string;
		hnswM: number;
		indexingThreshold: number;
		membership: {
			documentCount: number;
			docidsSha256: string;
			firstPointId: number;
			lastPointId: number;
		};
	};
}) {
	if (sha256Bytes(input.resultText) !== input.resultSha256)
		throw new Error("result content hash mismatch");
	const result = JSON.parse(input.resultText) as FullCorpusResult;
	const launchReceipt = JSON.parse(
		input.launchReceiptText,
	) as FullCorpusLaunchReceipt;
	const launchReceiptSha256 = sha256Bytes(input.launchReceiptText);
	const runtime = JSON.parse(
		input.runtimeObservationText,
	) as FullCorpusRuntimeObservation;
	const runtimeObservationSha256 = sha256Bytes(input.runtimeObservationText);
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
	if (
		result.inputs.topicsSha256 !== input.topicsSha256 ||
		input.topicsSha256 !== EXPECTED_MIRACL_TOPICS_SHA256 ||
		!input.topicsPath.endsWith(MIRACL_KO_LOCK.files[0].path)
	)
		throw new Error("canonical topics hash mismatch");
	const run = parseTrecRun(input.trecRunText);
	if (run.size !== result.inputs.queryCount)
		throw new Error("TREC query cardinality mismatch");
	validateTrecRunCoverage(
		run,
		EXPECTED_MIRACL_TOPIC_IDS,
		result.configuration.topK,
	);
	if (result.inputs.qrelsSha256 !== input.qrelsSha256)
		throw new Error("qrels hash mismatch");
	if (
		input.qrelsSha256 !== EXPECTED_MIRACL_QRELS_SHA256 ||
		!input.qrelsPath.endsWith(MIRACL_KO_LOCK.files[1].path)
	)
		throw new Error("canonical qrels provenance mismatch");
	if (input.trecEvalBinarySha256 !== EXPECTED_TREC_EVAL_BINARY_SHA256)
		throw new Error("trec_eval binary hash mismatch");
	if (input.trecEvalSourceCommit !== TREC_EVAL_COMMIT)
		throw new Error("trec_eval source commit mismatch");
	const stability = input.evaluationStability;
	if (
		stability.trecBeforeSha256 !== input.trecSha256 ||
		stability.trecAfterSha256 !== input.trecSha256 ||
		stability.qrelsBeforeSha256 !== input.qrelsSha256 ||
		stability.qrelsAfterSha256 !== input.qrelsSha256 ||
		stability.binaryBeforeSha256 !== input.trecEvalBinarySha256 ||
		stability.binaryAfterSha256 !== input.trecEvalBinarySha256 ||
		stability.sourceCommitBefore !== input.trecEvalSourceCommit ||
		stability.sourceCommitAfter !== input.trecEvalSourceCommit
	)
		throw new Error("trec_eval execution stability mismatch");
	const inferenceMode = resolveFullCorpusInferenceMode(
		result,
		launchReceipt.evaluationSourceSha256,
	);
	if (
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
	const recordedExecutionPolicy =
		result.configuration.embeddingExecutionPolicySha256;
	const legacyBaseline =
		recordedExecutionPolicy === undefined &&
		result.configuration.embeddingInferenceMode === undefined &&
		launchReceipt.evaluationSourceSha256 === EXPECTED_EVALUATION_SOURCE_SHA256;
	if (
		(!legacyBaseline &&
			recordedExecutionPolicy !== expectedPolicy.embeddingPolicySha256) ||
		result.configuration.collectionName !== expectedCollection
	)
		throw new Error("benchmark embedding execution policy mismatch");
	const expectedEvaluationSourceSha256 =
		inferenceMode === "per-item-v1"
			? EXPECTED_EVALUATION_SOURCE_SHA256
			: EXPECTED_TRUE_BATCH_EVALUATION_SOURCE_SHA256;
	if (
		launchReceipt.cudaVisibleDevices !== "" ||
		launchReceipt.evaluationSourceSha256 !== expectedEvaluationSourceSha256 ||
		!launchReceipt.cmdline.some((argument) =>
			argument.endsWith("native-full-corpus-evaluation-cli.ts"),
		) ||
		launchReceipt.outputPath !== input.trecPath.replace(/\.trec$/, "") ||
		(inferenceMode === "padded-array-batch-v1" &&
			launchReceipt.embeddingInferenceMode !== inferenceMode)
	)
		throw new Error("benchmark launch evidence mismatch");
	const launchCapturedAt = Date.parse(launchReceipt.capturedAt);
	const observationStartedAt = Date.parse(runtime.observation.startedAt);
	const observationCompletedAt = Date.parse(runtime.observation.completedAt);
	if (
		runtime.schemaVersion !== 1 ||
		!runtime.monitor.source.endsWith(
			"/src/benchmark/quality/native-full-corpus-runtime-monitor-cli.ts",
		) ||
		runtime.monitor.sourceSha256 !== EXPECTED_RUNTIME_MONITOR_SOURCE_SHA256 ||
		runtime.launchReceipt.path !== input.launchReceiptPath ||
		runtime.launchReceipt.sha256 !== launchReceiptSha256 ||
		runtime.process.pid !== launchReceipt.pid ||
		runtime.process.bootId !== launchReceipt.bootId ||
		runtime.process.procStartTicks !== launchReceipt.procStartTicks ||
		runtime.process.cmdlineSha256 !==
			sha256Bytes(launchReceipt.cmdline.join("\0")) ||
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
		runtime.result.path !== launchReceipt.outputPath ||
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
		input.qdrant.indexingThreshold !== 0 ||
		input.qdrant.membership.documentCount !== result.inputs.documentCount ||
		input.qdrant.membership.docidsSha256 !== result.inputs.corpusDocidsSha256 ||
		input.qdrant.membership.firstPointId !== 1 ||
		input.qdrant.membership.lastPointId !== result.inputs.documentCount
	)
		throw new Error("Qdrant runtime evidence mismatch");
	const attestationBindingManifests = {
		dataset: {
			benchmark: MIRACL_FULL_BENCHMARK,
			sourceLockSha256: result.inputs.sourceLockSha256,
			topicsSha256: result.inputs.topicsSha256,
			qrelsSha256: result.inputs.qrelsSha256,
			documentCount: result.inputs.documentCount,
			queryCount: result.inputs.queryCount,
			corpusDocidsSha256: result.inputs.corpusDocidsSha256,
			passageComposition: MIRACL_PASSAGE_COMPOSITION,
		},
		protocol: {
			benchmark: MIRACL_FULL_BENCHMARK,
			exactSearch: true,
			topK: 100,
			metrics: ["ndcg_cut.10", "recall.100"],
			metricTolerance: METRIC_TOLERANCE,
			independentEvaluator: {
				name: "usnistgov/trec_eval",
				version: TREC_EVAL_VERSION,
				commit: TREC_EVAL_COMMIT,
				binarySha256: input.trecEvalBinarySha256,
			},
		},
		implementation: {
			evaluationSourceSha256: launchReceipt.evaluationSourceSha256,
			runtimeMonitorSourceSha256: runtime.monitor.sourceSha256,
			qdrantVersion: input.qdrant.version,
			qdrantCommit: input.qdrant.commit,
			embeddingModel: MIRACL_EMBEDDING_POLICY.model,
			embeddingModelRevision: MIRACL_EMBEDDING_POLICY.revision,
		},
		configuration: {
			...result.configuration,
			embeddingInferenceMode: inferenceMode,
			embeddingPolicySha256: expectedPolicy.embeddingPolicySha256,
			embeddingExecutionPolicySha256: expectedPolicy.embeddingPolicySha256,
			qdrant: input.qdrant,
		},
		executionEvidence: {
			resultSha256: input.resultSha256,
			trecSha256: input.trecSha256,
			launchReceiptSha256,
			runtimeObservationSha256,
			checkpointChain: input.checkpointChain,
			trecEvalStdoutSha256: sha256Bytes(input.trecEvalStdout),
			evaluationStability: input.evaluationStability,
		},
	};
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
		!matchesTrecEvalOutputPrecision(result.metrics.ndcgAt10, ndcgAt10) ||
		!matchesTrecEvalOutputPrecision(result.metrics.recallAt100, recallAt100)
	)
		throw new Error("independent metric reproduction mismatch");
	return {
		schemaVersion: 3,
		verdict: "LOCAL_PASS",
		assurance: "self-observed-local",
		publicClaimEligible: false,
		publicClaimRequirement:
			"independent signed execution attestation from a runner outside the benchmark operator trust boundary",
		benchmark: MIRACL_FULL_BENCHMARK,
		attestationBinding: {
			manifests: attestationBindingManifests,
			hashes: {
				datasetSha256: evidenceObjectSha256(
					attestationBindingManifests.dataset,
				),
				protocolSha256: evidenceObjectSha256(
					attestationBindingManifests.protocol,
				),
				implementationArtifactSha256: evidenceObjectSha256(
					attestationBindingManifests.implementation,
				),
				configurationSha256: evidenceObjectSha256(
					attestationBindingManifests.configuration,
				),
				executionEvidenceSha256: evidenceObjectSha256(
					attestationBindingManifests.executionEvidence,
				),
			},
		},
		artifacts: {
			result: {
				path: input.trecPath.replace(/\.trec$/, ""),
				sha256: input.resultSha256,
			},
			trec: { path: input.trecPath, sha256: input.trecSha256 },
			topics: { path: input.topicsPath, sha256: input.topicsSha256 },
			qrels: { path: input.qrelsPath, sha256: input.qrelsSha256 },
			launchReceipt: {
				path: input.launchReceiptPath,
				sha256: launchReceiptSha256,
			},
			runtimeObservation: {
				path: input.runtimeObservationPath,
				sha256: runtimeObservationSha256,
			},
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
			executionStability: input.evaluationStability,
		},
		metrics: {
			inProcess: result.metrics,
			reproducedByIndependentTool: { ndcgAt10, recallAt100 },
			deltas,
			tolerance: METRIC_TOLERANCE,
		},
		runtime: {
			cpuOnly: true,
			launchReceipt,
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
