import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	authorizeMultilingualTrueBatchCandidate,
	verifyMultilingualTrueBatchAuthorizationFiles,
} from "./miracl-multilingual-candidate-authorization.js";
import {
	MIRACL_MULTILINGUAL_CONTRACT,
	miraclExecutionNamespace,
} from "./miracl-multilingual-contract.js";
import { miraclSourceLockReceipt } from "./miracl-multilingual-download.js";
import type { MultilingualFullCorpusResult } from "./miracl-multilingual-full-corpus-evidence.js";
import {
	MULTILINGUAL_TRUE_BATCH_CLAIM_BOUNDARY,
	MULTILINGUAL_TRUE_BATCH_MODEL,
	MULTILINGUAL_TRUE_BATCH_MODEL_REVISION,
	MULTILINGUAL_TRUE_BATCH_THRESHOLDS,
	type MultilingualTrueBatchLanguage,
	multilingualEquivalenceInputSha256,
} from "./miracl-multilingual-true-batch-equivalence.js";
import { expectedMultilingualTrueBatchIdentity } from "./miracl-multilingual-true-batch-runner.js";
import {
	MIRACL_EMBEDDING_POLICY,
	MIRACL_PASSAGE_COMPOSITION,
	sha256Bytes,
} from "./native-full-corpus-evidence.js";
import { fullCorpusEmbeddingExecutionPolicy } from "./native-full-corpus-policy.js";

const bytes = (value: unknown) =>
	Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

const arabicCorpus = [
	[
		"docs-0.jsonl.gz",
		94_104_175,
		"f3c38eaa54836397aae4793bb052430646028c2c958c1a54fb71900c83f5dcee",
	],
	[
		"docs-1.jsonl.gz",
		83_793_880,
		"77f67390f95a69ae2447fffb2a62c0de9d28e8d0eb3bf97cfe04e85c1924cd42",
	],
	[
		"docs-2.jsonl.gz",
		70_295_610,
		"8c10dda6b56429841e730432aa75d3338e37b605410b936b4fc6c914521d2aec",
	],
	[
		"docs-3.jsonl.gz",
		64_551_259,
		"0d0a02ec18ca8e246f0af5788077fa23f1de35d5a40dee6cacc4fe5a2b91f904",
	],
	[
		"docs-4.jsonl.gz",
		7_227_421,
		"4b75ab6cac6ae8615a60f1b278460dd3d9ef776ea002a6684a6757631fec62fc",
	],
] as const;

