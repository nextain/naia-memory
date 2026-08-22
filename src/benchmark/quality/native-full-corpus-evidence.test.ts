import { describe, expect, it } from "vitest";
import {
	EXPECTED_EVALUATION_SOURCE_SHA256,
	EXPECTED_MIRACL_QRELS_SHA256,
	EXPECTED_MIRACL_SOURCE_LOCK_SHA256,
	EXPECTED_MIRACL_TOPICS_SHA256,
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
const trecRunText = `${Array.from({ length: 213 }, (_, queryIndex) =>
	Array.from(
		{ length: 100 },
		(_, rank) =>
			`q${queryIndex + 1} Q0 d${queryIndex + 1}-${rank + 1} ${rank + 1} ${100 - rank} test`,
	).join("\n"),
).join("\n")}\n`;
const trecSha256 = sha256Bytes(trecRunText);

const result = {
	benchmark: MIRACL_FULL_BENCHMARK,
	inputs: {
		sourceLockSha256: EXPECTED_MIRACL_SOURCE_LOCK_SHA256,
		topicsSha256: EXPECTED_MIRACL_TOPICS_SHA256,
		qrelsSha256: EXPECTED_MIRACL_QRELS_SHA256,
		documentCount: 1_486_752,
		queryCount: 213,
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
	trecSha256,
};

function evidence(overrides = {}) {
	return {
		result,
		resultSha256: "result",
		trecSha256,
		trecRunText,
		qrelsSha256: EXPECTED_MIRACL_QRELS_SHA256,
		trecEvalStdout: "ndcg_cut_10 all 0.412345\nrecall_100 all 0.765432\n",
		trecEvalBinarySha256: EXPECTED_TREC_EVAL_BINARY_SHA256,
		trecEvalSourceCommit: "ba38899cbd4de0fb699b47f39b64ef1c107e4a5c",
		trecEvalPath: "/tools/trec_eval",
		qrelsPath: "/inputs/qrels.tsv",
		trecPath: "/outputs/result.json.trec",
		launchReceipt: {
			pid: 123,
			capturedAt: "2026-08-22T00:00:00.000Z",
			procStartTicks: "12345",
			bootId: "boot-a",
			cmdline: ["node", "native-full-corpus-evaluation-cli.ts"],
			cudaVisibleDevices: "",
			qdrantUrl: "http://127.0.0.1:6334",
			outputPath: "/outputs/result.json",
			evaluationSourceSha256: EXPECTED_EVALUATION_SOURCE_SHA256,
		},
		launchReceiptSha256: "launch-hash",
		runtimeObservation: {
			schemaVersion: 1,
			monitor: {
				source:
					"/repo/src/benchmark/quality/native-full-corpus-runtime-monitor-cli.ts",
				sourceSha256: EXPECTED_RUNTIME_MONITOR_SOURCE_SHA256,
			},
			launchReceipt: { path: "/outputs/launch.json", sha256: "launch-hash" },
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
			result: { path: "/outputs/result.json", sha256: "result" },
		},
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
		...overrides,
	};
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
		expect(receipt.schemaVersion).toBe(2);
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
			...evidence().launchReceipt,
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

	it("rejects incomplete TREC query coverage even when its hash is consistent", () => {
		const incompleteTrec = trecRunText
			.split("\n")
			.filter((line) => !line.startsWith("q213 "))
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

	it("fails closed on metric, artifact, policy, and runtime drift", () => {
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
		).toThrow("canonical qrels hash");
		expect(() =>
			createFullCorpusEvidenceReceipt(evidence({ trecSha256: "changed" })),
		).toThrow("TREC hash");
		expect(() =>
			createFullCorpusEvidenceReceipt(evidence({ qrelsSha256: "changed" })),
		).toThrow("qrels hash");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({ trecEvalBinarySha256: "changed" }),
			),
		).toThrow("binary hash");
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
						...evidence().launchReceipt,
						cudaVisibleDevices: "1",
					},
				}),
			),
		).toThrow("launch evidence");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					runtimeObservation: {
						...evidence().runtimeObservation,
						result: { path: "/outputs/result.json", sha256: "changed" },
					},
				}),
			),
		).toThrow("runtime observation");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					runtimeObservation: {
						...evidence().runtimeObservation,
						observation: {
							...evidence().runtimeObservation.observation,
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
						...evidence().runtimeObservation,
						observation: {
							...evidence().runtimeObservation.observation,
							startedAt: "2026-08-21T23:59:59.000Z",
						},
					},
				}),
			),
		).toThrow("runtime observation");
	});
});
