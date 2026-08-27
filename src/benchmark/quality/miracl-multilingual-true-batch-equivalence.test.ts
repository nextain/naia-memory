import { describe, expect, it } from "vitest";
import {
	MULTILINGUAL_TRUE_BATCH_EQUIVALENCE_TEXTS,
	MULTILINGUAL_TRUE_BATCH_MODEL,
	MULTILINGUAL_TRUE_BATCH_MODEL_REVISION,
	type MultilingualEquivalenceExpectedIdentity,
	type MultilingualEquivalenceObservation,
	type MultilingualTrueBatchLanguage,
	analyzeMultilingualTrueBatchEquivalence,
	multilingualEquivalenceInputSha256,
} from "./miracl-multilingual-true-batch-equivalence.js";

function expected(): MultilingualEquivalenceExpectedIdentity {
	return {
		model: MULTILINGUAL_TRUE_BATCH_MODEL,
		modelRevision: MULTILINGUAL_TRUE_BATCH_MODEL_REVISION,
		policySha256: "a".repeat(64),
		producerSourceSha256: "c".repeat(64),
	};
}

function observation(
	language: MultilingualTrueBatchLanguage,
	mode: MultilingualEquivalenceObservation["mode"],
	delta = 0,
): MultilingualEquivalenceObservation {
	return {
		schemaVersion: 1,
		language,
		mode,
		inputSha256: multilingualEquivalenceInputSha256(language),
		policySha256: "a".repeat(64),
		policyBasisMode: "per-item-v1",
		model: MULTILINGUAL_TRUE_BATCH_MODEL,
		modelRevision: MULTILINGUAL_TRUE_BATCH_MODEL_REVISION,
		producerSourceSha256: "c".repeat(64),
		vectors: MULTILINGUAL_TRUE_BATCH_EQUIVALENCE_TEXTS[language].map(() => [
			1,
			delta,
		]),
	};
}

describe("multilingual true-batch equivalence", () => {
	it.each(["ar", "en"] as const)(
		"accepts equivalent %s vectors with a language-bound benchmark",
		(language) => {
			const evidence = analyzeMultilingualTrueBatchEquivalence(
				language,
				expected(),
				observation(language, "per-item-v1"),
				observation(language, "padded-array-batch-v1", 1e-7),
			);
			expect(evidence.verdict).toBe("PASS");
			expect(evidence.language).toBe(language);
			expect(evidence.benchmark).toContain(`naia-${language}-`);
			expect(evidence.artifactClass).toBe("preflight-probe-evidence");
			expect(evidence.claimBoundary).toContain(
				"neither MIRACL retrieval quality nor throughput",
			);
		},
	);

	it("rejects cross-language observation substitution", () => {
		expect(() =>
			analyzeMultilingualTrueBatchEquivalence(
				"ar",
				expected(),
				observation("en", "per-item-v1"),
				observation("ar", "padded-array-batch-v1"),
			),
		).toThrow("ar/per-item-v1: observation identity mismatch");
	});

	it("fails when the candidate vectors exceed the frozen tolerance", () => {
		const evidence = analyzeMultilingualTrueBatchEquivalence(
			"en",
			expected(),
			observation("en", "per-item-v1"),
			observation("en", "padded-array-batch-v1", 1e-2),
		);
		expect(evidence.verdict).toBe("FAIL");
	});

	it("rejects observations not bound to the preregistered policy", () => {
		expect(() =>
			analyzeMultilingualTrueBatchEquivalence(
				"en",
				{ ...expected(), policySha256: "b".repeat(64) },
				observation("en", "per-item-v1"),
				observation("en", "padded-array-batch-v1"),
			),
		).toThrow("embedding policies differ");
	});

	it("rejects an invalid preregistered policy hash", () => {
		expect(() =>
			analyzeMultilingualTrueBatchEquivalence(
				"en",
				{ ...expected(), policySha256: "not-a-sha256" },
				observation("en", "per-item-v1"),
				observation("en", "padded-array-batch-v1"),
			),
		).toThrow("expected provenance hash is invalid");
	});

	it("rejects an observation with a mismatched frozen-input hash", () => {
		const baseline = observation("ar", "per-item-v1");
		baseline.inputSha256 = "b".repeat(64);
		expect(() =>
			analyzeMultilingualTrueBatchEquivalence(
				"ar",
				expected(),
				baseline,
				observation("ar", "padded-array-batch-v1"),
			),
		).toThrow("ar/per-item-v1: input hash mismatch");
	});

	it("rejects a producer source identity supplied by its own observation", () => {
		const candidate = observation("ar", "padded-array-batch-v1");
		candidate.producerSourceSha256 = "d".repeat(64);
		expect(() =>
			analyzeMultilingualTrueBatchEquivalence(
				"ar",
				expected(),
				observation("ar", "per-item-v1"),
				candidate,
			),
		).toThrow("ar/padded-array-batch-v1: producer identity mismatch");
	});

	it("rejects an observation that changes the preregistered policy basis", () => {
		const candidate = observation("en", "padded-array-batch-v1");
		candidate.policyBasisMode = "candidate-mode" as "per-item-v1";
		expect(() =>
			analyzeMultilingualTrueBatchEquivalence(
				"en",
				expected(),
				observation("en", "per-item-v1"),
				candidate,
			),
		).toThrow("policy basis mode mismatch");
	});

	it("rejects differing baseline and candidate embedding dimensions", () => {
		const candidate = observation("en", "padded-array-batch-v1");
		candidate.vectors = candidate.vectors.map(() => [1, 0, 0]);
		expect(() =>
			analyzeMultilingualTrueBatchEquivalence(
				"en",
				expected(),
				observation("en", "per-item-v1"),
				candidate,
			),
		).toThrow("embedding dimensions differ");
	});

	it("rejects non-finite observation vectors before emitting evidence", () => {
		const candidate = observation("ar", "padded-array-batch-v1");
		candidate.vectors[0] = [1, Number.POSITIVE_INFINITY];
		expect(() =>
			analyzeMultilingualTrueBatchEquivalence(
				"ar",
				expected(),
				observation("ar", "per-item-v1"),
				candidate,
			),
		).toThrow("ar/padded-array-batch-v1: vectors are invalid");
	});

	it("rejects valid JSON with a malformed vectors shape", () => {
		const candidate = observation("ar", "padded-array-batch-v1");
		candidate.vectors = null as unknown as number[][];
		expect(() =>
			analyzeMultilingualTrueBatchEquivalence(
				"ar",
				expected(),
				observation("ar", "per-item-v1"),
				candidate,
			),
		).toThrow("ar/padded-array-batch-v1: vectors are invalid");
	});

	it("rejects zero-norm vectors before emitting evidence", () => {
		const baseline = observation("en", "per-item-v1");
		baseline.vectors[0] = [0, 0];
		expect(() =>
			analyzeMultilingualTrueBatchEquivalence(
				"en",
				expected(),
				baseline,
				observation("en", "padded-array-batch-v1"),
			),
		).toThrow("vector 0: cosine is invalid");
	});
});
