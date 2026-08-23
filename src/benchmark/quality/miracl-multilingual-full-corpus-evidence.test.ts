import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createMultilingualCompletionEvidence } from "./miracl-multilingual-completion-evidence.js";
import { MIRACL_MULTILINGUAL_CONTRACT } from "./miracl-multilingual-contract.js";
import { miraclSourceLockReceipt } from "./miracl-multilingual-download.js";
import {
	MULTILINGUAL_FULL_CORPUS_PREFLIGHT_CLAIM_BOUNDARY,
	type MultilingualFullCorpusResult,
	verifyMultilingualFullCorpusIdentity,
} from "./miracl-multilingual-full-corpus-evidence.js";
import {
	EXPECTED_QDRANT_COMMIT,
	EXPECTED_QDRANT_VERSION,
	EXPECTED_TREC_EVAL_BINARY_SHA256,
	MIRACL_EMBEDDING_POLICY,
	MIRACL_PASSAGE_COMPOSITION,
	sha256Bytes,
} from "./native-full-corpus-evidence.js";
import { fullCorpusEmbeddingExecutionPolicy } from "./native-full-corpus-policy.js";
import { buildNativeRuntimeExecutionIdentity } from "./native-runtime-execution-identity.js";
import { buildNativeRuntimeSourceManifest } from "./native-runtime-source-manifest.js";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";

const corpus = [
	[
		"docs-0.jsonl.gz",
		94_104_175,
		"f3c38eaa54836397aae4793bb052430646028c2c958c1a54fb71900c83f5dcee",
	],
	[
		"docs-1.jsonl.gz",
		83_793_880,
		"77f67390f95a69ae2447fffb2a62c0de9d28e8d0eb3bf97cfe04e85c1924cd42",
	],
	[
		"docs-2.jsonl.gz",
		70_295_610,
		"8c10dda6b56429841e730432aa75d3338e37b605410b936b4fc6c914521d2aec",
	],
	[
		"docs-3.jsonl.gz",
		64_551_259,
		"0d0a02ec18ca8e246f0af5788077fa23f1de35d5a40dee6cacc4fe5a2b91f904",
	],
	[
		"docs-4.jsonl.gz",
		7_227_421,
		"4b75ab6cac6ae8615a60f1b278460dd3d9ef776ea002a6684a6757631fec62fc",
	],
] as const;

