import { describe, expect, it } from "vitest";
import {
	EXPECTED_EVALUATION_SOURCE_SHA256,
	EXPECTED_MIRACL_QRELS_SHA256,
	EXPECTED_MIRACL_SOURCE_LOCK_SHA256,
	EXPECTED_MIRACL_TOPICS_SHA256,
	EXPECTED_MIRACL_TOPIC_IDS,
	EXPECTED_QDRANT_COMMIT,
	EXPECTED_QDRANT_VERSION,
	EXPECTED_RUNTIME_MONITOR_SOURCE_SHA256,
	EXPECTED_TREC_EVAL_BINARY_SHA256,
	EXPECTED_TRUE_BATCH_EVALUATION_SOURCE_SHA256,
	MIRACL_EMBEDDING_POLICY,
	MIRACL_FULL_BENCHMARK,
	MIRACL_PASSAGE_COMPOSITION,
	createFullCorpusEvidenceReceipt,
	parseTrecEvalAll,
	sha256Bytes,
} from "./native-full-corpus-evidence.js";
import { fullCorpusEmbeddingExecutionPolicy } from "./native-full-corpus-policy.js";
import { MIRACL_KO_LOCK } from "./public-miracl-source.js";

const baselinePolicy = fullCorpusEmbeddingExecutionPolicy(
	MIRACL_EMBEDDING_POLICY,
	MIRACL_PASSAGE_COMPOSITION,
	"per-item-v1",
);
const trecRunText = `${[...EXPECTED_MIRACL_TOPIC_IDS]
	.map((queryId) =>
		Array.from(
			{ length: 100 },
			(_, rank) =>
				`${queryId} Q0 d${queryId}-${rank + 1} ${rank + 1} ${100 - rank} test`,
		).join("\n"),
	)
	.join("\n")}\n`;
const trecSha256 = sha256Bytes(trecRunText);

const result = {
	benchmark: MIRACL_FULL_BENCHMARK,
	inputs: {
		sourceLockSha256: EXPECTED_MIRACL_SOURCE_LOCK_SHA256,
		topicsSha256: EXPECTED_MIRACL_TOPICS_SHA256,
		qrelsSha256: EXPECTED_MIRACL_QRELS_SHA256,
		documentCount: 1_486_752,
		queryCount: 213,
		corpusDocidsSha256: "corpus-docids",
	},
	configuration: {
		passageComposition: MIRACL_PASSAGE_COMPOSITION,
		embedding: MIRACL_EMBEDDING_POLICY,
		embeddingInferenceMode: "per-item-v1" as const,
		embeddingExecutionPolicySha256: baselinePolicy.embeddingPolicySha256,
		vectorStore: "Qdrant",
		distance: "Cosine",
		exactSearch: true,
		topK: 100,
		cpuOnly: true,
		collectionName: `naia_miracl_ko_${EXPECTED_MIRACL_SOURCE_LOCK_SHA256.slice(0, 8)}_${baselinePolicy.embeddingPolicySha256.slice(0, 8)}`,
	},
	metrics: { ndcgAt10: 0.4123454, recallAt100: 0.7654321 },
	ingestion: { lastChunkReceiptSha256: "last-receipt" },
	trecSha256,
};

