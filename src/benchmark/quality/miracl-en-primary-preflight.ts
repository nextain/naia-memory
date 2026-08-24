import { createHash } from "node:crypto";
import { MIRACL_EN_PRIMARY_CLAIM_BOUNDARY } from "./miracl-en-primary-execution-authorization.js";
import {
	MIRACL_EN_PREFLIGHT_RETRIEVAL_QUERIES,
	miraclEnPrimaryExecutionPolicy,
} from "./miracl-en-primary-execution-policy.js";
import {
	MIRACL_EN_PREFLIGHT_PER_STRATUM,
	MIRACL_EN_PREFLIGHT_SAMPLE_SEED,
	MIRACL_EN_PREFLIGHT_STRATA,
	compareCanonicalText,
	englishPreflightStratumFor,
} from "./miracl-en-primary-sampling-contract.js";
import { MIRACL_MULTILINGUAL_CONTRACT } from "./miracl-multilingual-contract.js";
import { MIRACL_EMBEDDING_POLICY } from "./native-full-corpus-evidence.js";
import {
	type NativeRuntimeSourceManifest,
	validateNativeRuntimeSourceManifest,
} from "./native-runtime-source-manifest.js";
import { type RankedQuery, analyzeRankingAb } from "./ranking-ab-analysis.js";

export {
	compareCanonicalText,
	englishPreflightStratumFor,
	MIRACL_EN_PREFLIGHT_PER_STRATUM,
	MIRACL_EN_PREFLIGHT_SAMPLE_SEED,
	MIRACL_EN_PREFLIGHT_STRATA,
};
export { MIRACL_EN_PREFLIGHT_RETRIEVAL_QUERIES };

export interface EnglishPreflightPassage {
	ordinal: number;
	docid: string;
	content: string;
}

interface RankedPassage extends EnglishPreflightPassage {
	rank: string;
	stratum: number;
}

export interface EnglishPreflightVectorObservation {
	perItem: readonly (readonly number[])[];
	batchOrdered: readonly (readonly number[])[];
	batchOrderedRepeat: readonly (readonly number[])[];
	batchShuffledRestored: readonly (readonly number[])[];
}

export function englishPreflightVectorArtifactSha256(input: {
	passages: readonly EnglishPreflightPassage[];
	vectors: EnglishPreflightVectorObservation;
}): string {
	return sha256(
		`${JSON.stringify({ passages: input.passages, vectors: input.vectors })}\n`,
	);
}

export interface EnglishPreflightRetrievalInput {
	perItemRankings: RankedQuery[];
	batchRankings: RankedQuery[];
	relevantByQuery: ReadonlyMap<string, ReadonlySet<string>>;
	rankingArtifactSha256: string;
}

function sha256(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function compareRank(left: RankedPassage, right: RankedPassage): number {
	return (
		compareCanonicalText(left.rank, right.rank) || left.ordinal - right.ordinal
	);
}

export class EnglishPreflightSampler {
	private readonly strata = Array.from(
		{ length: MIRACL_EN_PREFLIGHT_STRATA.length - 1 },
		() => [] as RankedPassage[],
	);
	private readonly ordinals = new Set<number>();
	private readonly docids = new Set<string>();
	private lastVerifiedOrdinal = -1;

	constructor(
		private readonly identityMode:
			| "standalone"
			| "verified-corpus-stream" = "standalone",
	) {}

	consider(passage: EnglishPreflightPassage): void {
		if (!Number.isSafeInteger(passage.ordinal) || passage.ordinal < 0)
			throw new Error("sample ordinal must be a nonnegative safe integer");
		if (!passage.docid || typeof passage.content !== "string")
			throw new Error("sample passage is malformed");
		if (this.identityMode === "verified-corpus-stream") {
			if (passage.ordinal !== this.lastVerifiedOrdinal + 1)
				throw new Error("verified corpus stream ordinal is not contiguous");
			this.lastVerifiedOrdinal = passage.ordinal;
		} else {
			if (this.ordinals.has(passage.ordinal) || this.docids.has(passage.docid))
				throw new Error("sample passage identity is duplicated");
			this.ordinals.add(passage.ordinal);
			this.docids.add(passage.docid);
		}
		const stratum = englishPreflightStratumFor(
			Buffer.byteLength(passage.content, "utf8"),
		);
		const row: RankedPassage = {
			...passage,
			stratum,
			rank: sha256(
				`${MIRACL_EN_PREFLIGHT_SAMPLE_SEED}\0${passage.ordinal}\0${passage.docid}`,
			),
		};
		const rows = this.strata[stratum];
		if (!rows) throw new Error("sample stratum is unavailable");
		if (
			rows.length === MIRACL_EN_PREFLIGHT_PER_STRATUM &&
			compareRank(row, rows[rows.length - 1] as RankedPassage) >= 0
		)
			return;
		let low = 0;
		let high = rows.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (compareRank(row, rows[middle] as RankedPassage) < 0) high = middle;
			else low = middle + 1;
		}
		rows.splice(low, 0, row);
		if (rows.length > MIRACL_EN_PREFLIGHT_PER_STRATUM) rows.pop();
	}

	finish(): EnglishPreflightPassage[] {
		if (
			this.strata.some(
				(rows) => rows.length !== MIRACL_EN_PREFLIGHT_PER_STRATUM,
			)
		)
			throw new Error("every English preflight length stratum must be full");
		return this.strata
			.flat()
			.sort((left, right) => left.ordinal - right.ordinal)
			.map(({ ordinal, docid, content }) => ({ ordinal, docid, content }));
	}
}

