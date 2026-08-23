#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyFullCorpusCheckpointChain } from "./native-full-corpus-checkpoint.js";
import {
	type FullCorpusResult,
	createFullCorpusEvidenceReceipt,
	resolveFullCorpusInferenceMode,
	sha256Bytes,
} from "./native-full-corpus-evidence.js";
import { fullCorpusEmbeddingExecutionPolicy } from "./native-full-corpus-policy.js";
import {
	PublicEvidenceDirectorySyncError,
	writeExclusiveEvidenceFile,
} from "./public-evidence-file-io.js";
import { MIRACL_KO_LOCK } from "./public-miracl-source.js";
import { auditQdrantCollectionMembership } from "./qdrant-collection-membership.js";

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

export async function publishFullCorpusEvidenceReceipt(
	path: string,
	receipt: unknown,
	evidenceWriter: typeof writeExclusiveEvidenceFile = writeExclusiveEvidenceFile,
): Promise<void> {
	try {
		await evidenceWriter(
			resolve(path),
			Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`),
		);
	} catch (error) {
		if (error instanceof PublicEvidenceDirectorySyncError)
			throw new Error(
				"full-corpus evidence output was written but crash-durability could not be confirmed; inspect the existing output before retry",
				{ cause: error },
			);
		if (
			error !== null &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "EEXIST"
		)
			throw new Error("full-corpus evidence output already exists", {
				cause: error,
			});
		throw new Error("full-corpus evidence output cannot be written", {
			cause: error,
		});
	}
}

export async function runFullCorpusEvidenceCli() {
	if (existsSync(outputPath)) throw new Error("evidence output already exists");
	const resultText = readFileSync(resultPath, "utf8");
	const trec = readFileSync(trecPath);
	const topics = readFileSync(topicsPath);
	const qrels = readFileSync(qrelsPath);
	const result = JSON.parse(resultText) as FullCorpusResult;
	const launchReceiptText = readFileSync(launchReceiptPath, "utf8");
	const launchReceipt = JSON.parse(launchReceiptText) as {
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
	const runtimeObservationText = readFileSync(runtimeObservationPath, "utf8");
	const embedding = result.configuration.embedding;
	if (!embedding) throw new Error("result embedding policy is missing");
	const inferenceMode = resolveFullCorpusInferenceMode(
		result,
		launchReceipt.evaluationSourceSha256,
	);
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
	const collectionMembership = await auditQdrantCollectionMembership({
		baseUrl: qdrantUrl,
		collectionName: result.configuration.collectionName,
		expectedDocumentCount: result.inputs.documentCount,
	});
	const argv = ["-m", "ndcg_cut.10", "-m", "recall.100", qrelsPath, trecPath];
	const binaryBeforeSha256 = sha256Bytes(readFileSync(evaluatorPath));
	const sourceCommitBefore = execFileSync(
		"git",
		["-C", dirname(evaluatorPath), "rev-parse", "HEAD"],
		{ encoding: "utf8" },
	).trim();
	const stdout = execFileSync(evaluatorPath, argv, { encoding: "utf8" });
	const evaluationStability = {
		trecBeforeSha256: sha256Bytes(trec),
		trecAfterSha256: sha256Bytes(readFileSync(trecPath)),
		qrelsBeforeSha256: sha256Bytes(qrels),
		qrelsAfterSha256: sha256Bytes(readFileSync(qrelsPath)),
		binaryBeforeSha256,
		binaryAfterSha256: sha256Bytes(readFileSync(evaluatorPath)),
		sourceCommitBefore,
		sourceCommitAfter: execFileSync(
			"git",
			["-C", dirname(evaluatorPath), "rev-parse", "HEAD"],
			{ encoding: "utf8" },
		).trim(),
	};
	const receipt = createFullCorpusEvidenceReceipt({
		resultText,
		resultSha256: sha256Bytes(resultText),
		trecSha256: sha256Bytes(trec),
		trecRunText: trec.toString("utf8"),
		topicsSha256: sha256Bytes(topics),
		qrelsSha256: sha256Bytes(qrels),
		trecEvalStdout: stdout,
		trecEvalBinarySha256: binaryBeforeSha256,
		trecEvalSourceCommit: sourceCommitBefore,
		trecEvalPath: evaluatorPath,
		evaluationStability,
		topicsPath,
		qrelsPath,
		trecPath,
		checkpointChain,
		launchReceiptPath,
		launchReceiptText,
		runtimeObservationPath,
		runtimeObservationText,
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
			membership: collectionMembership,
		},
	});
	await publishFullCorpusEvidenceReceipt(outputPath, receipt);
	process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

const invokedPath =
	process.argv[1] && pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) await runFullCorpusEvidenceCli();
