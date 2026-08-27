import { describe, expect, it } from "vitest";
import {
	MIRACL_BASELINE_SOURCE,
	MIRACL_HISTORICAL_ROWS,
	createMiraclLanguageComparison,
} from "./miracl-language-comparison.js";
import {
	EXPECTED_TREC_EVAL_BINARY_SHA256,
	TREC_EVAL_COMMIT,
	TREC_EVAL_VERSION,
	sha256Bytes,
} from "./native-full-corpus-evidence.js";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";

function evidence(
	language: "ko" | "en" | "ar",
	ndcgAt10: number,
	recallAt100: number,
) {
	const identities = {
		ko: {
			role: "anchor",
			documentCount: 1_486_752,
			queryCount: 213,
			sourceLockSha256:
				"742952715d6e31eaf9718f04c2bad0509c9d7c754210aa81d793a14430fbb69c",
		},
		en: {
			role: "transfer",
			documentCount: 32_893_221,
			queryCount: 799,
			sourceLockSha256:
				"99727481b47a8a423ad8fa54ca09c8296515fba17ce9c9ce6356e53654918549",
		},
		ar: {
			role: "transfer",
			documentCount: 2_061_414,
			queryCount: 2_896,
			sourceLockSha256:
				"6f67a375d0bf8062fb6d591843052ab3555b1b5d69acdae164a83387dbaf71e1",
		},
	} as const;
	const stdout = `ndcg_cut_10 all ${ndcgAt10}\nrecall_100 all ${recallAt100}\n`;
	const resultSha256 = sha256Bytes(`result:${language}`);
	const trecSha256 = sha256Bytes(`trec:${language}`);
	const artifacts = {
		result: { path: `miracl-${language}.json`, sha256: resultSha256 },
		trec: { path: `miracl-${language}.trec`, sha256: trecSha256 },
		checkpointChain: {
			documentCount: identities[language].documentCount,
			docidsSha256:
				language === "ko"
					? "6024e30f6c7aed244a5451a9552163a86f74b4254775022f4d4829fcaa87e879"
					: language === "ar"
						? "b81389dd2afad4d0273ec92c25f446b478cb41afb8327c162f8919d93b3c3659"
						: "23a425f3889a6b6a3f41f32666cb748fca05ae2e750abad13ebbc0354ebb7847",
		},
	};
	return JSON.stringify({
		schemaVersion: "naia-memory-miracl-multilingual-completion-evidence-v1",
		verdict: "LOCAL_PASS",
		assurance: "self-observed-local",
		publicClaimEligible: false,
		publicClaimRequirement: "independent signed execution attestation",
		claimBoundary: {
			launchReceipt: "operator-captured after process start",
			runtimeSnapshot: "local sequential observations",
		},
		language,
		benchmark: `miracl-${language}-full-corpus-naia-vector-exact-v1`,
		identity: {
			language,
			...identities[language],
		},
		independentEvaluatorTool: {
			name: "usnistgov/trec_eval",
			version: TREC_EVAL_VERSION,
			commit: TREC_EVAL_COMMIT,
			binarySha256: EXPECTED_TREC_EVAL_BINARY_SHA256,
			stdout,
			stdoutSha256: sha256Bytes(stdout),
		},
		metrics: { reproducedByIndependentTool: { ndcgAt10, recallAt100 } },
		runtime: {
			cpuOnly: true,
			qdrant: { pointsCount: identities[language].documentCount },
		},
		artifacts,
		artifactManifestSha256: evidenceObjectSha256(artifacts),
		implementation: {
			evaluationSourceSha256: sha256Bytes("evaluation source fixture"),
			runtimeMonitorSourceSha256: sha256Bytes("runtime monitor fixture"),
			artifactStability: { resultAfterSha256: resultSha256 },
		},
	});
}

