import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MiraclEvidenceLanguage } from "./miracl-multilingual-contract.js";
import {
	MIRACL_MULTILINGUAL_CONTRACT,
	miraclExecutionNamespace,
} from "./miracl-multilingual-contract.js";
import {
	miraclSourceRoot,
	parseMiraclSourceLockReceipt,
} from "./miracl-multilingual-download.js";
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

interface PreflightEvidence {
	schemaVersion?: unknown;
	artifactClass?: unknown;
	benchmark?: unknown;
	language?: unknown;
	claimBoundary?: unknown;
	policyBasisMode?: unknown;
	model?: unknown;
	modelRevision?: unknown;
	producerSourceSha256?: unknown;
	inputSha256?: unknown;
	policySha256?: unknown;
	dimensions?: unknown;
	thresholds?: { maximumAbsoluteDelta?: unknown; minimumCosine?: unknown };
	observed?: { maxAbsoluteDelta?: unknown; minimumCosine?: unknown };
	checks?: { maximumAbsoluteDelta?: unknown; minimumCosine?: unknown };
	verdict?: unknown;
}

interface CompletionEvidence {
	schemaVersion?: unknown;
	verdict?: unknown;
	assurance?: unknown;
	publicClaimEligible?: unknown;
	language?: unknown;
	benchmark?: unknown;
	identity?: { sourceLockSha256?: unknown };
	artifacts?: {
		result?: { path?: unknown; sha256?: unknown };
		trec?: { sha256?: unknown };
		topics?: { sha256?: unknown };
		qrels?: { sha256?: unknown };
		sourceReceipt?: { sha256?: unknown };
		checkpointChain?: {
			documentCount?: unknown;
			docidsSha256?: unknown;
			lastChunkReceiptSha256?: unknown;
		};
	};
	runtime?: { cpuOnly?: unknown };
}

