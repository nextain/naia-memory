import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runMiraclGlobalComparisonCli } from "./miracl-global-comparison-cli.js";
import {
	MIRACL_KO_HISTORICAL_ROWS,
	createMiraclGlobalComparison,
} from "./miracl-global-comparison.js";
import {
	EXPECTED_TREC_EVAL_BINARY_SHA256,
	METRIC_TOLERANCE,
	TREC_EVAL_COMMIT,
	TREC_EVAL_VERSION,
	sha256Bytes,
} from "./native-full-corpus-evidence.js";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";

function receipt(ndcgAt10 = 0.61, recallAt100 = 0.901) {
	const stdout = `ndcg_cut_10 all ${ndcgAt10}\nrecall_100 all ${recallAt100}\n`;
	const manifests = {
		dataset: { identity: "fixture" },
		protocol: { topK: 100 },
		implementation: { source: "fixture" },
		configuration: { exactSearch: true },
		executionEvidence: { resultSha256: "fixture" },
	};
	return JSON.stringify({
		schemaVersion: 3,
		verdict: "LOCAL_PASS",
		publicClaimEligible: false,
		benchmark: "miracl-ko-full-corpus-naia-vector-exact-v1",
		attestationBinding: {
			manifests,
			hashes: {
				datasetSha256: evidenceObjectSha256(manifests.dataset),
				protocolSha256: evidenceObjectSha256(manifests.protocol),
				implementationArtifactSha256: evidenceObjectSha256(
					manifests.implementation,
				),
				configurationSha256: evidenceObjectSha256(manifests.configuration),
				executionEvidenceSha256: evidenceObjectSha256(
					manifests.executionEvidence,
				),
			},
		},
		independentEvaluatorTool: {
			name: "usnistgov/trec_eval",
			version: TREC_EVAL_VERSION,
			commit: TREC_EVAL_COMMIT,
			binarySha256: EXPECTED_TREC_EVAL_BINARY_SHA256,
			stdout,
			stdoutSha256: sha256Bytes(stdout),
		},
		metrics: {
			inProcess: { ndcgAt10, recallAt100 },
			reproducedByIndependentTool: { ndcgAt10, recallAt100 },
			deltas: { ndcgAt10: 0, recallAt100: 0 },
			tolerance: METRIC_TOLERANCE,
		},
	});
}

describe("MIRACL global comparison", () => {
	it("compares every frozen row using only independently reproduced metrics", () => {
		const comparison = createMiraclGlobalComparison(receipt());
		expect(comparison.rows).toHaveLength(MIRACL_KO_HISTORICAL_ROWS.length);
		expect(comparison.hybridTier).toBe("WITHIN_HISTORICAL_ROW_RESOLUTION");
		expect(comparison.rows[2]?.deltas.ndcgAt10).toBeCloseTo(0.001, 12);
		expect(comparison.rows[2]?.deltas.recallAt100).toBeCloseTo(0.001, 12);
		expect(comparison.publicClaimEligible).toBe(false);
		expect(comparison.notEstablished).toContain("memory-engine superiority");
	});

	it("represents mixed and both-below outcomes without cherry-picking", () => {
		expect(createMiraclGlobalComparison(receipt(0.609, 0.9)).hybridTier).toBe(
			"WITHIN_HISTORICAL_ROW_RESOLUTION",
		);
		expect(createMiraclGlobalComparison(receipt(0.61, 0.89)).hybridTier).toBe(
			"MIXED",
		);
		expect(createMiraclGlobalComparison(receipt(0.6, 0.91)).hybridTier).toBe(
			"MIXED",
		);
		expect(createMiraclGlobalComparison(receipt(0.6, 0.89)).hybridTier).toBe(
			"BELOW_BOTH",
		);
	});

	it.each([
		["schemaVersion", 2, "schema"],
		["verdict", "FAIL", "LOCAL_PASS"],
		["publicClaimEligible", true, "public-claim"],
		["benchmark", "other", "benchmark"],
	])("rejects substituted %s", (key, value, message) => {
		const valueReceipt = JSON.parse(receipt());
		valueReceipt[key] = value;
		expect(() =>
			createMiraclGlobalComparison(JSON.stringify(valueReceipt)),
		).toThrow(message);
	});

	it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
		"rejects non-finite independent metrics: %s",
		(value) => {
			expect(() => createMiraclGlobalComparison(receipt(value, 0.9))).toThrow(
				"invalid trec_eval value",
			);
			expect(() => createMiraclGlobalComparison(receipt(0.609, value))).toThrow(
				"invalid trec_eval value",
			);
		},
	);

	it.each([-0.001, 1.001])("rejects out-of-range metrics: %s", (value) => {
		expect(() => createMiraclGlobalComparison(receipt(value, 0.9))).toThrow(
			"between 0 and 1",
		);
		expect(() => createMiraclGlobalComparison(receipt(0.609, value))).toThrow(
			"between 0 and 1",
		);
	});

	it("rejects hand-edited independent metrics and broken provenance", () => {
		const editedMetric = JSON.parse(receipt());
		editedMetric.metrics.reproducedByIndependentTool.ndcgAt10 = 0.95;
		expect(() =>
			createMiraclGlobalComparison(JSON.stringify(editedMetric)),
		).toThrow("metric mismatch");

		const editedBinding = JSON.parse(receipt());
		editedBinding.attestationBinding.manifests.dataset.identity = "edited";
		expect(() =>
			createMiraclGlobalComparison(JSON.stringify(editedBinding)),
		).toThrow("attestation binding mismatch");

		const substitutedTool = JSON.parse(receipt());
		substitutedTool.independentEvaluatorTool.binarySha256 = "0".repeat(64);
		expect(() =>
			createMiraclGlobalComparison(JSON.stringify(substitutedTool)),
		).toThrow("evaluator identity mismatch");
	});

	it("never overwrites an existing comparison artifact", async () => {
		const directory = mkdtempSync(join(tmpdir(), "miracl-comparison-"));
		try {
			const input = join(directory, "receipt.json");
			const output = join(directory, "comparison.json");
			writeFileSync(input, receipt());
			await expect(runMiraclGlobalComparisonCli([input, output])).resolves.toBe(
				0,
			);
			await expect(
				runMiraclGlobalComparisonCli([input, output]),
			).rejects.toMatchObject({ code: "EEXIST" });
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