function finiteVector(vector: readonly number[]): boolean {
	return (
		vector.length === MIRACL_EMBEDDING_POLICY.dimensions &&
		vector.every(Number.isFinite)
	);
}

function cosine(left: readonly number[], right: readonly number[]): number {
	let dot = 0;
	let leftNorm = 0;
	let rightNorm = 0;
	for (let index = 0; index < left.length; index += 1) {
		const a = left[index] ?? Number.NaN;
		const b = right[index] ?? Number.NaN;
		dot += a * b;
		leftNorm += a * a;
		rightNorm += b * b;
	}
	const denominator = Math.sqrt(leftNorm * rightNorm);
	if (!(denominator > 0))
		throw new Error("preflight vectors must have nonzero norm");
	return dot / denominator;
}

function vectorDelta(left: readonly number[], right: readonly number[]) {
	let maximumAbsoluteDelta = 0;
	for (let index = 0; index < left.length; index += 1)
		maximumAbsoluteDelta = Math.max(
			maximumAbsoluteDelta,
			Math.abs((left[index] ?? Number.NaN) - (right[index] ?? Number.NaN)),
		);
	return { maximumAbsoluteDelta, cosine: cosine(left, right) };
}

function quantile(sorted: readonly number[], fraction: number): number {
	if (sorted.length === 0) throw new Error("cannot summarize an empty sample");
	return sorted[Math.floor((sorted.length - 1) * fraction)] ?? Number.NaN;
}

function summary(values: readonly number[]) {
	const sorted = [...values].sort((left, right) => left - right);
	return {
		minimum: sorted[0],
		p50: quantile(sorted, 0.5),
		p95: quantile(sorted, 0.95),
		p99: quantile(sorted, 0.99),
		maximum: sorted.at(-1),
	};
}

function canonicalRows(passages: readonly EnglishPreflightPassage[]): string {
	return `${passages
		.map(({ ordinal, docid, content }) =>
			JSON.stringify({ ordinal, docid, content }),
		)
		.join("\n")}\n`;
}

export function englishPreflightRetrievalInputSha256(
	input: Pick<
		EnglishPreflightRetrievalInput,
		"perItemRankings" | "batchRankings" | "relevantByQuery"
	>,
): string {
	const qrels = [...input.relevantByQuery]
		.map(([queryId, docids]) => [queryId, [...docids].sort()] as const)
		.sort(([left], [right]) => compareCanonicalText(left, right));
	return sha256(
		`${JSON.stringify({
			method: "query-ranking-qrels-recomputation-v1",
			querySelection: "sha256-seeded-topic-id-v1",
			querySelectionSeed: MIRACL_EN_PREFLIGHT_SAMPLE_SEED,
			perItemRankings: input.perItemRankings,
			batchRankings: input.batchRankings,
			qrels,
		})}\n`,
	);
}

export function englishPreflightRelevantByQuerySha256(
	relevantByQuery: ReadonlyMap<string, ReadonlySet<string>>,
): string {
	const rows = [...relevantByQuery]
		.map(
			([queryId, docids]) =>
				[queryId, [...docids].sort(compareCanonicalText)] as const,
		)
		.sort(([left], [right]) => compareCanonicalText(left, right));
	return sha256(`${JSON.stringify(rows)}\n`);
}