function canonical(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function requireCanonical(
	value: unknown,
	bytes: Uint8Array,
	name: string,
): void {
	if (sha256Bytes(bytes) !== sha256Bytes(canonical(value)))
		throw new Error(`${name} bytes are not canonical or do not match`);
}

export function authorizeMultilingualTrueBatchCandidate(input: {
	language: MultilingualTrueBatchLanguage;
	preflight: PreflightEvidence;
	preflightBytes: Uint8Array;
	completion: CompletionEvidence;
	completionBytes: Uint8Array;
	baselineResult: MultilingualFullCorpusResult;
	baselineResultBytes: Uint8Array;
	sourceReceipt: unknown;
	sourceReceiptBytes: Uint8Array;
	expectedProducerSourceSha256: string;
	expectedPolicySha256: string;
	expectedEvaluationSourceSha256: string;
}) {
	const { language } = input;
	if (language !== "ar" && language !== "en")
		throw new Error("multilingual true-batch language must be ar or en");
	requireCanonical(input.preflight, input.preflightBytes, "preflight evidence");
	requireCanonical(
		input.completion,
		input.completionBytes,
		"completion evidence",
	);
	requireCanonical(
		input.baselineResult,
		input.baselineResultBytes,
		"baseline result",
	);
	requireCanonical(
		input.sourceReceipt,
		input.sourceReceiptBytes,
		"source receipt",
	);
	const contract = MIRACL_MULTILINGUAL_CONTRACT[language];
	if (
		input.preflight.schemaVersion !== 1 ||
		input.preflight.artifactClass !== "preflight-probe-evidence" ||
		input.preflight.benchmark !==
			`naia-${language}-per-item-vs-true-batch-vector-probe-v1` ||
		input.preflight.language !== language ||
		input.preflight.claimBoundary !== MULTILINGUAL_TRUE_BATCH_CLAIM_BOUNDARY ||
		input.preflight.policyBasisMode !== "per-item-v1" ||
		input.preflight.model !== MULTILINGUAL_TRUE_BATCH_MODEL ||
		input.preflight.modelRevision !== MULTILINGUAL_TRUE_BATCH_MODEL_REVISION ||
		input.preflight.inputSha256 !==
			multilingualEquivalenceInputSha256(language) ||
		!/^[a-f0-9]{64}$/.test(input.expectedPolicySha256) ||
		input.preflight.policySha256 !== input.expectedPolicySha256 ||
		input.preflight.dimensions !== MIRACL_EMBEDDING_POLICY.dimensions ||
		input.preflight.thresholds?.maximumAbsoluteDelta !==
			MULTILINGUAL_TRUE_BATCH_THRESHOLDS.maximumAbsoluteDelta ||
		input.preflight.thresholds?.minimumCosine !==
			MULTILINGUAL_TRUE_BATCH_THRESHOLDS.minimumCosine ||
		typeof input.preflight.observed?.maxAbsoluteDelta !== "number" ||
		!Number.isFinite(input.preflight.observed.maxAbsoluteDelta) ||
		input.preflight.observed.maxAbsoluteDelta < 0 ||
		input.preflight.observed.maxAbsoluteDelta >
			MULTILINGUAL_TRUE_BATCH_THRESHOLDS.maximumAbsoluteDelta ||
		typeof input.preflight.observed?.minimumCosine !== "number" ||
		!Number.isFinite(input.preflight.observed.minimumCosine) ||
		input.preflight.observed.minimumCosine <
			MULTILINGUAL_TRUE_BATCH_THRESHOLDS.minimumCosine ||
		input.preflight.observed.minimumCosine > 1 ||
		input.preflight.checks?.maximumAbsoluteDelta !== true ||
		input.preflight.checks?.minimumCosine !== true ||
		!/^[a-f0-9]{64}$/.test(input.expectedProducerSourceSha256) ||
		!/^[a-f0-9]{64}$/.test(input.expectedEvaluationSourceSha256) ||
		input.preflight.producerSourceSha256 !==
			input.expectedProducerSourceSha256 ||
		input.preflight.verdict !== "PASS"
	)
		throw new Error(
			`completed ${language} true-batch preflight PASS is required`,
		);
	const benchmark = `miracl-${language}-full-corpus-naia-vector-exact-v1`;
	const baselineSha256 = sha256Bytes(input.baselineResultBytes);
	if (
		input.completion.schemaVersion !==
			"naia-memory-miracl-multilingual-completion-evidence-v1" ||
		input.completion.verdict !== "LOCAL_PASS" ||
		input.completion.assurance !== "self-observed-local" ||
		input.completion.publicClaimEligible !== false ||
		input.completion.language !== language ||
		input.completion.benchmark !== benchmark ||
		input.completion.runtime?.cpuOnly !== true ||
		input.completion.artifacts?.result?.sha256 !== baselineSha256
	)
		throw new Error(
			`completed ${language} per-item full-corpus evidence is required`,
		);
	const baseline = input.baselineResult;
	const expectedSourceLock =
		"expectedSourceLockSha256" in contract.corpus
			? contract.corpus.expectedSourceLockSha256
			: undefined;
	const expectedDocumentCount =
		"expectedDocumentCount" in contract.corpus
			? contract.corpus.expectedDocumentCount
			: undefined;
	const expectedDocidsSha256 =
		"expectedDocidsSha256" in contract.corpus
			? contract.corpus.expectedDocidsSha256
			: undefined;
	if (!expectedSourceLock || !expectedDocumentCount || !expectedDocidsSha256)
		throw new Error(`${language} corpus identity is not qualified`);
	const sourceReceipt = parseMiraclSourceLockReceipt(
		language,
		input.sourceReceipt,
	);
	if (
		typeof baseline !== "object" ||
		baseline === null ||
		typeof baseline.inputs !== "object" ||
		baseline.inputs === null ||
		typeof baseline.configuration !== "object" ||
		baseline.configuration === null ||
		typeof baseline.ingestion !== "object" ||
		baseline.ingestion === null
	)
		throw new Error(`${language} baseline result is malformed`);
	if (
		baseline.benchmark !== benchmark ||
		baseline.inputs.language !== language ||
		baseline.inputs.sourceLockSha256 !== expectedSourceLock ||
		baseline.inputs.documentCount !== expectedDocumentCount ||
		baseline.inputs.corpusDocidsSha256 !== expectedDocidsSha256 ||
		baseline.inputs.queryCount !== contract.topics.queryCount ||
		baseline.inputs.topicsSha256 !== contract.topics.sha256 ||
		baseline.inputs.qrelsSha256 !== contract.qrels.sha256 ||
		!/^[a-f0-9]{64}$/.test(baseline.trecSha256) ||
		typeof baseline.ingestion.lastChunkReceiptSha256 !== "string" ||
		!/^[a-f0-9]{64}$/.test(baseline.ingestion.lastChunkReceiptSha256) ||
		sourceReceipt.sourceLockSha256 !== expectedSourceLock ||
		input.completion.artifacts?.sourceReceipt?.sha256 !==
			sha256Bytes(input.sourceReceiptBytes) ||
		input.completion.artifacts?.trec?.sha256 !== baseline.trecSha256 ||
		input.completion.artifacts?.topics?.sha256 !==
			baseline.inputs.topicsSha256 ||
		input.completion.artifacts?.qrels?.sha256 !== baseline.inputs.qrelsSha256 ||
		input.completion.artifacts?.checkpointChain?.documentCount !==
			baseline.inputs.documentCount ||
		input.completion.artifacts?.checkpointChain?.docidsSha256 !==
			baseline.inputs.corpusDocidsSha256 ||
		input.completion.artifacts?.checkpointChain?.lastChunkReceiptSha256 !==
			baseline.ingestion.lastChunkReceiptSha256 ||
		input.completion.identity?.sourceLockSha256 !== expectedSourceLock ||
		input.completion.artifacts?.result?.path !==
			`reports/quality/miracl-${language}-full-corpus-vector-exact.json` ||
		JSON.stringify(baseline.configuration.embedding) !==
			JSON.stringify(MIRACL_EMBEDDING_POLICY) ||
		baseline.configuration.passageComposition !== MIRACL_PASSAGE_COMPOSITION ||
		baseline.configuration.embeddingInferenceMode !== "per-item-v1" ||
		baseline.configuration.vectorStore !== "Qdrant" ||
		baseline.configuration.distance !== "Cosine" ||
		baseline.configuration.exactSearch !== true ||
		baseline.configuration.topK !== 100 ||
		baseline.configuration.cpuOnly !== true
	)
		throw new Error(`${language} baseline result identity mismatch`);
	const baselinePolicy = fullCorpusEmbeddingExecutionPolicy(
		MIRACL_EMBEDDING_POLICY,
		MIRACL_PASSAGE_COMPOSITION,
		"per-item-v1",
	);
	if (
		baseline.configuration.embeddingExecutionPolicySha256 !==
			baselinePolicy.embeddingPolicySha256 ||
		baseline.configuration.collectionName !==
			miraclExecutionNamespace(
				language as MiraclEvidenceLanguage,
				expectedSourceLock,
				baselinePolicy.embeddingPolicySha256,
			)
	)
		throw new Error(`${language} baseline execution policy mismatch`);
	const candidatePolicy = fullCorpusEmbeddingExecutionPolicy(
		MIRACL_EMBEDDING_POLICY,
		MIRACL_PASSAGE_COMPOSITION,
		"padded-array-batch-v1",
	);
	return {
		schemaVersion: 1 as const,
		verdict: "AUTHORIZED" as const,
		language,
		claimBoundary:
			"authorizes one language-scoped full-corpus candidate experiment; establishes no retrieval-quality, throughput, or public-comparison claim",
		prerequisites: {
			preflightEvidenceSha256: sha256Bytes(input.preflightBytes),
			completionEvidenceSha256: sha256Bytes(input.completionBytes),
			baselineResultSha256: baselineSha256,
			sourceLockSha256: expectedSourceLock,
		},
		candidate: {
			evaluationSourceSha256: input.expectedEvaluationSourceSha256,
			embeddingInferenceMode: "padded-array-batch-v1" as const,
			embeddingExecutionPolicySha256: candidatePolicy.embeddingPolicySha256,
			collectionName: miraclExecutionNamespace(
				language as MiraclEvidenceLanguage,
				expectedSourceLock,
				candidatePolicy.embeddingPolicySha256,
			),
			outputPath: `reports/quality/miracl-${language}-full-corpus-vector-exact-true-batch.json`,
			checkpointDirectory: `.cache/benchmark-runs/miracl-${language}-full-true-batch-v1`,
			cpuOnly: true as const,
		},
	};
}

function parseJson(bytes: Uint8Array, name: string): unknown {
	try {
		return JSON.parse(Buffer.from(bytes).toString("utf8"));
	} catch {
		throw new Error(`${name} is invalid JSON`);
	}
}

export function verifyMultilingualTrueBatchAuthorizationFiles(
	language: MultilingualTrueBatchLanguage,
	environment: NodeJS.ProcessEnv,
	root = process.cwd(),
): void {
	const preflightPath =
		environment.MIRACL_MULTILINGUAL_PREFLIGHT ??
		`reports/quality/miracl-${language}-preflight-true-batch/evidence.json`;
	const completionPath =
		environment.MIRACL_MULTILINGUAL_COMPLETION ??
		`reports/quality/miracl-${language}-full-corpus-completion-evidence.json`;
	const baselinePath =
		environment.MIRACL_MULTILINGUAL_BASELINE ??
		`reports/quality/miracl-${language}-full-corpus-vector-exact.json`;
	const sourceReceiptPath =
		environment.MIRACL_SOURCE_RECEIPT ??
		`${miraclSourceRoot(language)}/source-lock-receipt.json`;
	const authorizationPath =
		environment.MIRACL_MULTILINGUAL_AUTHORIZATION ??
		`reports/quality/miracl-${language}-full-corpus-true-batch-authorization.json`;
	const preflightBytes = readFileSync(preflightPath);
	const completionBytes = readFileSync(completionPath);
	const baselineResultBytes = readFileSync(baselinePath);
	const sourceReceiptBytes = readFileSync(sourceReceiptPath);
	const expectedIdentity = expectedMultilingualTrueBatchIdentity(root);
	const expectedEvaluationSourceSha256 = sha256Bytes(
		readFileSync(
			resolve(
				root,
				"src/benchmark/quality/native-full-corpus-evaluation-cli.ts",
			),
		),
	);
	const expected = authorizeMultilingualTrueBatchCandidate({
		language,
		preflight: parseJson(preflightBytes, "multilingual preflight evidence"),
		preflightBytes,
		completion: parseJson(completionBytes, "multilingual completion evidence"),
		completionBytes,
		baselineResult: parseJson(
			baselineResultBytes,
			"multilingual baseline result",
		) as MultilingualFullCorpusResult,
		baselineResultBytes,
		sourceReceipt: parseJson(sourceReceiptBytes, "multilingual source receipt"),
		sourceReceiptBytes,
		expectedProducerSourceSha256: expectedIdentity.producerSourceSha256,
		expectedPolicySha256: expectedIdentity.policySha256,
		expectedEvaluationSourceSha256,
	});
	const actualOutput =
		environment.MIRACL_FULL_OUTPUT ??
		`reports/quality/miracl-${language}-full-corpus-vector-exact-true-batch.json`;
	const actualCheckpointRoot =
		environment.MIRACL_FULL_CHECKPOINT_DIR ??
		`.cache/benchmark-runs/miracl-${language}-full-true-batch-v1`;
	if (
		actualOutput !== expected.candidate.outputPath ||
		actualCheckpointRoot !== expected.candidate.checkpointDirectory
	)
		throw new Error("multilingual true-batch launch parameters mismatch");
	const authorizationBytes = readFileSync(authorizationPath);
	const authorization = parseJson(
		authorizationBytes,
		"multilingual true-batch authorization",
	);
	if (
		sha256Bytes(authorizationBytes) !== sha256Bytes(canonical(authorization)) ||
		canonical(authorization) !== canonical(expected)
	)
		throw new Error("multilingual true-batch authorization mismatch");
}
