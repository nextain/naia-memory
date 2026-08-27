import { describe, expect, it } from "vitest";
import { createMiraclGlobalComparison } from "./miracl-global-comparison.js";
import { createMiraclPublishedComparison } from "./miracl-published-comparison.js";
import {
	EXPECTED_MIRACL_QRELS_SHA256,
	EXPECTED_MIRACL_SOURCE_LOCK_SHA256,
	EXPECTED_MIRACL_TOPICS_SHA256,
	EXPECTED_TREC_EVAL_BINARY_SHA256,
	METRIC_TOLERANCE,
	MIRACL_EMBEDDING_POLICY,
	MIRACL_PASSAGE_COMPOSITION,
	TREC_EVAL_COMMIT,
	TREC_EVAL_VERSION,
	sha256Bytes,
} from "./native-full-corpus-evidence.js";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";

function fixture() {
	const stdout = "ndcg_cut_10 all 0.61\nrecall_100 all 0.901\n";
	const manifests = {
		dataset: {
			benchmark: "miracl-ko-full-corpus-naia-vector-exact-v1",
			documentCount: 1_486_752,
			queryCount: 213,
			sourceLockSha256: EXPECTED_MIRACL_SOURCE_LOCK_SHA256,
			topicsSha256: EXPECTED_MIRACL_TOPICS_SHA256,
			qrelsSha256: EXPECTED_MIRACL_QRELS_SHA256,
			corpusDocidsSha256: "a".repeat(64),
			passageComposition: MIRACL_PASSAGE_COMPOSITION,
		},
		protocol: {
			benchmark: "miracl-ko-full-corpus-naia-vector-exact-v1",
			exactSearch: true,
			topK: 100,
			metrics: ["ndcg_cut.10", "recall.100"],
			metricTolerance: METRIC_TOLERANCE,
		},
		implementation: { source: "fixture" },
		configuration: {
			passageComposition: MIRACL_PASSAGE_COMPOSITION,
			embedding: MIRACL_EMBEDDING_POLICY,
			vectorStore: "Qdrant",
			distance: "Cosine",
			exactSearch: true,
			topK: 100,
			cpuOnly: true,
		},
		executionEvidence: {
			resultSha256: "fixture",
			checkpointChain: { docidsSha256: "a".repeat(64) },
		},
	};
	const receiptText = JSON.stringify({
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
			inProcess: { ndcgAt10: 0.61, recallAt100: 0.901 },
			reproducedByIndependentTool: { ndcgAt10: 0.61, recallAt100: 0.901 },
			deltas: { ndcgAt10: 0, recallAt100: 0 },
			tolerance: METRIC_TOLERANCE,
		},
	});
	const digest = sha256Bytes(receiptText);
	const comparison = createMiraclGlobalComparison(receiptText);
	const verdict = {
		schemaVersion: 2,
		assuranceModel: "trusted-runner-signature-with-rfc3161-chronology",
		publicationGateEligible: true,
		verdict: "TIMESTAMP_QUALIFIED_PUBLIC_ATTESTATION_PASS",
		publicClaimEligible: true,
		baseReceipt: {
			sha256: digest,
			verdict: "LOCAL_PASS",
			assurance: "self-observed-local",
		},
		binding: {
			engine: "miracl-ko-full-corpus-naia-vector-exact-v1",
			receiptSha256: digest,
		},
		failures: [],
		verificationBundle: {
			manifestSha256: "a".repeat(64),
			artifactSha256: { receipt: digest },
		},
		bundlePublication: { manifestSha256: "a".repeat(64) },
	};
	return { receiptText, comparison, verdict };
}