function fixtures(
	language: MultilingualTrueBatchLanguage,
	sourceLockOverride?: string,
) {
	const contract = MIRACL_MULTILINGUAL_CONTRACT[language];
	if (!("expectedSourceLockSha256" in contract.corpus) && !sourceLockOverride)
		throw new Error("test language lacks a source lock");
	const sourceLockSha256 =
		sourceLockOverride ??
		("expectedSourceLockSha256" in contract.corpus
			? contract.corpus.expectedSourceLockSha256
			: "");
	const documentCount =
		"expectedDocumentCount" in contract.corpus
			? contract.corpus.expectedDocumentCount
			: 9;
	const corpusDocidsSha256 =
		"expectedDocidsSha256" in contract.corpus
			? contract.corpus.expectedDocidsSha256
			: "b".repeat(64);
	const baselinePolicy = fullCorpusEmbeddingExecutionPolicy(
		MIRACL_EMBEDDING_POLICY,
		MIRACL_PASSAGE_COMPOSITION,
		"per-item-v1",
	);
	const baselineResult = {
		benchmark: `miracl-${language}-full-corpus-naia-vector-exact-v1`,
		inputs: {
			language,
			sourceLockSha256,
			documentCount,
			corpusDocidsSha256,
			queryCount: contract.topics.queryCount,
			topicsSha256: contract.topics.sha256,
			qrelsSha256: contract.qrels.sha256,
		},
		trecSha256: "c".repeat(64),
		ingestion: { lastChunkReceiptSha256: "e".repeat(64) },
		configuration: {
			embedding: MIRACL_EMBEDDING_POLICY,
			passageComposition: MIRACL_PASSAGE_COMPOSITION,
			embeddingInferenceMode: "per-item-v1",
			embeddingExecutionPolicySha256: baselinePolicy.embeddingPolicySha256,
			collectionName: miraclExecutionNamespace(
				language,
				sourceLockSha256,
				baselinePolicy.embeddingPolicySha256,
			),
			vectorStore: "Qdrant",
			distance: "Cosine",
			exactSearch: true,
			topK: 100,
			cpuOnly: true,
		},
	} as unknown as MultilingualFullCorpusResult;
	const baselineResultBytes = bytes(baselineResult);
	const sourceReceipt =
		language === "ar"
			? miraclSourceLockReceipt(language, [
					{ ...contract.topics, provider: "dataset" },
					{ ...contract.qrels, provider: "dataset" },
					...arabicCorpus.map(([name, size, sha256]) => ({
						path: `${contract.corpus.directory}/${name}`,
						size,
						sha256,
						provider: "corpus" as const,
					})),
				])
			: {
					schemaVersion: 1,
					language,
					sourceLockSha256,
				};
	const sourceReceiptBytes = bytes(sourceReceipt);
	const preflight = {
		schemaVersion: 1,
		artifactClass: "preflight-probe-evidence",
		benchmark: `naia-${language}-per-item-vs-true-batch-vector-probe-v1`,
		language,
		claimBoundary: MULTILINGUAL_TRUE_BATCH_CLAIM_BOUNDARY,
		policyBasisMode: "per-item-v1",
		model: MULTILINGUAL_TRUE_BATCH_MODEL,
		modelRevision: MULTILINGUAL_TRUE_BATCH_MODEL_REVISION,
		inputSha256: multilingualEquivalenceInputSha256(language),
		policySha256: baselinePolicy.embeddingPolicySha256,
		dimensions: MIRACL_EMBEDDING_POLICY.dimensions,
		thresholds: MULTILINGUAL_TRUE_BATCH_THRESHOLDS,
		observed: { maxAbsoluteDelta: 0, minimumCosine: 1 },
		checks: { maximumAbsoluteDelta: true, minimumCosine: true },
		producerSourceSha256: "a".repeat(64),
		verdict: "PASS",
	};
	const completion = {
		schemaVersion: "naia-memory-miracl-multilingual-completion-evidence-v1",
		verdict: "LOCAL_PASS",
		assurance: "self-observed-local",
		publicClaimEligible: false,
		language,
		benchmark: baselineResult.benchmark,
		identity: { sourceLockSha256 },
		artifacts: {
			result: {
				path: `reports/quality/miracl-${language}-full-corpus-vector-exact.json`,
				sha256: sha256Bytes(baselineResultBytes),
			},
			trec: { sha256: baselineResult.trecSha256 },
			topics: { sha256: baselineResult.inputs.topicsSha256 },
			qrels: { sha256: baselineResult.inputs.qrelsSha256 },
			sourceReceipt: { sha256: sha256Bytes(sourceReceiptBytes) },
			checkpointChain: {
				documentCount: baselineResult.inputs.documentCount,
				docidsSha256: baselineResult.inputs.corpusDocidsSha256,
				lastChunkReceiptSha256: baselineResult.ingestion.lastChunkReceiptSha256,
			},
		},
		runtime: { cpuOnly: true },
	};
	return {
		language,
		preflight,
		preflightBytes: bytes(preflight),
		completion,
		completionBytes: bytes(completion),
		baselineResult,
		baselineResultBytes,
		sourceReceipt,
		sourceReceiptBytes,
		expectedProducerSourceSha256: preflight.producerSourceSha256,
		expectedPolicySha256: baselinePolicy.embeddingPolicySha256,
		expectedEvaluationSourceSha256: "f".repeat(64),
	};
}