function evidence(overrides = {}) {
	const {
		result: resultOverride = result,
		launchReceipt: launchReceiptOverride,
		runtimeObservation: runtimeObservationOverride,
		...remainingOverrides
	} = overrides as {
		result?: typeof result;
		launchReceipt?: Record<string, unknown>;
		runtimeObservation?: Record<string, unknown>;
		[key: string]: unknown;
	};
	const resultText = JSON.stringify(resultOverride);
	const launchReceipt = launchReceiptOverride ?? {
		pid: 123,
		capturedAt: "2026-08-22T00:00:00.000Z",
		procStartTicks: "12345",
		bootId: "boot-a",
		cmdline: ["node", "native-full-corpus-evaluation-cli.ts"],
		cudaVisibleDevices: "",
		qdrantUrl: "http://127.0.0.1:6334",
		outputPath: "/outputs/result.json",
		evaluationSourceSha256: EXPECTED_EVALUATION_SOURCE_SHA256,
	};
	const launchReceiptPath = "/outputs/launch.json";
	const launchReceiptText = JSON.stringify(launchReceipt);
	const runtimeObservation = runtimeObservationOverride ?? {
		schemaVersion: 1,
		monitor: {
			source:
				"/repo/src/benchmark/quality/native-full-corpus-runtime-monitor-cli.ts",
			sourceSha256: EXPECTED_RUNTIME_MONITOR_SOURCE_SHA256,
		},
		launchReceipt: {
			path: launchReceiptPath,
			sha256: sha256Bytes(launchReceiptText),
		},
		process: {
			pid: 123,
			bootId: "boot-a",
			procStartTicks: "12345",
			cmdlineSha256: sha256Bytes(
				["node", "native-full-corpus-evaluation-cli.ts"].join("\0"),
			),
		},
		observation: {
			startedAt: "2026-08-22T00:05:00.000Z",
			completedAt: "2026-08-22T00:10:00.000Z",
			pollMilliseconds: 5_000,
			samples: 2,
			peakRssBytes: 4096,
		},
		result: { path: "/outputs/result.json", sha256: sha256Bytes(resultText) },
	};
	return {
		resultText,
		resultSha256: sha256Bytes(resultText),
		trecSha256,
		trecRunText,
		topicsSha256: EXPECTED_MIRACL_TOPICS_SHA256,
		qrelsSha256: EXPECTED_MIRACL_QRELS_SHA256,
		trecEvalStdout: "ndcg_cut_10 all 0.412345\nrecall_100 all 0.765432\n",
		trecEvalBinarySha256: EXPECTED_TREC_EVAL_BINARY_SHA256,
		trecEvalSourceCommit: "ba38899cbd4de0fb699b47f39b64ef1c107e4a5c",
		trecEvalPath: "/tools/trec_eval",
		evaluationStability: {
			trecBeforeSha256: trecSha256,
			trecAfterSha256: trecSha256,
			qrelsBeforeSha256: EXPECTED_MIRACL_QRELS_SHA256,
			qrelsAfterSha256: EXPECTED_MIRACL_QRELS_SHA256,
			binaryBeforeSha256: EXPECTED_TREC_EVAL_BINARY_SHA256,
			binaryAfterSha256: EXPECTED_TREC_EVAL_BINARY_SHA256,
			sourceCommitBefore: "ba38899cbd4de0fb699b47f39b64ef1c107e4a5c",
			sourceCommitAfter: "ba38899cbd4de0fb699b47f39b64ef1c107e4a5c",
		},
		topicsPath: "/inputs/miracl-v1.0-ko/topics/topics.miracl-v1.0-ko-dev.tsv",
		qrelsPath: "/inputs/miracl-v1.0-ko/qrels/qrels.miracl-v1.0-ko-dev.tsv",
		trecPath: "/outputs/result.json.trec",
		checkpointChain: {
			directory: "/checkpoints/vectors",
			chunkCount: 2_904,
			documentCount: 1_486_752,
			docidsSha256: "corpus-docids",
			lastChunkReceiptSha256: "last-receipt",
		},
		launchReceiptPath,
		launchReceiptText,
		runtimeObservationPath: "/outputs/runtime.json",
		runtimeObservationText: JSON.stringify(runtimeObservation),
		qdrant: {
			version: EXPECTED_QDRANT_VERSION,
			commit: EXPECTED_QDRANT_COMMIT,
			pointsCount: 1_486_752,
			status: "green",
			vectorSize: 1024,
			distance: "Cosine",
			hnswM: 0,
			indexingThreshold: 0,
		},
		...remainingOverrides,
	};
}

function parsedLaunchReceipt() {
	return JSON.parse(evidence().launchReceiptText);
}

function parsedRuntimeObservation() {
	return JSON.parse(evidence().runtimeObservationText);
}

