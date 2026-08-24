import { describe, expect, it } from "vitest";
import {
	EnglishPreflightSampler,
	MIRACL_EN_PREFLIGHT_PER_STRATUM,
	MIRACL_EN_PREFLIGHT_RETRIEVAL_QUERIES,
	MIRACL_EN_PREFLIGHT_STRATA,
	createMiraclEnPrimaryPreflightEvidence,
	englishPreflightRetrievalInputSha256,
	englishPreflightVectorArtifactSha256,
} from "./miracl-en-primary-preflight.js";
import { buildNativeRuntimeSourceManifest } from "./native-runtime-source-manifest.js";

const DIMENSIONS = 1_024;
const PRODUCER_SOURCE_MANIFEST = buildNativeRuntimeSourceManifest({
	root: process.cwd(),
	entryPoint: "src/benchmark/quality/miracl-en-primary-preflight.test.ts",
});

function passages() {
	return MIRACL_EN_PREFLIGHT_STRATA.slice(0, -1).flatMap((minimum, stratum) =>
		Array.from({ length: MIRACL_EN_PREFLIGHT_PER_STRATUM }, (_, row) => ({
			ordinal: stratum * MIRACL_EN_PREFLIGHT_PER_STRATUM + row,
			docid: `d-${stratum}-${row}`,
			content: "x".repeat(Math.max(1, minimum)),
		})),
	);
}

function evidenceInput() {
	const sample = passages();
	const vector = [1, ...Array<number>(DIMENSIONS - 1).fill(0)];
	const vectors = Array(sample.length).fill(vector);
	const rankings = Array.from(
		{ length: MIRACL_EN_PREFLIGHT_RETRIEVAL_QUERIES },
		(_, query) => ({
			queryId: `q-${query}`,
			ranking: Array.from({ length: 100 }, (_, rank) => `d-${query}-${rank}`),
		}),
	);
	const retrieval = {
		perItemRankings: rankings,
		batchRankings: structuredClone(rankings),
		relevantByQuery: new Map(
			rankings.map(({ queryId, ranking }) => [
				queryId,
				new Set([ranking[0] ?? ""]),
			]),
		),
		rankingArtifactSha256: "",
		corpusPassagesSha256: "b".repeat(64),
	};
	retrieval.rankingArtifactSha256 =
		englishPreflightRetrievalInputSha256(retrieval);
	const input = {
		passages: sample,
		vectors: {
			perItem: vectors,
			batchOrdered: vectors,
			batchOrderedRepeat: vectors,
			batchShuffledRestored: vectors,
		},
		producerSourceManifest: PRODUCER_SOURCE_MANIFEST,
		vectorArtifactSha256: "",
		perItemDocumentsPerSecond: 1,
		batchDocumentsPerSecond: 8,
		retrieval,
	};
	input.vectorArtifactSha256 = englishPreflightVectorArtifactSha256(input);
	return input;
}

describe("MIRACL English primary preflight", () => {
	it("selects a deterministic full sample from every byte-length stratum", () => {
		const candidates = passages();
		const forward = new EnglishPreflightSampler();
		const reverse = new EnglishPreflightSampler();
		for (const passage of candidates) forward.consider(passage);
		for (const passage of [...candidates].reverse()) reverse.consider(passage);
		expect(forward.finish()).toEqual(reverse.finish());
		expect(forward.finish()).toHaveLength(8_192);
	});

	it("reports observations without granting equivalence or public claims", () => {
		const evidence = createMiraclEnPrimaryPreflightEvidence(evidenceInput());
		expect(evidence.verdict).toBe("PASS");
		expect(evidence.claimEligibility).toEqual({
			public: false,
			equivalence: false,
			noninferiority: false,
			throughput: false,
			multilingualTransfer: false,
			sota: false,
		});
		expect(evidence.observed.throughputDocumentsPerSecond.ratio).toBe(8);
	});

	it("fails closed on nondeterminism, zero-norm vectors, and malformed raw rankings", () => {
		const nondeterministic = evidenceInput();
		const changed = [...nondeterministic.vectors.batchOrderedRepeat];
		changed[0] = [0.5, ...Array<number>(DIMENSIONS - 1).fill(0)];
		nondeterministic.vectors.batchOrderedRepeat = changed;
		nondeterministic.vectorArtifactSha256 =
			englishPreflightVectorArtifactSha256(nondeterministic);
		expect(
			createMiraclEnPrimaryPreflightEvidence(nondeterministic).verdict,
		).toBe("FAIL");

		const zeroNorm = evidenceInput();
		const zeros = Array<number>(DIMENSIONS).fill(0);
		zeroNorm.vectors.perItem = Array(zeroNorm.passages.length).fill(zeros);
		zeroNorm.vectorArtifactSha256 =
			englishPreflightVectorArtifactSha256(zeroNorm);
		expect(() => createMiraclEnPrimaryPreflightEvidence(zeroNorm)).toThrow(
			"nonzero norm",
		);

		const malformedRetrieval = evidenceInput();
		malformedRetrieval.retrieval.batchRankings[0]?.ranking.pop();
		expect(() =>
			createMiraclEnPrimaryPreflightEvidence(malformedRetrieval),
		).toThrow("digest mismatch");

		const forgedDigest = evidenceInput();
		forgedDigest.retrieval.rankingArtifactSha256 = "c".repeat(64);
		expect(() => createMiraclEnPrimaryPreflightEvidence(forgedDigest)).toThrow(
			"digest mismatch",
		);

		const forgedProducer = evidenceInput();
		forgedProducer.producerSourceManifest = {
			...forgedProducer.producerSourceManifest,
			manifestSha256: "d".repeat(64),
		};
		expect(() =>
			createMiraclEnPrimaryPreflightEvidence(forgedProducer),
		).toThrow("internally inconsistent");
	}, 15_000);

	it("recomputes retrieval metrics from query rankings and qrels", () => {
		const input = evidenceInput();
		input.retrieval.batchRankings[0]?.ranking.reverse();
		input.retrieval.rankingArtifactSha256 =
			englishPreflightRetrievalInputSha256(input.retrieval);
		const evidence = createMiraclEnPrimaryPreflightEvidence(input);
		expect(evidence.observed.retrieval.method).toBe(
			"query-ranking-qrels-recomputation-v1",
		);
		expect(evidence.observed.retrieval.batchNdcgAt10).toBeLessThan(
			evidence.observed.retrieval.perItemNdcgAt10,
		);
		expect(evidence.observed.retrieval.meanTop10Jaccard).toBeLessThan(1);
	});

	it("rejects duplicate passage identities and incomplete samples", () => {
		const sampler = new EnglishPreflightSampler();
		const passage = { ordinal: 0, docid: "d-0", content: "x" };
		sampler.consider(passage);
		expect(() => sampler.consider(passage)).toThrow("duplicated");
		expect(() => sampler.finish()).toThrow("must be full");
	});

	it("keeps verified corpus streaming identity checks ordinal-bounded", () => {
		const sampler = new EnglishPreflightSampler("verified-corpus-stream");
		sampler.consider({ ordinal: 0, docid: "d-0", content: "x" });
		sampler.consider({ ordinal: 1, docid: "d-1", content: "x" });
		expect(() =>
			sampler.consider({ ordinal: 3, docid: "d-3", content: "x" }),
		).toThrow("not contiguous");
	});
});
