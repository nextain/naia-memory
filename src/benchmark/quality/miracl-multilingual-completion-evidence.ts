import type { MiraclEvidenceLanguage } from "./miracl-multilingual-contract.js";
import {
	type MultilingualFullCorpusResult,
	verifyMultilingualFullCorpusIdentity,
} from "./miracl-multilingual-full-corpus-evidence.js";
import type { FullCorpusCheckpointChainEvidence } from "./native-full-corpus-checkpoint.js";
import {
	EXPECTED_QDRANT_COMMIT,
	EXPECTED_QDRANT_VERSION,
	EXPECTED_TREC_EVAL_BINARY_SHA256,
	METRIC_TOLERANCE,
	TREC_EVAL_COMMIT,
	TREC_EVAL_VERSION,
	matchesTrecEvalOutputPrecision,
	parseTrecEvalAll,
	sha256Bytes,
} from "./native-full-corpus-evidence.js";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";

interface MultilingualLaunchReceipt {
	schemaVersion: number;
	pid: number;
	capturedAt: string;
	procStartTicks: string;
	bootId: string;
	cmdline: string[];
	cudaVisibleDevices: string;
	qdrantUrl: string;
	language: string;
	outputPath: string;
	evaluationSourceSha256: string;
}

interface MultilingualRuntimeObservation {
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

export interface MultilingualQdrantEvidence {
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
}

export interface MultilingualCompletionEvidenceInput {
	language: MiraclEvidenceLanguage;
	resultPath: string;
	resultText: string;
	trecPath: string;
	trecRunText: string;
	topicsPath: string;
	topicsText: string;
	qrelsPath: string;
	qrelsText: string;
	sourceReceiptPath: string;
	sourceReceiptText: string;
	checkpointChain: FullCorpusCheckpointChainEvidence;
	launchReceiptPath: string;
	launchReceiptText: string;
	runtimeObservationPath: string;
	runtimeObservationText: string;
	trecEvalPath: string;
	trecEvalStdout: string;
	trecEvalBinarySha256: string;
	trecEvalSourceCommit: string;
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
	artifactStability: {
		resultAfterSha256: string;
		topicsAfterSha256: string;
		sourceReceiptAfterSha256: string;
		launchReceiptAfterSha256: string;
		runtimeObservationAfterSha256: string;
		checkpointChainAfterSha256: string;
	};
	evaluationSourceSha256: string;
	runtimeMonitorSourceSha256: string;
	qdrantUrl: string;
	qdrant: MultilingualQdrantEvidence;
}

function parseJson<T>(text: string, name: string): T {
	try {
		return JSON.parse(text) as T;
	} catch (error) {
		throw new Error(`${name} is not valid JSON`, { cause: error });
	}
}

export function createMultilingualCompletionEvidence(
	input: MultilingualCompletionEvidenceInput,
) {
	const result = parseJson<MultilingualFullCorpusResult>(
		input.resultText,
		"result",
	);
	const resultSha256 = sha256Bytes(input.resultText);
	const trecSha256 = sha256Bytes(input.trecRunText);
	const topicsSha256 = sha256Bytes(input.topicsText);
	const qrelsSha256 = sha256Bytes(input.qrelsText);
	const sourceReceiptSha256 = sha256Bytes(input.sourceReceiptText);
	const identity = verifyMultilingualFullCorpusIdentity({
		language: input.language,
		result,
		sourceReceipt: parseJson<unknown>(
			input.sourceReceiptText,
			"source receipt",
		),
		topicsText: input.topicsText,
		qrelsText: input.qrelsText,
		trecRunText: input.trecRunText,
		checkpointChain: input.checkpointChain,
	});
	const launch = parseJson<MultilingualLaunchReceipt>(
		input.launchReceiptText,
		"launch receipt",
	);
	const runtime = parseJson<MultilingualRuntimeObservation>(
		input.runtimeObservationText,
		"runtime observation",
	);
	const launchSha256 = sha256Bytes(input.launchReceiptText);
	const runtimeObservationSha256 = sha256Bytes(input.runtimeObservationText);
	const launchCapturedAt = Date.parse(launch.capturedAt);
	const observationStartedAt = Date.parse(runtime.observation.startedAt);
	const observationCompletedAt = Date.parse(runtime.observation.completedAt);
	if (
		launch.schemaVersion !== 1 ||
		launch.language !== input.language ||
		launch.cudaVisibleDevices !== "" ||
		launch.qdrantUrl !== input.qdrantUrl ||
		launch.outputPath !== input.resultPath ||
		!launch.cmdline.some((argument) =>
			argument.endsWith("native-full-corpus-evaluation-cli.ts"),
		) ||
		!/^[a-f0-9]{64}$/.test(launch.evaluationSourceSha256)
	)
		throw new Error("multilingual benchmark launch evidence mismatch");
	if (launch.evaluationSourceSha256 !== input.evaluationSourceSha256)
		throw new Error("evaluation source changed after launch");
	if (
		runtime.schemaVersion !== 1 ||
		runtime.monitor.sourceSha256 !== input.runtimeMonitorSourceSha256 ||
		runtime.launchReceipt.path !== input.launchReceiptPath ||
		runtime.launchReceipt.sha256 !== launchSha256 ||
		runtime.process.pid !== launch.pid ||
		runtime.process.bootId !== launch.bootId ||
		runtime.process.procStartTicks !== launch.procStartTicks ||
		runtime.process.cmdlineSha256 !== sha256Bytes(launch.cmdline.join("\0")) ||
		!Number.isFinite(launchCapturedAt) ||
		!Number.isFinite(observationStartedAt) ||
		!Number.isFinite(observationCompletedAt) ||
		observationStartedAt < launchCapturedAt ||
		observationCompletedAt < observationStartedAt ||
		runtime.observation.pollMilliseconds !== 5_000 ||
		!Number.isSafeInteger(runtime.observation.samples) ||
		runtime.observation.samples < 1 ||
		!Number.isSafeInteger(runtime.observation.peakRssBytes) ||
		runtime.observation.peakRssBytes < 1 ||
		runtime.result.path !== input.resultPath ||
		runtime.result.sha256 !== resultSha256
	)
		throw new Error("multilingual benchmark runtime evidence mismatch");
	if (
		input.trecEvalBinarySha256 !== EXPECTED_TREC_EVAL_BINARY_SHA256 ||
		input.trecEvalSourceCommit !== TREC_EVAL_COMMIT
	)
		throw new Error("independent evaluator identity mismatch");
	const stability = input.evaluationStability;
	if (
		stability.trecBeforeSha256 !== trecSha256 ||
		stability.trecAfterSha256 !== trecSha256 ||
		stability.qrelsBeforeSha256 !== qrelsSha256 ||
		stability.qrelsAfterSha256 !== qrelsSha256 ||
		stability.binaryBeforeSha256 !== input.trecEvalBinarySha256 ||
		stability.binaryAfterSha256 !== input.trecEvalBinarySha256 ||
		stability.sourceCommitBefore !== input.trecEvalSourceCommit ||
		stability.sourceCommitAfter !== input.trecEvalSourceCommit
	)
		throw new Error("independent evaluator stability mismatch");
	const artifactStability = input.artifactStability;
	if (
		artifactStability.resultAfterSha256 !== resultSha256 ||
		artifactStability.topicsAfterSha256 !== topicsSha256 ||
		artifactStability.sourceReceiptAfterSha256 !== sourceReceiptSha256 ||
		artifactStability.launchReceiptAfterSha256 !== launchSha256 ||
		artifactStability.runtimeObservationAfterSha256 !==
			runtimeObservationSha256 ||
		artifactStability.checkpointChainAfterSha256 !==
			evidenceObjectSha256(input.checkpointChain)
	)
		throw new Error("completion artifact stability mismatch");
	const qdrant = input.qdrant;
	if (
		qdrant.version !== EXPECTED_QDRANT_VERSION ||
		qdrant.commit !== EXPECTED_QDRANT_COMMIT ||
		qdrant.pointsCount !== result.inputs.documentCount ||
		qdrant.status !== "green" ||
		qdrant.vectorSize !== 1024 ||
		qdrant.distance !== "Cosine" ||
		qdrant.hnswM !== 0 ||
		qdrant.indexingThreshold !== 0 ||
		qdrant.membership.documentCount !== result.inputs.documentCount ||
		qdrant.membership.docidsSha256 !== result.inputs.corpusDocidsSha256 ||
		qdrant.membership.firstPointId !== 1 ||
		qdrant.membership.lastPointId !== result.inputs.documentCount
	)
		throw new Error("multilingual Qdrant runtime evidence mismatch");
	const reproduced = parseTrecEvalAll(input.trecEvalStdout);
	const ndcgAt10 = reproduced.get("ndcg_cut_10");
	const recallAt100 = reproduced.get("recall_100");
	if (
		ndcgAt10 === undefined ||
		recallAt100 === undefined ||
		!matchesTrecEvalOutputPrecision(result.metrics.ndcgAt10, ndcgAt10) ||
		!matchesTrecEvalOutputPrecision(result.metrics.recallAt100, recallAt100)
	)
		throw new Error("independent metric reproduction mismatch");
	const artifacts = {
		result: { path: input.resultPath, sha256: resultSha256 },
		trec: { path: input.trecPath, sha256: trecSha256 },
		topics: { path: input.topicsPath, sha256: topicsSha256 },
		qrels: { path: input.qrelsPath, sha256: qrelsSha256 },
		sourceReceipt: {
			path: input.sourceReceiptPath,
			sha256: sourceReceiptSha256,
		},
		launchReceipt: { path: input.launchReceiptPath, sha256: launchSha256 },
		runtimeObservation: {
			path: input.runtimeObservationPath,
			sha256: runtimeObservationSha256,
		},
		checkpointChain: input.checkpointChain,
	};
	return {
		schemaVersion: "naia-memory-miracl-multilingual-completion-evidence-v1",
		verdict: "LOCAL_PASS",
		assurance: "self-observed-local",
		publicClaimEligible: false,
		publicClaimRequirement:
			"independent signed execution attestation from a runner outside the benchmark operator trust boundary",
		claimBoundary: {
			launchReceipt:
				"operator-captured after process start; proves attachment identity, not preregistration",
			runtimeSnapshot:
				"local Qdrant configuration and membership observations are sequential, not an atomic external attestation",
		},
		language: input.language,
		benchmark: result.benchmark,
		identity,
		artifacts,
		artifactManifestSha256: evidenceObjectSha256(artifacts),
		independentEvaluatorTool: {
			name: "usnistgov/trec_eval",
			version: TREC_EVAL_VERSION,
			commit: TREC_EVAL_COMMIT,
			binaryPath: input.trecEvalPath,
			binarySha256: input.trecEvalBinarySha256,
			stdout: input.trecEvalStdout,
			stdoutSha256: sha256Bytes(input.trecEvalStdout),
			executionStability: stability,
		},
		metrics: {
			inProcess: result.metrics,
			reproducedByIndependentTool: { ndcgAt10, recallAt100 },
			tolerance: METRIC_TOLERANCE,
		},
		runtime: {
			cpuOnly: true,
			attachmentDelayMilliseconds: observationStartedAt - launchCapturedAt,
			observationBoundary:
				"monitor-attached-after-launch; Linux VmHWM is cumulative for the observed process lifetime",
			qdrantUrl: input.qdrantUrl,
			qdrant,
		},
		implementation: {
			evaluationSourceSha256: input.evaluationSourceSha256,
			runtimeMonitorSourceSha256: input.runtimeMonitorSourceSha256,
			artifactStability,
		},
	};
}