describe("full-corpus independent evidence", () => {
	it("parses only aggregate trec_eval rows", () => {
		expect(parseTrecEvalAll("ndcg_cut_10 all 0.5\n").get("ndcg_cut_10")).toBe(
			0.5,
		);
		expect(() => parseTrecEvalAll("ndcg_cut_10 1 0.5\n")).toThrow("invalid");
	});

	it("binds independent metrics, artifacts, runtime, and latency semantics", () => {
		const receipt = createFullCorpusEvidenceReceipt(evidence());
		expect(receipt.schemaVersion).toBe(3);
		expect(receipt.verdict).toBe("LOCAL_PASS");
		expect(receipt).toMatchObject({
			assurance: "self-observed-local",
			publicClaimEligible: false,
			publicClaimRequirement:
				"independent signed execution attestation from a runner outside the benchmark operator trust boundary",
		});
		expect(sha256Bytes(`${JSON.stringify(MIRACL_KO_LOCK, null, 2)}\n`)).toBe(
			EXPECTED_MIRACL_SOURCE_LOCK_SHA256,
		);
		expect(receipt).toHaveProperty("independentEvaluatorTool");
		expect(receipt.independentEvaluatorTool.executionStability).toEqual(
			evidence().evaluationStability,
		);
		expect(receipt.artifacts.topics).toEqual({
			path: "/inputs/miracl-v1.0-ko/topics/topics.miracl-v1.0-ko-dev.tsv",
			sha256: EXPECTED_MIRACL_TOPICS_SHA256,
		});
		expect(receipt.artifacts.qrels).toEqual({
			path: "/inputs/miracl-v1.0-ko/qrels/qrels.miracl-v1.0-ko-dev.tsv",
			sha256: EXPECTED_MIRACL_QRELS_SHA256,
		});
		expect(receipt.artifacts.launchReceipt).toEqual({
			path: evidence().launchReceiptPath,
			sha256: sha256Bytes(evidence().launchReceiptText),
		});
		expect(receipt.artifacts.runtimeObservation).toEqual({
			path: evidence().runtimeObservationPath,
			sha256: sha256Bytes(evidence().runtimeObservationText),
		});
		expect(receipt).not.toHaveProperty("independentEvaluator");
		expect(receipt.metrics).toHaveProperty("reproducedByIndependentTool");
		expect(receipt.metrics).not.toHaveProperty("independent");
		expect(receipt.metrics.deltas.ndcgAt10).toBeLessThanOrEqual(1e-6);
		expect(receipt.runtime.latencySemantics).toContain("query-embedding");
		expect(receipt.runtime.attachmentDelayMilliseconds).toBe(300_000);
		expect(receipt.runtime.observationBoundary).toContain("after-launch");
	});

	it("binds the true-batch result to its candidate source and collection", () => {
		const policy = fullCorpusEmbeddingExecutionPolicy(
			MIRACL_EMBEDDING_POLICY,
			MIRACL_PASSAGE_COMPOSITION,
			"padded-array-batch-v1",
		);
		const candidateResult = {
			...result,
			configuration: {
				...result.configuration,
				passageComposition: MIRACL_PASSAGE_COMPOSITION,
				embedding: MIRACL_EMBEDDING_POLICY,
				embeddingInferenceMode: "padded-array-batch-v1" as const,
				embeddingExecutionPolicySha256: policy.embeddingPolicySha256,
				collectionName: `naia_miracl_ko_${EXPECTED_MIRACL_SOURCE_LOCK_SHA256.slice(0, 8)}_${policy.embeddingPolicySha256.slice(0, 8)}`,
			},
		};
		const launchReceipt = {
			...parsedLaunchReceipt(),
			evaluationSourceSha256: EXPECTED_TRUE_BATCH_EVALUATION_SOURCE_SHA256,
			embeddingInferenceMode: "padded-array-batch-v1" as const,
		};
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({ result: candidateResult, launchReceipt }),
			),
		).not.toThrow();
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					result: candidateResult,
					launchReceipt: {
						...launchReceipt,
						evaluationSourceSha256: EXPECTED_EVALUATION_SOURCE_SHA256,
					},
				}),
			),
		).toThrow("launch evidence");
	});

	it("rejects omitted or substituted embedding identity for the baseline", () => {
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					result: {
						...result,
						configuration: { ...result.configuration, embedding: undefined },
					},
				}),
			),
		).toThrow("embedding identity");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					result: {
						...result,
						configuration: {
							...result.configuration,
							embedding: { ...MIRACL_EMBEDDING_POLICY, revision: "changed" },
						},
					},
				}),
			),
		).toThrow("embedding identity");
	});

	it("rejects a result hash that does not bind the parsed result content", () => {
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({ resultSha256: "forged-result-hash" }),
			),
		).toThrow("result content hash");
	});

	it("rejects launch artifact substitution against the observed raw hash", () => {
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					launchReceipt: {
						...parsedLaunchReceipt(),
						capturedAt: "2026-08-22T00:00:01.000Z",
					},
					runtimeObservation: parsedRuntimeObservation(),
				}),
			),
		).toThrow("runtime observation");
	});

	it("rejects a runtime observation that names a different launch artifact", () => {
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					runtimeObservation: {
						...parsedRuntimeObservation(),
						launchReceipt: {
							...parsedRuntimeObservation().launchReceipt,
							path: "/outputs/substituted-launch.json",
						},
					},
				}),
			),
		).toThrow("runtime observation");
	});

	it("rejects incomplete TREC query coverage even when its hash is consistent", () => {
		const incompleteTrec = trecRunText
			.split("\n")
			.filter((line) => !line.startsWith("1582 "))
			.join("\n");
		const incompleteSha256 = sha256Bytes(incompleteTrec);
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					trecRunText: incompleteTrec,
					trecSha256: incompleteSha256,
					result: {
						...result,
						trecSha256: incompleteSha256,
					},
				}),
			),
		).toThrow("TREC query cardinality");
	});

	it("rejects substituted query IDs even when count and depth are unchanged", () => {
		const substitutedTrec = trecRunText.replaceAll(/^1582 /gm, "999999 ");
		const substitutedSha256 = sha256Bytes(substitutedTrec);
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					trecRunText: substitutedTrec,
					trecSha256: substitutedSha256,
					result: { ...result, trecSha256: substitutedSha256 },
				}),
			),
		).toThrow("TREC coverage mismatch");
	});

	it("rejects a substituted or incomplete checkpoint chain", () => {
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					checkpointChain: {
						...evidence().checkpointChain,
						lastChunkReceiptSha256: "substituted",
					},
				}),
			),
		).toThrow("checkpoint chain");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					checkpointChain: {
						...evidence().checkpointChain,
						chunkCount: 2_903,
					},
				}),
			),
		).toThrow("checkpoint chain");
	});

	it("fails closed on metric, artifact, policy, and runtime drift", () => {
		expect(() =>
			createFullCorpusEvidenceReceipt(evidence({ topicsSha256: "changed" })),
		).toThrow("canonical topics hash");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					topicsSha256: "changed",
					result: {
						...result,
						inputs: { ...result.inputs, topicsSha256: "changed" },
					},
				}),
			),
		).toThrow("canonical topics hash");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({ topicsPath: "/inputs/substituted-topics.tsv" }),
			),
		).toThrow("canonical topics hash");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					result: {
						...result,
						inputs: { ...result.inputs, sourceLockSha256: "changed" },
					},
				}),
			),
		).toThrow("source lock");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					qrelsSha256: "changed",
					result: {
						...result,
						inputs: { ...result.inputs, qrelsSha256: "changed" },
					},
				}),
			),
		).toThrow("canonical qrels provenance");
		expect(() =>
			createFullCorpusEvidenceReceipt(evidence({ trecSha256: "changed" })),
		).toThrow("TREC hash");
		expect(() =>
			createFullCorpusEvidenceReceipt(evidence({ qrelsSha256: "changed" })),
		).toThrow("qrels hash");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({ qrelsPath: "/inputs/substituted-qrels.tsv" }),
			),
		).toThrow("canonical qrels provenance");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({ trecEvalBinarySha256: "changed" }),
			),
		).toThrow("binary hash");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					evaluationStability: {
						...evidence().evaluationStability,
						trecAfterSha256: "changed",
					},
				}),
			),
		).toThrow("execution stability");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					trecEvalStdout: "ndcg_cut_10 all 0.4\nrecall_100 all 0.7\n",
				}),
			),
		).toThrow("metric reproduction");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({ qdrant: { ...evidence().qdrant, commit: "changed" } }),
			),
		).toThrow("Qdrant runtime");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					result: {
						...result,
						configuration: { ...result.configuration, cpuOnly: false },
					},
				}),
			),
		).toThrow("execution policy");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					launchReceipt: {
						...parsedLaunchReceipt(),
						cudaVisibleDevices: "1",
					},
				}),
			),
		).toThrow("launch evidence");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					runtimeObservation: {
						...parsedRuntimeObservation(),
						result: { path: "/outputs/result.json", sha256: "changed" },
					},
				}),
			),
		).toThrow("runtime observation");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					runtimeObservation: {
						...parsedRuntimeObservation(),
						observation: {
							...parsedRuntimeObservation().observation,
							samples: 1.5,
						},
					},
				}),
			),
		).toThrow("runtime observation");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					runtimeObservation: {
						...parsedRuntimeObservation(),
						observation: {
							...parsedRuntimeObservation().observation,
							startedAt: "2026-08-21T23:59:59.000Z",
						},
					},
				}),
			),
		).toThrow("runtime observation");
	});
});
