import { createHash } from "node:crypto";
import type {
	OfflineBatchInferenceMode,
	OfflineEmbeddingPolicyReceipt,
} from "../../memory/embeddings.js";
import { fullCorpusEmbeddingExecutionPolicy } from "./native-full-corpus-policy.js";
import { MIRACL_KO_LOCK } from "./public-miracl-source.js";

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
export const EXPECTED_QDRANT_COMMIT =
	"48203e414e4e7f639a6d394fb6e4df695f808e51";
export const EXPECTED_QDRANT_VERSION = "1.15.5";
export const METRIC_TOLERANCE = 1e-6;

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
		qrelsSha256: string;
		documentCount: number;
		queryCount: number;
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
	trecSha256: string;
}

export function createFullCorpusEvidenceReceipt(input: {
	result: FullCorpusResult;
	resultSha256: string;
	trecSha256: string;
	qrelsSha256: string;
	trecEvalStdout: string;
	trecEvalBinarySha256: string;
	trecEvalSourceCommit: string;
	trecEvalPath: string;
	qrelsPath: string;
	trecPath: string;
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
		result.configuration.vectorStore !== "Qdrant" ||
		result.configuration.distance !== "Cosine" ||
		result.configuration.exactSearch !== true ||
		result.configuration.topK !== 100 ||
		result.configuration.cpuOnly !== true
	)
		throw new Error("benchmark execution policy mismatch");
	if (result.trecSha256 !== input.trecSha256)
		throw new Error("TREC hash mismatch");
	if (result.inputs.qrelsSha256 !== input.qrelsSha256)
		throw new Error("qrels hash mismatch");
	if (input.qrelsSha256 !== EXPECTED_MIRACL_QRELS_SHA256)
		throw new Error("canonical qrels hash mismatch");
	if (input.trecEvalBinarySha256 !== EXPECTED_TREC_EVAL_BINARY_SHA256)
		throw new Error("trec_eval binary hash mismatch");
	if (input.trecEvalSourceCommit !== TREC_EVAL_COMMIT)
		throw new Error("trec_eval source commit mismatch");
	const inferenceMode =
		result.configuration.embeddingInferenceMode ?? "per-item-v1";
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
	if (inferenceMode === "padded-array-batch-v1") {
		const embedding = result.configuration.embedding;
		const passageComposition = result.configuration.passageComposition;
		if (!embedding || !passageComposition)
			throw new Error("true-batch embedding policy is missing");
		const expectedPolicy = fullCorpusEmbeddingExecutionPolicy(
			embedding,
			passageComposition,
			inferenceMode,
		).embeddingPolicySha256;
		const expectedCollection = `naia_miracl_ko_${result.inputs.sourceLockSha256.slice(0, 8)}_${expectedPolicy.slice(0, 8)}`;
		if (
			result.configuration.embeddingExecutionPolicySha256 !== expectedPolicy ||
			result.configuration.collectionName !== expectedCollection
		)
			throw new Error("true-batch embedding execution policy mismatch");
	}
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
