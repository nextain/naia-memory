import {
	MIRACL_MULTILINGUAL_CONTRACT,
	type MiraclEvidenceLanguage,
} from "./miracl-multilingual-contract.js";
import {
	EXPECTED_TREC_EVAL_BINARY_SHA256,
	MIRACL_EMBEDDING_POLICY,
	TREC_EVAL_COMMIT,
	TREC_EVAL_VERSION,
	parseTrecEvalAll,
	sha256Bytes,
} from "./native-full-corpus-evidence.js";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";

export const MIRACL_BASELINE_SOURCE = {
	title:
		"MIRACL: A Multilingual Retrieval Dataset Covering 18 Diverse Languages",
	publication:
		"Transactions of the Association for Computational Linguistics 11 (2023), 1114–1131",
	doi: "10.1162/tacl_a_00595",
	table: 5,
	datasetSplit: "MIRACL development set",
	metrics: ["nDCG@10", "Recall@100"],
} as const;

type BaselineClass = "lexical" | "dense" | "hybrid" | "late interaction";
interface BaselineRow {
	system: string;
	ndcgAt10: number;
	recallAt100: number;
	class: BaselineClass;
}

export const MIRACL_HISTORICAL_ROWS = {
	ko: [
		{ system: "BM25", ndcgAt10: 0.419, recallAt100: 0.783, class: "lexical" },
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
		{ system: "BM25", ndcgAt10: 0.351, recallAt100: 0.819, class: "lexical" },
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
		{ system: "BM25", ndcgAt10: 0.481, recallAt100: 0.889, class: "lexical" },
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
} as const satisfies Record<MiraclEvidenceLanguage, readonly BaselineRow[]>;

const PUBLISHED_ROW_ROUNDING_UNIT = 0.001;
const PUBLISHED_ROW_ROUNDING_TOLERANCE = PUBLISHED_ROW_ROUNDING_UNIT / 2;

interface CompletionEvidence {
	schemaVersion?: unknown;
	verdict?: unknown;
	assurance?: unknown;
	publicClaimEligible?: unknown;
	publicClaimRequirement?: unknown;
	claimBoundary?: {
		launchReceipt?: unknown;
		runtimeSnapshot?: unknown;
	};
	language?: unknown;
	benchmark?: unknown;
	identity?: {
		language?: unknown;
		role?: unknown;
		documentCount?: unknown;
		queryCount?: unknown;
		sourceLockSha256?: unknown;
	};
	independentEvaluatorTool?: {
		name?: unknown;
		version?: unknown;
		commit?: unknown;
		binarySha256?: unknown;
		stdout?: unknown;
		stdoutSha256?: unknown;
	};
	metrics?: {
		reproducedByIndependentTool?: { ndcgAt10?: unknown; recallAt100?: unknown };
	};
	runtime?: { cpuOnly?: unknown; qdrant?: { pointsCount?: unknown } };
	artifacts?: {
		checkpointChain?: {
			documentCount?: unknown;
			docidsSha256?: unknown;
		};
		[key: string]: unknown;
	};
	artifactManifestSha256?: unknown;
	implementation?: {
		evaluationSourceSha256?: unknown;
		runtimeMonitorSourceSha256?: unknown;
		artifactStability?: unknown;
	};
}

function metric(value: unknown, name: string): number {
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < 0 ||
		value > 1
	)
		throw new Error(`${name} must be finite and between 0 and 1`);
	return value;
}

