import { describe, expect, it } from "vitest";
import {
	EXPECTED_EVALUATION_SOURCE_SHA256,
	EXPECTED_QDRANT_COMMIT,
	EXPECTED_QDRANT_VERSION,
	EXPECTED_TREC_EVAL_BINARY_SHA256,
	MIRACL_FULL_BENCHMARK,
	createFullCorpusEvidenceReceipt,
	parseTrecEvalAll,
} from "./native-full-corpus-evidence.js";

const result = {
	benchmark: MIRACL_FULL_BENCHMARK,
	inputs: { qrelsSha256: "qrels", documentCount: 1_486_752, queryCount: 213 },
	configuration: {
		vectorStore: "Qdrant",
		distance: "Cosine",
		exactSearch: true,
		topK: 100,
		cpuOnly: true,
		collectionName: "locked-collection",
	},
	metrics: { ndcgAt10: 0.4123454, recallAt100: 0.7654321 },
	trecSha256: "trec",
};

function evidence(overrides = {}) {
	return {
		result,
		resultSha256: "result",
		trecSha256: "trec",
		qrelsSha256: "qrels",
		trecEvalStdout: "ndcg_cut_10 all 0.412345\nrecall_100 all 0.765432\n",
		trecEvalBinarySha256: EXPECTED_TREC_EVAL_BINARY_SHA256,
		trecEvalSourceCommit: "ba38899cbd4de0fb699b47f39b64ef1c107e4a5c",
		trecEvalPath: "/tools/trec_eval",
		qrelsPath: "/inputs/qrels.tsv",
		trecPath: "/outputs/result.json.trec",
		launchReceipt: {
			pid: 123,
			capturedAt: "2026-08-22T00:00:00.000Z",
			cmdline: ["node", "native-full-corpus-evaluation-cli.ts"],
			cudaVisibleDevices: "",
			qdrantUrl: "http://127.0.0.1:6334",
			outputPath: "/outputs/result.json",
			evaluationSourceSha256: EXPECTED_EVALUATION_SOURCE_SHA256,
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
		expect(receipt.verdict).toBe("PASS");
		expect(receipt.metrics.deltas.ndcgAt10).toBeLessThanOrEqual(1e-6);
		expect(receipt.runtime.latencySemantics).toContain("query-embedding");
	});

	it("fails closed on metric, artifact, policy, and runtime drift", () => {
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
	});
});