export function createMiraclEnPrimaryPreflightEvidence(input: {
	passages: readonly EnglishPreflightPassage[];
	vectors: EnglishPreflightVectorObservation;
	producerSourceManifest: NativeRuntimeSourceManifest;
	vectorArtifactSha256: string;
	perItemDocumentsPerSecond: number;
	batchDocumentsPerSecond: number;
	retrieval: EnglishPreflightRetrievalInput;
}) {
	const expectedCount =
		(MIRACL_EN_PREFLIGHT_STRATA.length - 1) * MIRACL_EN_PREFLIGHT_PER_STRATUM;
	if (input.passages.length !== expectedCount)
		throw new Error("English preflight sample count mismatch");
	const arrays = Object.values(input.vectors);
	if (
		arrays.some(
			(vectors) =>
				vectors.length !== expectedCount ||
				vectors.some((vector) => !finiteVector(vector)),
		)
	)
		throw new Error("English preflight vectors are invalid");
	validateNativeRuntimeSourceManifest(input.producerSourceManifest);
	if (!/^[a-f0-9]{64}$/u.test(input.vectorArtifactSha256))
		throw new Error("artifact digest is invalid");
	if (
		input.vectorArtifactSha256 !==
		englishPreflightVectorArtifactSha256({
			passages: input.passages,
			vectors: input.vectors,
		})
	)
		throw new Error("vector artifact digest mismatch");
	if (
		![input.perItemDocumentsPerSecond, input.batchDocumentsPerSecond].every(
			(value) => Number.isFinite(value) && value > 0,
		)
	)
		throw new Error("preflight throughput is invalid");
	const repeatBitIdentical = input.vectors.batchOrdered.every((vector, row) =>
		vector.every((value, column) =>
			Object.is(value, input.vectors.batchOrderedRepeat[row]?.[column]),
		),
	);
	const perItemDeltas = input.vectors.perItem.map((vector, index) =>
		vectorDelta(vector, input.vectors.batchOrdered[index] ?? []),
	);
	const orderDeltas = input.vectors.batchOrdered.map((vector, index) =>
		vectorDelta(vector, input.vectors.batchShuffledRestored[index] ?? []),
	);
	const strata = Array.from(
		{ length: MIRACL_EN_PREFLIGHT_STRATA.length - 1 },
		(_, stratum) => {
			const indices = input.passages.flatMap((passage, index) =>
				englishPreflightStratumFor(
					Buffer.byteLength(passage.content, "utf8"),
				) === stratum
					? [index]
					: [],
			);
			if (indices.length !== MIRACL_EN_PREFLIGHT_PER_STRATUM)
				throw new Error(`preflight stratum ${stratum} count mismatch`);
			return {
				stratum,
				minimumBytes: MIRACL_EN_PREFLIGHT_STRATA[stratum],
				maximumBytesExclusive: MIRACL_EN_PREFLIGHT_STRATA[stratum + 1],
				maximumAbsoluteDelta: summary(
					indices.map(
						(index) => perItemDeltas[index]?.maximumAbsoluteDelta ?? Number.NaN,
					),
				),
				cosine: summary(
					indices.map((index) => perItemDeltas[index]?.cosine ?? Number.NaN),
				),
			};
		},
	);
	const rankingArtifactSha256 = englishPreflightRetrievalInputSha256(
		input.retrieval,
	);
	if (input.retrieval.rankingArtifactSha256 !== rankingArtifactSha256)
		throw new Error("retrieval ranking artifact digest mismatch");
	const retrievalAnalysis = analyzeRankingAb({
		baseline: input.retrieval.perItemRankings,
		candidate: input.retrieval.batchRankings,
		relevantByQuery: input.retrieval.relevantByQuery,
		bootstrapRepetitions: 1_000,
		bootstrapSeed: 0x4e414941,
	});
	const queryIds = input.retrieval.perItemRankings
		.map(({ queryId }) => queryId)
		.sort(compareCanonicalText);
	const candidateQueryIds = input.retrieval.batchRankings
		.map(({ queryId }) => queryId)
		.sort(compareCanonicalText);
	const qrelQueryIds = [...input.retrieval.relevantByQuery.keys()].sort(
		compareCanonicalText,
	);
	if (
		new Set(queryIds).size !== queryIds.length ||
		JSON.stringify(queryIds) !== JSON.stringify(candidateQueryIds) ||
		JSON.stringify(queryIds) !== JSON.stringify(qrelQueryIds)
	)
		throw new Error("retrieval query identities mismatch");
	const retrieval = {
		method: "query-ranking-qrels-recomputation-v1" as const,
		querySelection: "sha256-seeded-topic-id-v1" as const,
		querySelectionSeed: MIRACL_EN_PREFLIGHT_SAMPLE_SEED,
		queryCount: retrievalAnalysis.queryCount,
		queryIdsSha256: sha256(`${queryIds.join("\n")}\n`),
		relevantByQuerySha256: englishPreflightRelevantByQuerySha256(
			input.retrieval.relevantByQuery,
		),
		perItemNdcgAt10: retrievalAnalysis.metrics.ndcgAt10.baseline,
		batchNdcgAt10: retrievalAnalysis.metrics.ndcgAt10.candidate,
		meanTop10Jaccard: retrievalAnalysis.rankingStability.meanTop10Jaccard,
		meanTop100Jaccard: retrievalAnalysis.rankingStability.meanTop100Jaccard,
		rankingArtifactSha256,
	};
	if (retrieval.queryCount !== MIRACL_EN_PREFLIGHT_RETRIEVAL_QUERIES)
		throw new Error("retrieval query sample count mismatch");
	const policy = miraclEnPrimaryExecutionPolicy(MIRACL_EMBEDDING_POLICY);
	const contract = MIRACL_MULTILINGUAL_CONTRACT.en;
	return {
		schemaVersion: 1 as const,
		artifactClass: "miracl-en-primary-preflight-v1" as const,
		verdict: repeatBitIdentical ? ("PASS" as const) : ("FAIL" as const),
		language: "en" as const,
		claimBoundary: MIRACL_EN_PRIMARY_CLAIM_BOUNDARY,
		sourceLockSha256: contract.corpus.expectedSourceLockSha256,
		corpusDocidsSha256: contract.corpus.expectedDocidsSha256,
		sample: {
			method: "sha256-seeded-length-stratified-ordinal-v1" as const,
			seed: MIRACL_EN_PREFLIGHT_SAMPLE_SEED,
			documentCount: expectedCount,
			ordinalsSha256: sha256(
				`${input.passages.map(({ ordinal }) => ordinal).join("\n")}\n`,
			),
			passagesSha256: sha256(canonicalRows(input.passages)),
			lengthStrata: MIRACL_EN_PREFLIGHT_STRATA.length - 1,
		},
		execution: {
			embeddingExecutionPolicySha256: policy.embeddingExecutionPolicySha256,
			producerSourceManifest: input.producerSourceManifest,
			producerSourceSha256: input.producerSourceManifest.manifestSha256,
			vectorArtifactSha256: input.vectorArtifactSha256,
		},
		observed: {
			perItemVersusBatch: {
				maximumAbsoluteDelta: summary(
					perItemDeltas.map(({ maximumAbsoluteDelta }) => maximumAbsoluteDelta),
				),
				cosine: summary(perItemDeltas.map(({ cosine: value }) => value)),
			},
			batchOrderSensitivity: {
				maximumAbsoluteDelta: summary(
					orderDeltas.map(({ maximumAbsoluteDelta }) => maximumAbsoluteDelta),
				),
				cosine: summary(orderDeltas.map(({ cosine: value }) => value)),
			},
			lengthStrata: strata,
			throughputDocumentsPerSecond: {
				perItem: input.perItemDocumentsPerSecond,
				batch: input.batchDocumentsPerSecond,
				ratio: input.batchDocumentsPerSecond / input.perItemDocumentsPerSecond,
			},
			retrieval,
		},
		checks: {
			finiteDimensions: true,
			repeatBitIdentical,
			orderSensitivityReported: true,
			lengthStratifiedDeltasReported: true,
			retrievalDeltasReported: true,
			throughputReported: true,
		},
		claimEligibility: {
			public: false,
			equivalence: false,
			noninferiority: false,
			throughput: false,
			multilingualTransfer: false,
			sota: false,
		},
	};
}