describe("MIRACL published historical comparison", () => {
	it("publishes only the narrow historical comparison with disclaimers intact", () => {
		const current = fixture();
		const result = createMiraclPublishedComparison({
			receiptText: current.receiptText,
			comparisonText: JSON.stringify(current.comparison),
			verifiedPublishedVerdict: current.verdict,
		});
		expect(result).toMatchObject({
			verdict: "HISTORICAL_COMPARISON_PUBLICATION_PASS",
			publicClaimEligible: true,
			eligibleClaimScope:
				"protocol-matched historical MIRACL Korean development retrieval comparison only",
			hybridTier: "WITHIN_HISTORICAL_ROW_RESOLUTION",
		});
		expect(result.notEstablished).toEqual([
			"current state of the art",
			"memory-engine superiority",
			"Naia-specific retrieval innovation",
			"multilingual quality",
			"statistical significance versus historical rows",
		]);
		expect(result.interpretationThreshold).toBe(
			current.comparison.interpretationThreshold,
		);
		expect(result.baseRetriever).toEqual(current.comparison.baseRetriever);
		expect(result.retrievalProtocol).toEqual(
			current.comparison.retrievalProtocol,
		);
		expect(result.knownLimitations).toEqual(
			current.comparison.knownLimitations,
		);
		expect(result.provenanceBoundary).toBe(
			current.comparison.provenanceBoundary,
		);
		expect(result.comparisonSha256).toBe(
			sha256Bytes(JSON.stringify(current.comparison)),
		);
	});

	it("binds the exact accepted comparison bytes, not a canonical rewrite", () => {
		const current = fixture();
		const comparisonText = `${JSON.stringify(current.comparison, null, 2)}\n`;
		const result = createMiraclPublishedComparison({
			receiptText: current.receiptText,
			comparisonText,
			verifiedPublishedVerdict: current.verdict,
		});
		expect(result.comparisonSha256).toBe(sha256Bytes(comparisonText));
	});

	it.each([
		"metrics",
		"hybridTier",
		"rows",
		"retrievalProtocol",
		"provenanceBoundary",
		"knownLimitations",
	])("rejects a comparison with edited %s", (field) => {
		const current = fixture();
		const edited = structuredClone(current.comparison) as Record<
			string,
			unknown
		>;
		edited[field] = field === "hybridTier" ? "BELOW_BOTH" : {};
		expect(() =>
			createMiraclPublishedComparison({
				receiptText: current.receiptText,
				comparisonText: JSON.stringify(edited),
				verifiedPublishedVerdict: current.verdict,
			}),
		).toThrow("does not match receipt recomputation");
	});

	it("rejects receipt byte drift even when the JSON meaning is unchanged", () => {
		const current = fixture();
		expect(() =>
			createMiraclPublishedComparison({
				receiptText: `${current.receiptText}\n`,
				comparisonText: JSON.stringify(current.comparison),
				verifiedPublishedVerdict: current.verdict,
			}),
		).toThrow("does not match receipt recomputation");
	});

	it.each(["baseReceipt", "binding"])(
		"rejects a mismatched %s receipt hash",
		(field) => {
			const current = fixture();
			const verdict = structuredClone(current.verdict);
			if (field === "baseReceipt") verdict.baseReceipt.sha256 = "b".repeat(64);
			else verdict.binding.receiptSha256 = "b".repeat(64);
			expect(() =>
				createMiraclPublishedComparison({
					receiptText: current.receiptText,
					comparisonText: JSON.stringify(current.comparison),
					verifiedPublishedVerdict: verdict,
				}),
			).toThrow("receipt binding mismatch");
		},
	);

	it.each([
		["schemaVersion", 1],
		["verdict", "PUBLIC_ATTESTATION_PASS"],
		["publicationGateEligible", false],
		["publicClaimEligible", false],
		["failures", ["failure"]],
	])("rejects downgraded or failing attestation %s", (field, value) => {
		const current = fixture();
		const verdict = { ...current.verdict, [field]: value };
		expect(() =>
			createMiraclPublishedComparison({
				receiptText: current.receiptText,
				comparisonText: JSON.stringify(current.comparison),
				verifiedPublishedVerdict: verdict,
			}),
		).toThrow("timestamp-qualified public attestation is required");
	});

	it.each(["verificationBundle", "bundlePublication"])(
		"rejects missing %s evidence",
		(field) => {
			const current = fixture();
			const verdict = structuredClone(current.verdict) as Record<
				string,
				unknown
			>;
			delete verdict[field];
			expect(() =>
				createMiraclPublishedComparison({
					receiptText: current.receiptText,
					comparisonText: JSON.stringify(current.comparison),
					verifiedPublishedVerdict: verdict,
				}),
			).toThrow(
				field === "verificationBundle"
					? "verified bundle evidence"
					: "verified bundle publication evidence",
			);
		},
	);

	it("rejects a bundle whose receipt artifact is not the verified receipt", () => {
		const current = fixture();
		current.verdict.verificationBundle.artifactSha256.receipt = "b".repeat(64);
		expect(() =>
			createMiraclPublishedComparison({
				receiptText: current.receiptText,
				comparisonText: JSON.stringify(current.comparison),
				verifiedPublishedVerdict: current.verdict,
			}),
		).toThrow("verified bundle receipt digest mismatch");
	});

	it("rejects a publication for a different verified bundle manifest", () => {
		const current = fixture();
		current.verdict.bundlePublication.manifestSha256 = "b".repeat(64);
		expect(() =>
			createMiraclPublishedComparison({
				receiptText: current.receiptText,
				comparisonText: JSON.stringify(current.comparison),
				verifiedPublishedVerdict: current.verdict,
			}),
		).toThrow("bundle publication manifest binding mismatch");
	});
});
