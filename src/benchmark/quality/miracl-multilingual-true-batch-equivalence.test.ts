import { describe, expect, it } from "vitest";
import {
	MULTILINGUAL_TRUE_BATCH_EQUIVALENCE_TEXTS,
	type MultilingualEquivalenceObservation,
	type MultilingualTrueBatchLanguage,
	analyzeMultilingualTrueBatchEquivalence,
	multilingualEquivalenceInputSha256,
} from "./miracl-multilingual-true-batch-equivalence.js";

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
				"a".repeat(64),
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
				"a".repeat(64),
				observation("en", "per-item-v1"),
				observation("ar", "padded-array-batch-v1"),
			),
		).toThrow("ar/per-item-v1: observation identity mismatch");
	});

	it("fails when the candidate vectors exceed the frozen tolerance", () => {
		const evidence = analyzeMultilingualTrueBatchEquivalence(
			"en",
			"a".repeat(64),
			observation("en", "per-item-v1"),
			observation("en", "padded-array-batch-v1", 1e-2),
		);
		expect(evidence.verdict).toBe("FAIL");
	});

	it("rejects observations not bound to the preregistered policy", () => {
		expect(() =>
			analyzeMultilingualTrueBatchEquivalence(
				"en",
				"b".repeat(64),
				observation("en", "per-item-v1"),
				observation("en", "padded-array-batch-v1"),
			),
		).toThrow("embedding policies differ");
	});

	it("rejects an invalid preregistered policy hash", () => {
		expect(() =>
			analyzeMultilingualTrueBatchEquivalence(
				"en",
				"not-a-sha256",
				observation("en", "per-item-v1"),
				observation("en", "padded-array-batch-v1"),
			),
		).toThrow("expected embedding policy hash is invalid");
	});

	it("rejects an observation with a mismatched frozen-input hash", () => {
		const baseline = observation("ar", "per-item-v1");
		baseline.inputSha256 = "b".repeat(64);
		expect(() =>
			analyzeMultilingualTrueBatchEquivalence(
				"ar",
				"a".repeat(64),
				baseline,
				observation("ar", "padded-array-batch-v1"),
			),
		).toThrow("ar/per-item-v1: input hash mismatch");
	});

	it("rejects differing baseline and candidate embedding dimensions", () => {
		const candidate = observation("en", "padded-array-batch-v1");
		candidate.vectors = candidate.vectors.map(() => [1, 0, 0]);
		expect(() =>
			analyzeMultilingualTrueBatchEquivalence(
				"en",
				"a".repeat(64),
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
				"a".repeat(64),
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
				"a".repeat(64),
				baseline,
				observation("en", "padded-array-batch-v1"),
			),
		).toThrow("vector 0: cosine is invalid");
	});
});
