#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	type MultilingualQdrantEvidence,
	createMultilingualCompletionEvidence,
} from "./miracl-multilingual-completion-evidence.js";
import {
	MIRACL_MULTILINGUAL_CONTRACT,
	type MiraclEvidenceLanguage,
} from "./miracl-multilingual-contract.js";
import { miraclSourceRoot } from "./miracl-multilingual-download.js";
import { verifyFullCorpusCheckpointChain } from "./native-full-corpus-checkpoint.js";
import { publishFullCorpusEvidenceReceipt } from "./native-full-corpus-evidence-cli.js";
import {
	type FullCorpusResult,
	resolveFullCorpusInferenceMode,
	sha256Bytes,
} from "./native-full-corpus-evidence.js";
import { fullCorpusEmbeddingExecutionPolicy } from "./native-full-corpus-policy.js";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import { auditQdrantCollectionMembership } from "./qdrant-collection-membership.js";

function evidenceLanguage(value: string | undefined): MiraclEvidenceLanguage {
	const language = value ?? "ko";
	if (!Object.hasOwn(MIRACL_MULTILINGUAL_CONTRACT, language))
		throw new Error(`unsupported MIRACL evidence language: ${language}`);
	return language as MiraclEvidenceLanguage;
}

export async function runMultilingualCompletionEvidenceCli(
	environment = process.env,
) {
	const language = evidenceLanguage(environment.MIRACL_LANGUAGE);
	const contract = MIRACL_MULTILINGUAL_CONTRACT[language];
	const resultPath =
		environment.MIRACL_FULL_OUTPUT ??
		`reports/quality/miracl-${language}-full-corpus-vector-exact.json`;
	const trecPath = `${resultPath}.trec`;
	const sourceRoot =
		environment.MIRACL_SOURCE_DIR ?? miraclSourceRoot(language);
	const sourceReceiptPath =
		environment.MIRACL_SOURCE_RECEIPT ??
		join(sourceRoot, "source-lock-receipt.json");
	const topicsPath = join(sourceRoot, contract.topics.path);
	const qrelsPath = join(sourceRoot, contract.qrels.path);
	const evaluatorPath =
		environment.TREC_EVAL_PATH ?? ".cache/tools/trec_eval-ba38899/trec_eval";
	const launchReceiptPath =
		environment.MIRACL_FULL_LAUNCH_RECEIPT ??
		`reports/quality/miracl-${language}-full-corpus-launch-receipt.json`;
	const runtimeObservationPath =
		environment.MIRACL_FULL_RUNTIME_OBSERVATION ??
		`reports/quality/miracl-${language}-full-corpus-runtime-observation.json`;
	const outputPath =
		environment.MIRACL_FULL_EVIDENCE_OUTPUT ?? `${resultPath}.evidence.json`;
	const qdrantUrl = environment.QDRANT_URL ?? "http://127.0.0.1:6334";
	const qdrantServiceReceiptPath = environment.MIRACL_QDRANT_SERVICE_RECEIPT;
	if (language !== "en" && qdrantServiceReceiptPath)
		throw new Error(
			"Qdrant service binding receipts are reserved for English evidence",
		);
	const checkpointRoot =
		environment.MIRACL_FULL_CHECKPOINT_DIR ??
		`.cache/benchmark-runs/miracl-${language}-full-v1`;
	if (existsSync(outputPath)) throw new Error("evidence output already exists");
	for (const path of [
		resultPath,
		trecPath,
		sourceReceiptPath,
		topicsPath,
		qrelsPath,
		launchReceiptPath,
		runtimeObservationPath,
		evaluatorPath,
	]) {
		if (!existsSync(path))
			throw new Error(`required evidence input missing: ${path}`);
	}
	if (language === "en" && !qdrantServiceReceiptPath)
		throw new Error("English Qdrant service receipt input is missing");
	if (qdrantServiceReceiptPath && !existsSync(qdrantServiceReceiptPath))
		throw new Error(
			`required evidence input missing: ${qdrantServiceReceiptPath}`,
		);
	const resultText = readFileSync(resultPath, "utf8");
	const result = JSON.parse(resultText) as FullCorpusResult;
	const trecRunText = readFileSync(trecPath, "utf8");
	const sourceReceiptText = readFileSync(sourceReceiptPath, "utf8");
	const topicsText = readFileSync(topicsPath, "utf8");
	const qrelsText = readFileSync(qrelsPath, "utf8");
	const launchReceiptText = readFileSync(launchReceiptPath, "utf8");
	const launchReceipt = JSON.parse(launchReceiptText) as {
		qdrantUrl: string;
		evaluationSourceSha256: string;
	};
	const runtimeObservationText = readFileSync(runtimeObservationPath, "utf8");
	const qdrantServiceReceiptText = qdrantServiceReceiptPath
		? readFileSync(qdrantServiceReceiptPath, "utf8")
		: undefined;
	const runtimeObservation = JSON.parse(runtimeObservationText) as {
		monitor: { sourceSha256: string };
	};
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
	const qdrantIdentity = (await rootResponse.json()) as {
		version: string;
		commit: string;
	};
	const collectionResponse = await fetch(
		`${qdrantUrl}/collections/${encodeURIComponent(result.configuration.collectionName)}`,
	);
	if (!collectionResponse.ok)
		throw new Error(`Qdrant collection HTTP ${collectionResponse.status}`);
	const collection = (await collectionResponse.json()) as {
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
	if (!collection.result) throw new Error("Qdrant collection result missing");
	const membership = await auditQdrantCollectionMembership({
		baseUrl: qdrantUrl,
		collectionName: result.configuration.collectionName,
		expectedDocumentCount: result.inputs.documentCount,
	});
	const qdrant: MultilingualQdrantEvidence = {
		version: qdrantIdentity.version,
		commit: qdrantIdentity.commit,
		pointsCount: collection.result.points_count ?? -1,
		status: collection.result.status ?? "missing",
		vectorSize: collection.result.config?.params?.vectors?.size ?? -1,
		distance: collection.result.config?.params?.vectors?.distance ?? "missing",
		hnswM: collection.result.config?.hnsw_config?.m ?? -1,
		indexingThreshold:
			collection.result.config?.optimizer_config?.indexing_threshold ?? -1,
		membership,
	};
	const argv = ["-m", "ndcg_cut.10", "-m", "recall.100", qrelsPath, trecPath];
	const trecBeforeSha256 = sha256Bytes(trecRunText);
	const qrelsBeforeSha256 = sha256Bytes(qrelsText);
	const binaryBeforeSha256 = sha256Bytes(readFileSync(evaluatorPath));
	const sourceCommitBefore = execFileSync(
		"git",
		["-C", dirname(evaluatorPath), "rev-parse", "HEAD"],
		{ encoding: "utf8" },
	).trim();
	const trecEvalStdout = execFileSync(evaluatorPath, argv, {
		encoding: "utf8",
	});
	const checkpointChainAfter = verifyFullCorpusCheckpointChain({
		directory: join(checkpointRoot, executionPolicy.checkpointLeaf),
		sourceLockSha256: result.inputs.sourceLockSha256,
		embeddingPolicySha256: executionPolicy.embeddingPolicySha256,
		dimensions: embedding.dimensions,
		documentCount: result.inputs.documentCount,
		chunkSize: 512,
		docidsSha256: result.inputs.corpusDocidsSha256,
		lastChunkReceiptSha256: result.ingestion.lastChunkReceiptSha256,
	});
	const evidence = createMultilingualCompletionEvidence({
		language,
		resultPath,
		resultText,
		trecPath,
		trecRunText,
		topicsPath,
		topicsText,
		qrelsPath,
		qrelsText,
		sourceReceiptPath,
		sourceReceiptText,
		checkpointChain,
		launchReceiptPath,
		launchReceiptText,
		runtimeObservationPath,
		runtimeObservationText,
		qdrantServiceReceiptPath,
		qdrantServiceReceiptText,
		trecEvalPath: evaluatorPath,
		trecEvalStdout,
		trecEvalBinarySha256: binaryBeforeSha256,
		trecEvalSourceCommit: sourceCommitBefore,
		evaluationStability: {
			trecBeforeSha256,
			trecAfterSha256: sha256Bytes(readFileSync(trecPath)),
			qrelsBeforeSha256,
			qrelsAfterSha256: sha256Bytes(readFileSync(qrelsPath)),
			binaryBeforeSha256,
			binaryAfterSha256: sha256Bytes(readFileSync(evaluatorPath)),
			sourceCommitBefore,
			sourceCommitAfter: execFileSync(
				"git",
				["-C", dirname(evaluatorPath), "rev-parse", "HEAD"],
				{ encoding: "utf8" },
			).trim(),
		},
		artifactStability: {
			resultAfterSha256: sha256Bytes(readFileSync(resultPath)),
			topicsAfterSha256: sha256Bytes(readFileSync(topicsPath)),
			sourceReceiptAfterSha256: sha256Bytes(readFileSync(sourceReceiptPath)),
			launchReceiptAfterSha256: sha256Bytes(readFileSync(launchReceiptPath)),
			runtimeObservationAfterSha256: sha256Bytes(
				readFileSync(runtimeObservationPath),
			),
			qdrantServiceReceiptAfterSha256: qdrantServiceReceiptPath
				? sha256Bytes(readFileSync(qdrantServiceReceiptPath))
				: undefined,
			checkpointChainAfterSha256: evidenceObjectSha256(checkpointChainAfter),
		},
		evaluationSourceSha256: sha256Bytes(
			readFileSync(
				resolve("src/benchmark/quality/native-full-corpus-evaluation-cli.ts"),
			),
		),
		runtimeMonitorSourceSha256: sha256Bytes(
			readFileSync(
				resolve(
					"src/benchmark/quality/native-full-corpus-runtime-monitor-cli.ts",
				),
			),
		),
		qdrantUrl,
		qdrant,
	});
	await publishFullCorpusEvidenceReceipt(outputPath, evidence);
	process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

const invokedPath =
	process.argv[1] && pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url)
	await runMultilingualCompletionEvidenceCli();