describe("multilingual true-batch candidate authorization", () => {
	it("binds Arabic preflight and completed baseline to an isolated candidate", () => {
		const language = "ar";
		const input = fixtures(language);
		const authorization = authorizeMultilingualTrueBatchCandidate(input);
		expect(authorization.verdict).toBe("AUTHORIZED");
		expect(authorization.language).toBe(language);
		expect(authorization.candidate.cpuOnly).toBe(true);
		expect(authorization.candidate.outputPath).toContain(`miracl-${language}-`);
		expect(authorization.candidate.collectionName).not.toBe(
			input.baselineResult.configuration.collectionName,
		);
		expect(authorization.claimBoundary).toContain("no retrieval-quality");
	});

	it("keeps English fail-closed until its corpus identity is qualified", () => {
		const input = fixtures("en", "d".repeat(64));
		expect(() => authorizeMultilingualTrueBatchCandidate(input)).toThrow(
			"en corpus identity is not qualified",
		);
	});

	it("rejects a cross-language preflight substitution", () => {
		const input = fixtures("ar");
		const preflight = {
			...input.preflight,
			language: "en",
			benchmark: "naia-en-per-item-vs-true-batch-vector-probe-v1",
		};
		expect(() =>
			authorizeMultilingualTrueBatchCandidate({
				...input,
				preflight,
				preflightBytes: bytes(preflight),
			}),
		).toThrow("completed ar true-batch preflight PASS is required");
	});

	it("rejects a probe PASS without completed full-corpus evidence", () => {
		const input = fixtures("ar");
		const completion = { ...input.completion, verdict: "PENDING" };
		expect(() =>
			authorizeMultilingualTrueBatchCandidate({
				...input,
				completion,
				completionBytes: bytes(completion),
			}),
		).toThrow("completed ar per-item full-corpus evidence is required");
	});

	it("rejects a candidate-mode result presented as the baseline", () => {
		const input = fixtures("ar");
		const baselineResult = structuredClone(input.baselineResult);
		baselineResult.configuration.embeddingInferenceMode =
			"padded-array-batch-v1";
		const baselineResultBytes = bytes(baselineResult);
		const completion = structuredClone(input.completion);
		completion.artifacts.result.sha256 = sha256Bytes(baselineResultBytes);
		expect(() =>
			authorizeMultilingualTrueBatchCandidate({
				...input,
				baselineResult,
				baselineResultBytes,
				completion,
				completionBytes: bytes(completion),
			}),
		).toThrow("ar baseline result identity mismatch");
	});

	it("rejects non-canonical evidence bytes", () => {
		const input = fixtures("ar");
		expect(() =>
			authorizeMultilingualTrueBatchCandidate({
				...input,
				preflightBytes: Buffer.from(JSON.stringify(input.preflight)),
			}),
		).toThrow("preflight evidence bytes are not canonical or do not match");
	});

	it("rejects retrieval-critical baseline drift despite matching evidence hashes", () => {
		const input = fixtures("ar");
		const baselineResult = structuredClone(input.baselineResult);
		baselineResult.configuration.topK = 10;
		const baselineResultBytes = bytes(baselineResult);
		const completion = structuredClone(input.completion);
		completion.artifacts.result.sha256 = sha256Bytes(baselineResultBytes);
		expect(() =>
			authorizeMultilingualTrueBatchCandidate({
				...input,
				baselineResult,
				baselineResultBytes,
				completion,
				completionBytes: bytes(completion),
			}),
		).toThrow("ar baseline result identity mismatch");
	});

	it("rejects a preflight produced by an unbound implementation", () => {
		const input = fixtures("ar");
		expect(() =>
			authorizeMultilingualTrueBatchCandidate({
				...input,
				expectedProducerSourceSha256: "f".repeat(64),
			}),
		).toThrow("completed ar true-batch preflight PASS is required");
	});

	it("rejects a PASS over substituted probe inputs or policy", () => {
		const input = fixtures("ar");
		const preflight = {
			...input.preflight,
			inputSha256: "f".repeat(64),
			policySha256: "e".repeat(64),
		};
		expect(() =>
			authorizeMultilingualTrueBatchCandidate({
				...input,
				preflight,
				preflightBytes: bytes(preflight),
			}),
		).toThrow("completed ar true-batch preflight PASS is required");
	});

	it("rejects a forged retrieval hash even when result bytes are rebound", () => {
		const input = fixtures("ar");
		const baselineResult = structuredClone(input.baselineResult);
		baselineResult.trecSha256 = "f".repeat(64);
		const baselineResultBytes = bytes(baselineResult);
		const completion = structuredClone(input.completion);
		completion.artifacts.result.sha256 = sha256Bytes(baselineResultBytes);
		expect(() =>
			authorizeMultilingualTrueBatchCandidate({
				...input,
				baselineResult,
				baselineResultBytes,
				completion,
				completionBytes: bytes(completion),
			}),
		).toThrow("ar baseline result identity mismatch");
	});

	it("rejects a source receipt that is not the locked corpus manifest", () => {
		const input = fixtures("ar");
		const sourceReceipt = structuredClone(input.sourceReceipt) as {
			files: Array<{ sha256: string }>;
		};
		const corpusFile = sourceReceipt.files[2];
		if (!corpusFile) throw new Error("Arabic corpus fixture is incomplete");
		corpusFile.sha256 = "f".repeat(64);
		expect(() =>
			authorizeMultilingualTrueBatchCandidate({
				...input,
				sourceReceipt,
				sourceReceiptBytes: bytes(sourceReceipt),
			}),
		).toThrow();
	});

	it("rejects malformed baseline structures with a controlled error", () => {
		const input = fixtures("ar");
		const baselineResult = {} as MultilingualFullCorpusResult;
		const baselineResultBytes = bytes(baselineResult);
		const completion = structuredClone(input.completion);
		completion.artifacts.result.sha256 = sha256Bytes(baselineResultBytes);
		expect(() =>
			authorizeMultilingualTrueBatchCandidate({
				...input,
				baselineResult,
				baselineResultBytes,
				completion,
				completionBytes: bytes(completion),
			}),
		).toThrow("ar baseline result is malformed");
	});

	it("rejects a vacuous missing ingestion and checkpoint chain", () => {
		const input = fixtures("ar");
		const { ingestion: _ingestion, ...baselineResult } = structuredClone(
			input.baselineResult,
		);
		const baselineResultBytes = bytes(baselineResult);
		const clonedCompletion = structuredClone(input.completion);
		const { checkpointChain: _checkpointChain, ...artifacts } =
			clonedCompletion.artifacts;
		const completion = { ...clonedCompletion, artifacts };
		completion.artifacts.result.sha256 = sha256Bytes(baselineResultBytes);
		expect(() =>
			authorizeMultilingualTrueBatchCandidate({
				...input,
				baselineResult: baselineResult as MultilingualFullCorpusResult,
				baselineResultBytes,
				completion,
				completionBytes: bytes(completion),
			}),
		).toThrow("ar baseline result is malformed");
	});

	it("enforces the exact authorization again at launch time", () => {
		const directory = mkdtempSync(join(tmpdir(), "naia-miracl-auth-"));
		try {
			const input = fixtures("ar");
			const expected = expectedMultilingualTrueBatchIdentity(process.cwd());
			input.preflight.producerSourceSha256 = expected.producerSourceSha256;
			input.preflight.policySha256 = expected.policySha256;
			input.preflightBytes = bytes(input.preflight);
			input.expectedProducerSourceSha256 = expected.producerSourceSha256;
			input.expectedPolicySha256 = expected.policySha256;
			input.expectedEvaluationSourceSha256 = sha256Bytes(
				readFileSync(
					join(
						process.cwd(),
						"src/benchmark/quality/native-full-corpus-evaluation-cli.ts",
					),
				),
			);
			const authorization = authorizeMultilingualTrueBatchCandidate(input);
			const paths = {
				preflight: join(directory, "preflight.json"),
				completion: join(directory, "completion.json"),
				baseline: join(directory, "baseline.json"),
				sourceReceipt: join(directory, "source-receipt.json"),
				authorization: join(directory, "authorization.json"),
			};
			writeFileSync(paths.preflight, input.preflightBytes);
			writeFileSync(paths.completion, input.completionBytes);
			writeFileSync(paths.baseline, input.baselineResultBytes);
			writeFileSync(paths.sourceReceipt, input.sourceReceiptBytes);
			writeFileSync(paths.authorization, bytes(authorization));
			const environment = {
				MIRACL_MULTILINGUAL_PREFLIGHT: paths.preflight,
				MIRACL_MULTILINGUAL_COMPLETION: paths.completion,
				MIRACL_MULTILINGUAL_BASELINE: paths.baseline,
				MIRACL_SOURCE_RECEIPT: paths.sourceReceipt,
				MIRACL_MULTILINGUAL_AUTHORIZATION: paths.authorization,
			};
			expect(() =>
				verifyMultilingualTrueBatchAuthorizationFiles(
					"ar",
					environment,
					process.cwd(),
				),
			).not.toThrow();
			expect(() =>
				verifyMultilingualTrueBatchAuthorizationFiles(
					"ar",
					{ ...environment, MIRACL_FULL_OUTPUT: join(directory, "drift.json") },
					process.cwd(),
				),
			).toThrow("multilingual true-batch launch parameters mismatch");
			writeFileSync(
				paths.authorization,
				bytes({ ...authorization, language: "en" }),
			);
			expect(() =>
				verifyMultilingualTrueBatchAuthorizationFiles(
					"ar",
					environment,
					process.cwd(),
				),
			).toThrow("multilingual true-batch authorization mismatch");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