describe("MIRACL language-specific comparison", () => {
	it.each([
		["ko", 0.609, 0.9],
		["ar", 0.673, 0.941],
	] as const)(
		"pins %s to the official Table 5 hybrid row",
		(language, ndcg, recall) => {
			const result = createMiraclLanguageComparison(
				evidence(language, ndcg, recall),
			);
			expect(result.hybridReferenceOutcome).toBe("WITHIN_PUBLISHED_ROUNDING");
			expect(result.rows).toHaveLength(6);
			expect(result.rows.find((row) => row.class === "hybrid")).toMatchObject({
				ndcgAt10: ndcg,
				recallAt100: recall,
			});
			expect(result.comparisonPolicy.aggregation).toBe("none");
			expect(result.comparisonPolicy.publishedRowRoundingTolerance).toBe(
				0.0005,
			);
			expect(result.denseReferences).toHaveLength(3);
			expect(result.publicClaimEligible).toBe(false);
		},
	);

	it("rejects an English result that differs from the qualified corpus identity", () => {
		const input = JSON.parse(evidence("en", 0.549, 0.882));
		input.identity.documentCount = 1;
		expect(() => createMiraclLanguageComparison(JSON.stringify(input))).toThrow(
			"language-specific benchmark identity mismatch",
		);
	});

	it("pins publication and table provenance", () => {
		expect(MIRACL_BASELINE_SOURCE).toMatchObject({
			doi: "10.1162/tacl_a_00595",
			table: 5,
			datasetSplit: "MIRACL development set",
		});
		expect(MIRACL_HISTORICAL_ROWS).toEqual({
			ko: [
				{
					system: "BM25",
					ndcgAt10: 0.419,
					recallAt100: 0.783,
					class: "lexical",
				},
				{ system: "mDPR", ndcgAt10: 0.419, recallAt100: 0.737, class: "dense" },
				{
					system: "BM25 + mDPR",
					ndcgAt10: 0.609,
					recallAt100: 0.9,
					class: "hybrid",
				},
				{
					system: "mColBERT",
					ndcgAt10: 0.487,
					recallAt100: 0.722,
					class: "late interaction",
				},
				{
					system: "mContriever",
					ndcgAt10: 0.483,
					recallAt100: 0.875,
					class: "dense",
				},
				{
					system: "in-language mDPR",
					ndcgAt10: 0.472,
					recallAt100: 0.807,
					class: "dense",
				},
			],
			en: [
				{
					system: "BM25",
					ndcgAt10: 0.351,
					recallAt100: 0.819,
					class: "lexical",
				},
				{ system: "mDPR", ndcgAt10: 0.394, recallAt100: 0.768, class: "dense" },
				{
					system: "BM25 + mDPR",
					ndcgAt10: 0.549,
					recallAt100: 0.882,
					class: "hybrid",
				},
				{
					system: "mColBERT",
					ndcgAt10: 0.388,
					recallAt100: 0.801,
					class: "late interaction",
				},
				{
					system: "mContriever",
					ndcgAt10: 0.364,
					recallAt100: 0.797,
					class: "dense",
				},
				{
					system: "in-language mDPR",
					ndcgAt10: 0.413,
					recallAt100: 0.751,
					class: "dense",
				},
			],
			ar: [
				{
					system: "BM25",
					ndcgAt10: 0.481,
					recallAt100: 0.889,
					class: "lexical",
				},
				{ system: "mDPR", ndcgAt10: 0.499, recallAt100: 0.841, class: "dense" },
				{
					system: "BM25 + mDPR",
					ndcgAt10: 0.673,
					recallAt100: 0.941,
					class: "hybrid",
				},
				{
					system: "mColBERT",
					ndcgAt10: 0.571,
					recallAt100: 0.908,
					class: "late interaction",
				},
				{
					system: "mContriever",
					ndcgAt10: 0.525,
					recallAt100: 0.925,
					class: "dense",
				},
				{
					system: "in-language mDPR",
					ndcgAt10: 0.649,
					recallAt100: 0.904,
					class: "dense",
				},
			],
		});
	});

	it("reports every cross-paradigm reference outcome without pooling", () => {
		expect(
			createMiraclLanguageComparison(evidence("ar", 0.7, 0.95))
				.hybridReferenceOutcome,
		).toBe("ABOVE_BOTH_REPORTED_METRICS");
		expect(
			createMiraclLanguageComparison(evidence("ar", 0.7, 0.9))
				.hybridReferenceOutcome,
		).toBe("MIXED");
		expect(
			createMiraclLanguageComparison(evidence("ko", 0.4, 0.7))
				.hybridReferenceOutcome,
		).toBe("BELOW_BOTH");
	});

	it("does not hide a difference larger than half the published rounding unit", () => {
		expect(
			createMiraclLanguageComparison(evidence("ar", 0.6736, 0.941))
				.hybridReferenceOutcome,
		).toBe("ABOVE_BOTH_REPORTED_METRICS");
	});

	it("includes the exact half-unit boundary in published rounding", () => {
		expect(
			createMiraclLanguageComparison(evidence("ar", 0.6735, 0.9415))
				.hybridReferenceOutcome,
		).toBe("WITHIN_PUBLISHED_ROUNDING");
	});

	it.each([
		["language", "ko", "benchmark"],
		["benchmark", "miracl-ko-full-corpus-naia-vector-exact-v1", "benchmark"],
	] as const)(
		"rejects a language/benchmark substitution through %s",
		(field, value) => {
			const changed = JSON.parse(evidence("ar", 0.673, 0.941));
			changed[field] = value;
			expect(() =>
				createMiraclLanguageComparison(JSON.stringify(changed)),
			).toThrow("identity mismatch");
		},
	);

	it("rejects metric, evaluator, corpus, and public-claim substitutions", () => {
		const cases = ["metric", "evaluator", "corpus", "claim"] as const;
		for (const mutation of cases) {
			const changed = JSON.parse(evidence("ar", 0.673, 0.941));
			if (mutation === "metric")
				changed.metrics.reproducedByIndependentTool.ndcgAt10 = 0.9;
			if (mutation === "evaluator")
				changed.independentEvaluatorTool.binarySha256 = "0".repeat(64);
			if (mutation === "corpus") changed.runtime.qdrant.pointsCount -= 1;
			if (mutation === "claim") changed.publicClaimEligible = true;
			expect(() =>
				createMiraclLanguageComparison(JSON.stringify(changed)),
			).toThrow();
		}
	});

	it("rejects reported metrics that disagree with pinned trec_eval stdout", () => {
		const changed = JSON.parse(evidence("ar", 0.673, 0.941));
		changed.metrics.reproducedByIndependentTool.ndcgAt10 = 0.674;

		expect(() =>
			createMiraclLanguageComparison(JSON.stringify(changed)),
		).toThrow("independent evaluator metric mismatch");
	});

	it("rejects incomplete or mutated completion provenance", () => {
		for (const mutation of ["missing", "manifest", "implementation"] as const) {
			const changed = JSON.parse(evidence("ar", 0.673, 0.941));
			if (mutation === "missing") changed.claimBoundary = undefined;
			if (mutation === "manifest")
				changed.artifacts.result.sha256 = "f".repeat(64);
			if (mutation === "implementation")
				changed.implementation.artifactStability = undefined;
			expect(() =>
				createMiraclLanguageComparison(JSON.stringify(changed)),
			).toThrow();
		}
	});

	it("rejects a same-cardinality wrong-docid corpus substitution", () => {
		const changed = JSON.parse(evidence("ar", 0.673, 0.941));
		changed.artifacts.checkpointChain.docidsSha256 = "f".repeat(64);
		changed.artifactManifestSha256 = evidenceObjectSha256(changed.artifacts);

		expect(changed.artifacts.checkpointChain.documentCount).toBe(2_061_414);
		expect(changed.runtime.qdrant.pointsCount).toBe(2_061_414);
		expect(() =>
			createMiraclLanguageComparison(JSON.stringify(changed)),
		).toThrow("language-specific benchmark identity mismatch");
	});

	it("rejects a substituted source-lock identity", () => {
		const changed = JSON.parse(evidence("ar", 0.673, 0.941));
		changed.identity.sourceLockSha256 = "f".repeat(64);

		expect(() =>
			createMiraclLanguageComparison(JSON.stringify(changed)),
		).toThrow("language-specific benchmark identity mismatch");
	});
});