describe("multilingual full-corpus evidence identity", () => {
	it("rejects internally consistent artifacts that are not the locked Arabic bytes", () => {
		const contract = MIRACL_MULTILINGUAL_CONTRACT.ar;
		const sourceReceipt = miraclSourceLockReceipt("ar", [
			{ ...contract.topics, provider: "dataset" },
			{ ...contract.qrels, provider: "dataset" },
			...corpus.map(([name, size, sha256]) => ({
				path: `${contract.corpus.directory}/${name}`,
				size,
				sha256,
				provider: "corpus" as const,
			})),
		]);
		const ids = Array.from(
			{ length: contract.topics.queryCount },
			(_, index) => `${index + 1}`,
		);
		const topicsText = `${ids.map((id) => `${id}\tquery ${id}`).join("\n")}\n`;
		const qrelsText = `${ids.map((id) => `${id}\tQ0\tdoc-${id}-1\t1`).join("\n")}\n`;
		const trecRunText = `${ids.flatMap((id) => Array.from({ length: 100 }, (_, index) => `${id} Q0 doc-${id}-${index + 1} ${index + 1} ${100 - index} naia-vector-exact`)).join("\n")}\n`;
		const policy = fullCorpusEmbeddingExecutionPolicy(
			MIRACL_EMBEDDING_POLICY,
			MIRACL_PASSAGE_COMPOSITION,
			"per-item-v1",
		);
		const result = {
			benchmark: "miracl-ar-full-corpus-naia-vector-exact-v1",
			inputs: {
				language: "ar",
				sourceLockSha256: sourceReceipt.sourceLockSha256,
				topicsSha256: sha256Bytes(topicsText),
				qrelsSha256: sha256Bytes(qrelsText),
				documentCount: contract.corpus.expectedDocumentCount,
				queryCount: contract.topics.queryCount,
				corpusDocidsSha256: contract.corpus.expectedDocidsSha256,
			},
			configuration: {
				passageComposition: MIRACL_PASSAGE_COMPOSITION,
				embedding: MIRACL_EMBEDDING_POLICY,
				embeddingInferenceMode: "per-item-v1",
				embeddingExecutionPolicySha256: policy.embeddingPolicySha256,
				vectorStore: "Qdrant",
				distance: "Cosine",
				exactSearch: true,
				topK: 100,
				cpuOnly: true,
				collectionName: `naia_miracl_ar_${sourceReceipt.sourceLockSha256.slice(0, 8)}_${policy.embeddingPolicySha256.slice(0, 8)}`,
			},
			metrics: { ndcgAt10: 0, recallAt100: 0 },
			ingestion: { lastChunkReceiptSha256: "a".repeat(64) },
			trecSha256: sha256Bytes(trecRunText),
		} satisfies MultilingualFullCorpusResult;
		const checkpointChain = {
			directory: "checkpoints/ar",
			chunkCount: Math.ceil(contract.corpus.expectedDocumentCount / 512),
			documentCount: contract.corpus.expectedDocumentCount,
			docidsSha256: contract.corpus.expectedDocidsSha256,
			lastChunkReceiptSha256: "a".repeat(64),
		};
		expect(() =>
			verifyMultilingualFullCorpusIdentity({
				language: "ar",
				result,
				sourceReceipt,
				topicsText,
				qrelsText,
				trecRunText,
				checkpointChain,
			}),
		).toThrow("retrieval artifact hash mismatch");
		expect(() =>
			verifyMultilingualFullCorpusIdentity({
				language: "ko",
				result,
				sourceReceipt,
				topicsText,
				qrelsText,
				trecRunText,
				checkpointChain,
			}),
		).toThrow("result language mismatch");
		expect(() =>
			verifyMultilingualFullCorpusIdentity({
				language: "toString" as "ar",
				result,
				sourceReceipt,
				topicsText,
				qrelsText,
				trecRunText,
				checkpointChain,
			}),
		).toThrow("unsupported MIRACL evidence language");
	});

	it.runIf(
		existsSync(
			".cache/benchmark-sources/miracl-ko-v1.0/miracl-v1.0-ko/topics/topics.miracl-v1.0-ko-dev.tsv",
		),
	)("passes against the frozen Korean full-corpus artifacts", () => {
		const contract = MIRACL_MULTILINGUAL_CONTRACT.ko;
		const sourceReceipt = miraclSourceLockReceipt("ko", [
			{ ...contract.topics, provider: "dataset" },
			{ ...contract.qrels, provider: "dataset" },
			...[
				[
					"docs-0.jsonl.gz",
					87_965_596,
					"c56a31883a291504aa9c97968fb7a5fbcc9ea1099ee1810200249e1afb7fc55d",
				],
				[
					"docs-1.jsonl.gz",
					75_422_723,
					"fecd2886124e78c3aa87c59604ac9909c23165415c70a96f4edb95677b5ed0cd",
				],
				[
					"docs-2.jsonl.gz",
					62_582_229,
					"93e90d098d78f50a9e76dd2e64608d65e0563787954f848da9b04286f81b75d9",
				],
			].map(([name, size, sha256]) => ({
				path: `${contract.corpus.directory}/${name}`,
				size: size as number,
				sha256: sha256 as string,
				provider: "corpus" as const,
			})),
		]);
		const topicsText = readFileSync(
			`.cache/benchmark-sources/miracl-ko-v1.0/${contract.topics.path}`,
			"utf8",
		);
		const qrelsText = readFileSync(
			`.cache/benchmark-sources/miracl-ko-v1.0/${contract.qrels.path}`,
			"utf8",
		);
		const trecRunText = readFileSync(
			"reports/quality/miracl-ko-full-corpus-vector-exact.json.trec",
			"utf8",
		);
		const frozen = JSON.parse(
			readFileSync(
				"reports/quality/miracl-ko-full-corpus-vector-exact.json",
				"utf8",
			),
		) as MultilingualFullCorpusResult;
		const policy = fullCorpusEmbeddingExecutionPolicy(
			MIRACL_EMBEDDING_POLICY,
			MIRACL_PASSAGE_COMPOSITION,
			"per-item-v1",
		);
		const result: MultilingualFullCorpusResult = {
			...frozen,
			inputs: {
				...frozen.inputs,
				language: "ko",
				sourceLockSha256: sourceReceipt.sourceLockSha256,
			},
			configuration: {
				...frozen.configuration,
				embeddingInferenceMode: "per-item-v1",
				embeddingExecutionPolicySha256: policy.embeddingPolicySha256,
				collectionName: `naia_miracl_ko_${sourceReceipt.sourceLockSha256.slice(0, 8)}_${policy.embeddingPolicySha256.slice(0, 8)}`,
			},
		};
		const checkpointChain = {
			directory: ".cache/benchmark-runs/miracl-ko-full-v1/vectors",
			chunkCount: 2_904,
			documentCount: contract.corpus.expectedDocumentCount,
			docidsSha256: contract.corpus.expectedDocidsSha256,
			lastChunkReceiptSha256: result.ingestion.lastChunkReceiptSha256 as string,
		};
		expect(
			verifyMultilingualFullCorpusIdentity({
				language: "ko",
				result,
				sourceReceipt,
				topicsText,
				qrelsText,
				trecRunText,
				checkpointChain,
			}),
		).toMatchObject({ language: "ko", role: "anchor" });

		const resultPath =
			"reports/quality/miracl-ko-full-corpus-vector-exact.json";
		const resultText = JSON.stringify(result);
		const launchReceiptPath = "reports/quality/launch.json";
		const evaluationSourceSha256 = "b".repeat(64);
		const launchReceiptText = JSON.stringify({
			schemaVersion: 1,
			pid: 123,
			capturedAt: "2026-08-23T00:00:00.000Z",
			procStartTicks: "456",
			bootId: "boot",
			cmdline: ["node", "native-full-corpus-evaluation-cli.ts"],
			cudaVisibleDevices: "",
			qdrantUrl: "http://127.0.0.1:6334",
			language: "ko",
			outputPath: resultPath,
			evaluationSourceSha256,
		});
		const runtimeMonitorSourceSha256 = "c".repeat(64);
		const runtimeObservationText = JSON.stringify({
			schemaVersion: 1,
			monitor: {
				source: "/repo/native-full-corpus-runtime-monitor-cli.ts",
				sourceSha256: runtimeMonitorSourceSha256,
			},
			launchReceipt: {
				path: launchReceiptPath,
				sha256: sha256Bytes(launchReceiptText),
			},
			process: {
				pid: 123,
				bootId: "boot",
				procStartTicks: "456",
				cmdlineSha256: sha256Bytes(
					["node", "native-full-corpus-evaluation-cli.ts"].join("\0"),
				),
			},
			observation: {
				startedAt: "2026-08-23T00:00:05.000Z",
				completedAt: "2026-08-23T01:00:00.000Z",
				pollMilliseconds: 5_000,
				samples: 720,
				peakRssBytes: 1024,
			},
			result: { path: resultPath, sha256: sha256Bytes(resultText) },
		});
		const qrelsSha256 = sha256Bytes(qrelsText);
		const trecSha256 = sha256Bytes(trecRunText);
		const evaluatorCommit = "ba38899cbd4de0fb699b47f39b64ef1c107e4a5c";
		const stability = {
			trecBeforeSha256: trecSha256,
			trecAfterSha256: trecSha256,
			qrelsBeforeSha256: qrelsSha256,
			qrelsAfterSha256: qrelsSha256,
			binaryBeforeSha256: EXPECTED_TREC_EVAL_BINARY_SHA256,
			binaryAfterSha256: EXPECTED_TREC_EVAL_BINARY_SHA256,
			sourceCommitBefore: evaluatorCommit,
			sourceCommitAfter: evaluatorCommit,
		};
		const sourceReceiptText = `${JSON.stringify(sourceReceipt, null, 2)}\n`;
		const artifactStability = {
			resultAfterSha256: sha256Bytes(resultText),
			topicsAfterSha256: sha256Bytes(topicsText),
			sourceReceiptAfterSha256: sha256Bytes(sourceReceiptText),
			launchReceiptAfterSha256: sha256Bytes(launchReceiptText),
			runtimeObservationAfterSha256: sha256Bytes(runtimeObservationText),
			checkpointChainAfterSha256: evidenceObjectSha256(checkpointChain),
		};
		const producerSourceManifest = buildNativeRuntimeSourceManifest({
			root: resolve(import.meta.dirname, "../../.."),
			entryPoint:
				"src/benchmark/quality/miracl-multilingual-completion-evidence-cli.ts",
			additionalInputs: ["package.json", "pnpm-lock.yaml", "tsconfig.json"],
		});
		const producerRuntimeIdentity = buildNativeRuntimeExecutionIdentity({
			nodeVersion: process.version,
			execPath: process.execPath,
			execArgv: [],
			environment: {},
		});
		const completion = createMultilingualCompletionEvidence({
			producerSourceManifest,
			producerRuntimeIdentity,
			language: "ko",
			resultPath,
			resultText,
			trecPath: `${resultPath}.trec`,
			trecRunText,
			topicsPath: contract.topics.path,
			topicsText,
			qrelsPath: contract.qrels.path,
			qrelsText,
			sourceReceiptPath: "source-lock-receipt.json",
			sourceReceiptText,
			checkpointChain,
			launchReceiptPath,
			launchReceiptText,
			runtimeObservationPath: "reports/quality/runtime.json",
			runtimeObservationText,
			trecEvalPath: "/tools/trec_eval",
			trecEvalStdout: `ndcg_cut_10 all ${result.metrics.ndcgAt10.toFixed(4)}\nrecall_100 all ${result.metrics.recallAt100.toFixed(4)}\n`,
			trecEvalBinarySha256: EXPECTED_TREC_EVAL_BINARY_SHA256,
			trecEvalSourceCommit: evaluatorCommit,
			evaluationStability: stability,
			artifactStability,
			evaluationSourceSha256,
			runtimeMonitorSourceSha256,
			qdrantUrl: "http://127.0.0.1:6334",
			qdrant: {
				version: EXPECTED_QDRANT_VERSION,
				commit: EXPECTED_QDRANT_COMMIT,
				pointsCount: result.inputs.documentCount,
				status: "green",
				vectorSize: 1024,
				distance: "Cosine",
				hnswM: 0,
				indexingThreshold: 0,
				membership: {
					documentCount: result.inputs.documentCount,
					docidsSha256: result.inputs.corpusDocidsSha256,
					firstPointId: 1,
					lastPointId: result.inputs.documentCount,
				},
			},
		});
		expect(completion).toMatchObject({
			verdict: "LOCAL_PASS",
			language: "ko",
			publicClaimEligible: false,
		});
		expect(completion.implementation.producerSourceManifest).toEqual(
			producerSourceManifest,
		);
		expect(completion.implementation.producerRuntimeIdentity).toEqual(
			producerRuntimeIdentity,
		);
		expect(() =>
			createMultilingualCompletionEvidence({
				...{
					producerSourceManifest: {
						...producerSourceManifest,
						manifestSha256: "0".repeat(64),
					},
					producerRuntimeIdentity,
					language: "ko" as const,
					resultPath,
					resultText,
					trecPath: `${resultPath}.trec`,
					trecRunText,
					topicsPath: contract.topics.path,
					topicsText,
					qrelsPath: contract.qrels.path,
					qrelsText,
					sourceReceiptPath: "source-lock-receipt.json",
					sourceReceiptText,
					checkpointChain,
					launchReceiptPath,
					launchReceiptText,
					runtimeObservationPath: "reports/quality/runtime.json",
					runtimeObservationText,
					trecEvalPath: "/tools/trec_eval",
					trecEvalStdout: `ndcg_cut_10 all ${result.metrics.ndcgAt10.toFixed(4)}\nrecall_100 all ${result.metrics.recallAt100.toFixed(4)}\n`,
					trecEvalBinarySha256: EXPECTED_TREC_EVAL_BINARY_SHA256,
					trecEvalSourceCommit: evaluatorCommit,
					evaluationStability: stability,
					artifactStability,
					evaluationSourceSha256,
					runtimeMonitorSourceSha256,
					qdrantUrl: "http://127.0.0.1:6334",
					qdrant: completion.runtime.qdrant,
				},
			}),
		).toThrow("runtime source manifest is internally inconsistent");
		expect(() =>
			createMultilingualCompletionEvidence({
				...{
					producerSourceManifest,
					producerRuntimeIdentity,
					language: "ko" as const,
					resultPath,
					resultText,
					trecPath: `${resultPath}.trec`,
					trecRunText,
					topicsPath: contract.topics.path,
					topicsText,
					qrelsPath: contract.qrels.path,
					qrelsText,
					sourceReceiptPath: "source-lock-receipt.json",
					sourceReceiptText,
					checkpointChain,
					launchReceiptPath,
					launchReceiptText,
					runtimeObservationPath: "reports/quality/runtime.json",
					runtimeObservationText,
					trecEvalPath: "/tools/trec_eval",
					trecEvalStdout: `ndcg_cut_10 all ${result.metrics.ndcgAt10.toFixed(4)}\nrecall_100 all ${result.metrics.recallAt100.toFixed(4)}\n`,
					trecEvalBinarySha256: EXPECTED_TREC_EVAL_BINARY_SHA256,
					trecEvalSourceCommit: evaluatorCommit,
					evaluationStability: stability,
					artifactStability,
					evaluationSourceSha256: "d".repeat(64),
					runtimeMonitorSourceSha256,
					qdrantUrl: "http://127.0.0.1:6334",
					qdrant: completion.runtime.qdrant,
				},
			}),
		).toThrow("evaluation source changed after launch");
	});

	it("keeps the preflight receipt outside score and public-claim authority", () => {
		expect(MULTILINGUAL_FULL_CORPUS_PREFLIGHT_CLAIM_BOUNDARY).toBe(
			"Identity and protocol preflight only; no score or public quality claim is established by this receipt.",
		);
	});
});
