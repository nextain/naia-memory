import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type EquivalenceObservation,
	TRUE_BATCH_EQUIVALENCE_TEXTS,
	analyzeTrueBatchEquivalence,
	equivalenceInputSha256,
	verifyTrueBatchEquivalenceEvidenceFiles,
} from "./true-batch-equivalence.js";

function observation(
	mode: EquivalenceObservation["mode"],
	delta = 0,
): EquivalenceObservation {
	return {
		schemaVersion: 1,
		mode,
		inputSha256: equivalenceInputSha256(),
		policySha256: "a".repeat(64),
		vectors: TRUE_BATCH_EQUIVALENCE_TEXTS.map((_, index) => [
			1,
			index / 100 + delta,
			0,
		]),
	};
}

describe("true batch vector equivalence", () => {
	it("passes numerically equivalent observations", () => {
		expect(
			analyzeTrueBatchEquivalence(
				observation("per-item-v1"),
				observation("padded-array-batch-v1", 1e-7),
			).verdict,
		).toBe("PASS");
	});

	it("fails a materially changed vector", () => {
		expect(
			analyzeTrueBatchEquivalence(
				observation("per-item-v1"),
				observation("padded-array-batch-v1", 1e-2),
			).verdict,
		).toBe("FAIL");
	});

	it("rejects policy substitution", () => {
		const candidate = observation("padded-array-batch-v1");
		candidate.policySha256 = "b".repeat(64);
		expect(() =>
			analyzeTrueBatchEquivalence(observation("per-item-v1"), candidate),
		).toThrow("policies differ");
	});

	it("recomputes canonical evidence from both observations", () => {
		const directory = mkdtempSync(join(tmpdir(), "naia-equivalence-"));
		const baseline = observation("per-item-v1");
		const candidate = observation("padded-array-batch-v1", 1e-7);
		const paths = {
			MIRACL_EQUIVALENCE_BASELINE: join(directory, "baseline.json"),
			MIRACL_EQUIVALENCE_CANDIDATE: join(directory, "candidate.json"),
			MIRACL_TRUE_BATCH_EQUIVALENCE_EVIDENCE: join(directory, "evidence.json"),
		};
		writeFileSync(
			paths.MIRACL_EQUIVALENCE_BASELINE,
			`${JSON.stringify(baseline)}\n`,
		);
		writeFileSync(
			paths.MIRACL_EQUIVALENCE_CANDIDATE,
			`${JSON.stringify(candidate)}\n`,
		);
		writeFileSync(
			paths.MIRACL_TRUE_BATCH_EQUIVALENCE_EVIDENCE,
			`${JSON.stringify(analyzeTrueBatchEquivalence(baseline, candidate), null, 2)}\n`,
		);
		expect(() => verifyTrueBatchEquivalenceEvidenceFiles(paths)).not.toThrow();
		writeFileSync(
			paths.MIRACL_TRUE_BATCH_EQUIVALENCE_EVIDENCE,
			'{"verdict":"PASS"}\n',
		);
		expect(() => verifyTrueBatchEquivalenceEvidenceFiles(paths)).toThrow(
			"mismatch",
		);
	});
});
