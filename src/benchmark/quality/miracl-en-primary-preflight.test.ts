import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	EnglishPreflightSampler,
	MIRACL_EN_PREFLIGHT_PER_STRATUM,
	MIRACL_EN_PREFLIGHT_RETRIEVAL_QUERIES,
	MIRACL_EN_PREFLIGHT_STRATA,
	createMiraclEnPrimaryPreflightEvidence,
	englishPreflightRetrievalInputSha256,
	englishPreflightVectorArtifactSha256,
	publishEnglishPreflightVectorArtifact,
	rankEnglishPreflightCorpus,
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
	const vectors = new Float32Array(sample.length * DIMENSIONS);
	for (let row = 0; row < sample.length; row += 1)
		vectors[row * DIMENSIONS] = 1;
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
			dimensions: DIMENSIONS,
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
		const changed = nondeterministic.vectors.batchOrderedRepeat.slice();
		changed[0] = 0.5;
		nondeterministic.vectors.batchOrderedRepeat = changed;
		nondeterministic.vectorArtifactSha256 =
			englishPreflightVectorArtifactSha256(nondeterministic);
		expect(
			createMiraclEnPrimaryPreflightEvidence(nondeterministic).verdict,
		).toBe("FAIL");

		const zeroNorm = evidenceInput();
		zeroNorm.vectors.perItem = new Float32Array(
			zeroNorm.passages.length * DIMENSIONS,
		);
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
		const duplicate = new EnglishPreflightSampler("verified-corpus-stream");
		duplicate.consider({ ordinal: 0, docid: "same", content: "x" });
		expect(() =>
			duplicate.consider({ ordinal: 1, docid: "same", content: "y" }),
		).toThrow("duplicated");
	});

	it("canonicalizes retrieval query ordering in the artifact digest", () => {
		const input = evidenceInput().retrieval;
		const digest = englishPreflightRetrievalInputSha256(input);
		input.perItemRankings.reverse();
		input.batchRankings.reverse();
		expect(englishPreflightRetrievalInputSha256(input)).toBe(digest);
	});

	it("publishes the exact binary artifact once and refuses overwrite", () => {
		const directory = mkdtempSync(join(tmpdir(), "naia-miracl-en-"));
		const output = join(directory, "vectors.f32");
		const input = {
			passages: [{ ordinal: 0, docid: "d-0", content: "bound separately" }],
			vectors: {
				dimensions: 2,
				perItem: new Float32Array([1, 0]),
				batchOrdered: new Float32Array([1, 0]),
				batchOrderedRepeat: new Float32Array([1, 0]),
				batchShuffledRestored: new Float32Array([1, 0]),
			},
		};
		try {
			const digest = publishEnglishPreflightVectorArtifact(output, input);
			expect(digest).toBe(englishPreflightVectorArtifactSha256(input));
			expect(readFileSync(output).byteLength).toBeLessThan(1_024);
			expect(() =>
				publishEnglishPreflightVectorArtifact(output, input),
			).toThrow();
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("refuses malformed vector artifacts before hashing or publication", () => {
		const input = {
			passages: [{ ordinal: 0, docid: "d-0", content: "x" }],
			vectors: {
				dimensions: 2,
				perItem: new Float32Array([1]),
				batchOrdered: new Float32Array([1, 0]),
				batchOrderedRepeat: new Float32Array([1, 0]),
				batchShuffledRestored: new Float32Array([1, 0]),
			},
		};
		expect(() => englishPreflightVectorArtifactSha256(input)).toThrow(
			"perItem values are invalid",
		);

		input.vectors.perItem = new Float32Array([1, 0]);
		input.vectors.batchOrdered[0] = Number.NaN;
		expect(() => englishPreflightVectorArtifactSha256(input)).toThrow(
			"batchOrdered values are invalid",
		);

		const shared = new Float32Array(
			new SharedArrayBuffer(2 * Float32Array.BYTES_PER_ELEMENT),
		);
		shared.set([1, 0]);
		input.vectors.batchOrdered[0] = 1;
		input.vectors.perItem = shared;
		expect(() => englishPreflightVectorArtifactSha256(input)).toThrow(
			"perItem values are invalid",
		);
	});

	it("ranks by exact cosine with deterministic ordinal and docid ties", () => {
		expect(
			rankEnglishPreflightCorpus({
				queryId: "q-1",
				query: [1, 0],
				corpusVectors: new Float32Array([1, 0, 2, 0, 0, 1]),
				passages: [
					{ docid: "later", ordinal: 2 },
					{ docid: "first", ordinal: 1 },
					{ docid: "orthogonal", ordinal: 0 },
				],
				dimensions: 2,
			}),
		).toEqual({ queryId: "q-1", ranking: ["first", "later", "orthogonal"] });
		expect(() =>
			rankEnglishPreflightCorpus({
				queryId: "q-shared",
				query: [1, 0],
				corpusVectors: new Float32Array(
					new SharedArrayBuffer(2 * Float32Array.BYTES_PER_ELEMENT),
				),
				passages: [{ docid: "d", ordinal: 0 }],
				dimensions: 2,
			}),
		).toThrow("vectors are invalid");
		expect(() =>
			rankEnglishPreflightCorpus({
				queryId: "q-1",
				query: [0, 0],
				corpusVectors: new Float32Array([1, 0]),
				passages: [{ docid: "d", ordinal: 0 }],
				dimensions: 2,
			}),
		).toThrow("invalid norm");
		expect(() =>
			rankEnglishPreflightCorpus({
				queryId: "q-overflow",
				query: [Number.MAX_VALUE, Number.MAX_VALUE],
				corpusVectors: new Float32Array([1, 0]),
				passages: [{ docid: "d", ordinal: 0 }],
				dimensions: 2,
			}),
		).toThrow("invalid norm");
		expect(
			rankEnglishPreflightCorpus({
				queryId: "q-stable-denominator",
				query: [1e150, 0],
				corpusVectors: new Float32Array([0, 1e30, 1e30, 0]),
				passages: [
					{ docid: "orthogonal", ordinal: 0 },
					{ docid: "aligned", ordinal: 1 },
				],
				dimensions: 2,
			}),
		).toEqual({
			queryId: "q-stable-denominator",
			ranking: ["aligned", "orthogonal"],
		});
		expect(() =>
			rankEnglishPreflightCorpus({
				queryId: "q-duplicate",
				query: [1, 0],
				corpusVectors: new Float32Array([1, 0, 0, 1]),
				passages: [
					{ docid: "duplicate", ordinal: 0 },
					{ docid: "duplicate", ordinal: 1 },
				],
				dimensions: 2,
			}),
		).toThrow("passage identity is invalid");
	});
});
