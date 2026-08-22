#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { verifyFullCorpusCheckpointChain } from "./native-full-corpus-checkpoint.js";
import {
	type FullCorpusResult,
	createFullCorpusEvidenceReceipt,
	sha256Bytes,
} from "./native-full-corpus-evidence.js";
import { fullCorpusEmbeddingExecutionPolicy } from "./native-full-corpus-policy.js";
import { MIRACL_KO_LOCK } from "./public-miracl-source.js";

const resultPath =
	process.env.MIRACL_FULL_OUTPUT ??
	"reports/quality/miracl-ko-full-corpus-vector-exact.json";
const trecPath = `${resultPath}.trec`;
const sourceRoot =
	process.env.MIRACL_SOURCE_DIR ?? ".cache/benchmark-sources/miracl-ko-v1.0";
const topicsPath = join(sourceRoot, MIRACL_KO_LOCK.files[0].path);
const qrelsPath = join(sourceRoot, MIRACL_KO_LOCK.files[1].path);
const evaluatorPath =
	process.env.TREC_EVAL_PATH ?? ".cache/tools/trec_eval-ba38899/trec_eval";
const launchReceiptPath =
	process.env.MIRACL_FULL_LAUNCH_RECEIPT ??
	"reports/quality/miracl-ko-full-corpus-launch-receipt.json";
const runtimeObservationPath =
	process.env.MIRACL_FULL_RUNTIME_OBSERVATION ??
	"reports/quality/miracl-ko-full-corpus-runtime-observation.json";
const outputPath =
	process.env.MIRACL_FULL_EVIDENCE_OUTPUT ?? `${resultPath}.evidence.json`;
const qdrantUrl = process.env.QDRANT_URL ?? "http://127.0.0.1:6334";
const checkpointRoot =
	process.env.MIRACL_FULL_CHECKPOINT_DIR ??
	".cache/benchmark-runs/miracl-ko-full-v1";

async function main() {
	if (existsSync(outputPath)) throw new Error("evidence output already exists");
	const resultText = readFileSync(resultPath, "utf8");
	const trec = readFileSync(trecPath);
	const topics = readFileSync(topicsPath);
	const qrels = readFileSync(qrelsPath);
	const result = JSON.parse(resultText) as FullCorpusResult;
	const launchReceiptBytes = readFileSync(launchReceiptPath);
	const launchReceipt = JSON.parse(launchReceiptBytes.toString("utf8")) as {
		pid: number;
		capturedAt: string;
		procStartTicks: string;
		bootId: string;
		cmdline: string[];
		cudaVisibleDevices: string;
		qdrantUrl: string;
		outputPath: string;
		evaluationSourceSha256: string;
		embeddingInferenceMode?: "per-item-v1" | "padded-array-batch-v1";
	};
	const runtimeObservation = JSON.parse(
		readFileSync(runtimeObservationPath, "utf8"),
	);
	const embedding = result.configuration.embedding;
	const inferenceMode = result.configuration.embeddingInferenceMode;
	if (!embedding || !inferenceMode)
		throw new Error("result embedding policy is missing");
	const executionPolicy = fullCorpusEmbeddingExecutionPolicy(
		embedding,
		result.configuration.passageComposition ?? "",
		inferenceMode,
	);
	if (result.ingestion.lastChunkReceiptSha256 === null)
		throw new Error("result checkpoint terminal is missing");
	const checkpointChain = verifyFullCorpusCheckpointChain({
		directory: join(checkpointRoot, executionPolicy.checkpointLeaf),
		sourceLockSha256: result.inputs.sourceLockSha256,
		embeddingPolicySha256: executionPolicy.embeddingPolicySha256,
		dimensions: embedding.dimensions,
		documentCount: result.inputs.documentCount,
		chunkSize: 512,
		docidsSha256: result.inputs.corpusDocidsSha256,
		lastChunkReceiptSha256: result.ingestion.lastChunkReceiptSha256,
	});
	if (launchReceipt.qdrantUrl !== qdrantUrl)
		throw new Error("launch receipt Qdrant URL mismatch");
	const rootResponse = await fetch(`${qdrantUrl}/`);
	if (!rootResponse.ok)
		throw new Error(`Qdrant root HTTP ${rootResponse.status}`);
	const identity = (await rootResponse.json()) as {
		version: string;
		commit: string;
	};
	const collectionResponse = await fetch(
		`${qdrantUrl}/collections/${encodeURIComponent(result.configuration.collectionName)}`,
	);
	if (!collectionResponse.ok)
		throw new Error(`Qdrant collection HTTP ${collectionResponse.status}`);
	const collectionBody = (await collectionResponse.json()) as {
		result?: {
			status?: string;
			points_count?: number;
			config?: {
				params?: { vectors?: { size?: number; distance?: string } };
				hnsw_config?: { m?: number };
				optimizer_config?: { indexing_threshold?: number };
			};
		};
	};
	if (!collectionBody.result)
		throw new Error("Qdrant collection result missing");
	const argv = ["-m", "ndcg_cut.10", "-m", "recall.100", qrelsPath, trecPath];
	const stdout = execFileSync(evaluatorPath, argv, { encoding: "utf8" });
	const receipt = createFullCorpusEvidenceReceipt({
		result,
		resultSha256: sha256Bytes(resultText),
		trecSha256: sha256Bytes(trec),
		trecRunText: trec.toString("utf8"),
		topicsSha256: sha256Bytes(topics),
		qrelsSha256: sha256Bytes(qrels),
		trecEvalStdout: stdout,
		trecEvalBinarySha256: sha256Bytes(readFileSync(evaluatorPath)),
		trecEvalSourceCommit: execFileSync(
			"git",
			["-C", dirname(evaluatorPath), "rev-parse", "HEAD"],
			{ encoding: "utf8" },
		).trim(),
		trecEvalPath: evaluatorPath,
		topicsPath,
		qrelsPath,
		trecPath,
		checkpointChain,
		launchReceipt,
		launchReceiptSha256: sha256Bytes(launchReceiptBytes),
		runtimeObservation,
		qdrant: {
			version: identity.version,
			commit: identity.commit,
			pointsCount: collectionBody.result.points_count ?? -1,
			status: collectionBody.result.status ?? "missing",
			vectorSize: collectionBody.result.config?.params?.vectors?.size ?? -1,
			distance:
				collectionBody.result.config?.params?.vectors?.distance ?? "missing",
			hnswM: collectionBody.result.config?.hnsw_config?.m ?? -1,
			indexingThreshold:
				collectionBody.result.config?.optimizer_config?.indexing_threshold ??
				-1,
		},
	});
	const temporary = `${outputPath}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
	renameSync(temporary, outputPath);
	process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

await main();