export function createMiraclLanguageComparison(evidenceText: string) {
	const evidence = JSON.parse(evidenceText) as CompletionEvidence;
	if (
		evidence.schemaVersion !==
		"naia-memory-miracl-multilingual-completion-evidence-v1"
	)
		throw new Error("completion evidence schema mismatch");
	if (
		evidence.verdict !== "LOCAL_PASS" ||
		evidence.assurance !== "self-observed-local" ||
		evidence.publicClaimEligible !== false ||
		typeof evidence.publicClaimRequirement !== "string" ||
		evidence.publicClaimRequirement.length === 0 ||
		typeof evidence.claimBoundary?.launchReceipt !== "string" ||
		typeof evidence.claimBoundary.runtimeSnapshot !== "string" ||
		typeof evidence.artifacts !== "object" ||
		evidence.artifacts === null ||
		evidence.artifactManifestSha256 !==
			evidenceObjectSha256(evidence.artifacts) ||
		typeof evidence.implementation?.evaluationSourceSha256 !== "string" ||
		!/^[a-f0-9]{64}$/.test(
			evidence.implementation.evaluationSourceSha256 as string,
		) ||
		typeof evidence.implementation.runtimeMonitorSourceSha256 !== "string" ||
		!/^[a-f0-9]{64}$/.test(
			evidence.implementation.runtimeMonitorSourceSha256 as string,
		) ||
		typeof evidence.implementation.artifactStability !== "object" ||
		evidence.implementation.artifactStability === null
	)
		throw new Error(
			"complete non-public LOCAL_PASS completion evidence is required",
		);
	const language = evidence.language;
	if (language !== "ko" && language !== "en" && language !== "ar")
		throw new Error("unsupported comparison language");
	const contract = MIRACL_MULTILINGUAL_CONTRACT[language];
	const documentCount = evidence.identity?.documentCount;
	const expectedDocumentCount =
		"expectedDocumentCount" in contract.corpus
			? contract.corpus.expectedDocumentCount
			: undefined;
	const expectedDocidsSha256 =
		"expectedDocidsSha256" in contract.corpus
			? contract.corpus.expectedDocidsSha256
			: undefined;
	const expectedSourceLockSha256 =
		"expectedSourceLockSha256" in contract.corpus
			? contract.corpus.expectedSourceLockSha256
			: undefined;
	if (
		expectedDocumentCount === undefined ||
		expectedDocidsSha256 === undefined ||
		expectedSourceLockSha256 === undefined
	)
		throw new Error(
			`${language} corpus identity contract is incomplete; comparison is blocked`,
		);
	if (
		evidence.benchmark !==
			`miracl-${language}-full-corpus-naia-vector-exact-v1` ||
		evidence.identity?.language !== language ||
		evidence.identity.role !== contract.role ||
		evidence.identity.queryCount !== contract.topics.queryCount ||
		typeof documentCount !== "number" ||
		!Number.isSafeInteger(documentCount) ||
		documentCount < 1 ||
		documentCount !== expectedDocumentCount ||
		evidence.artifacts?.checkpointChain?.documentCount !== documentCount ||
		evidence.artifacts.checkpointChain.docidsSha256 !== expectedDocidsSha256 ||
		evidence.identity.sourceLockSha256 !== expectedSourceLockSha256
	)
		throw new Error("language-specific benchmark identity mismatch");
	if (
		evidence.runtime?.cpuOnly !== true ||
		evidence.runtime.qdrant?.pointsCount !== documentCount
	)
		throw new Error("full-corpus runtime identity mismatch");
	const tool = evidence.independentEvaluatorTool;
	if (
		tool?.name !== "usnistgov/trec_eval" ||
		tool.version !== TREC_EVAL_VERSION ||
		tool.commit !== TREC_EVAL_COMMIT ||
		tool.binarySha256 !== EXPECTED_TREC_EVAL_BINARY_SHA256 ||
		typeof tool.stdout !== "string" ||
		tool.stdoutSha256 !== sha256Bytes(tool.stdout)
	)
		throw new Error("independent evaluator identity mismatch");
	const parsed = parseTrecEvalAll(tool.stdout);
	const ndcgAt10 = metric(
		evidence.metrics?.reproducedByIndependentTool?.ndcgAt10,
		"nDCG@10",
	);
	const recallAt100 = metric(
		evidence.metrics?.reproducedByIndependentTool?.recallAt100,
		"Recall@100",
	);
	if (
		parsed.get("ndcg_cut_10") !== ndcgAt10 ||
		parsed.get("recall_100") !== recallAt100
	)
		throw new Error("independent evaluator metric mismatch");
	const rows = MIRACL_HISTORICAL_ROWS[language];
	const hybrid = rows.find((row) => row.class === "hybrid");
	if (!hybrid) throw new Error("frozen hybrid baseline is missing");
	const ndcgDelta = ndcgAt10 - hybrid.ndcgAt10;
	const recallDelta = recallAt100 - hybrid.recallAt100;
	const withinPublishedRounding =
		Math.abs(ndcgDelta) <= PUBLISHED_ROW_ROUNDING_TOLERANCE + Number.EPSILON &&
		Math.abs(recallDelta) <= PUBLISHED_ROW_ROUNDING_TOLERANCE + Number.EPSILON;
	const hybridReferenceOutcome = withinPublishedRounding
		? "WITHIN_PUBLISHED_ROUNDING"
		: ndcgDelta >= 0 && recallDelta >= 0
			? "ABOVE_BOTH_REPORTED_METRICS"
			: ndcgDelta >= 0 || recallDelta >= 0
				? "MIXED"
				: "BELOW_BOTH";
	return {
		schemaVersion: "naia-memory-miracl-language-comparison-v1",
		language,
		role: contract.role,
		benchmark: evidence.benchmark,
		sourceEvidenceSha256: sha256Bytes(evidenceText),
		publicClaimEligible: false,
		baselineSource: MIRACL_BASELINE_SOURCE,
		comparisonPolicy: {
			aggregation: "none",
			statement:
				"Each preregistered language is judged independently; no pooled multilingual score is produced.",
			sourceLockSemantics:
				"The source lock identifies the language-specific corpus source receipt, not a shared implementation; it is validated upstream and bound here to the preregistered language contract.",
			publishedRowRoundingUnit: PUBLISHED_ROW_ROUNDING_UNIT,
			publishedRowRoundingTolerance: PUBLISHED_ROW_ROUNDING_TOLERANCE,
		},
		knownLimitations: [
			{
				id: "CROSS_PARADIGM_HYBRID_REFERENCE",
				statement:
					"The system under test is a single-vector dense retriever. hybridReferenceOutcome is only a metric-position result against the stronger published BM25 + mDPR row, not a competitive tier or a like-for-like architecture comparison; dense rows and their deltas are reported separately.",
			},
			{
				id: "MIRACL_TRAIN_SPLIT_MODEL_OVERLAP",
				statement:
					"The base multilingual-e5-large model reports MIRACL training-split use; this dev run is label-free at execution time, not dataset-family zero-shot.",
			},
		],
		notEstablished: [
			"current state of the art",
			"memory-engine superiority",
			"Naia-specific retrieval innovation",
			"statistical significance versus rounded historical rows",
			"cross-language quality beyond this language",
		],
		baseRetriever: {
			model: MIRACL_EMBEDDING_POLICY.model,
			revision: MIRACL_EMBEDDING_POLICY.revision,
			dtype: MIRACL_EMBEDDING_POLICY.dtype,
		},
		metrics: { ndcgAt10, recallAt100 },
		hybridReferenceOutcome,
		denseReferences: rows
			.filter((row) => row.class === "dense")
			.map((row) => ({
				...row,
				deltas: {
					ndcgAt10: ndcgAt10 - row.ndcgAt10,
					recallAt100: recallAt100 - row.recallAt100,
				},
			})),
		rows: rows.map((row) => ({
			...row,
			deltas: {
				ndcgAt10: ndcgAt10 - row.ndcgAt10,
				recallAt100: recallAt100 - row.recallAt100,
			},
		})),
	};
}
