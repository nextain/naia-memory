import {
	EXPECTED_TREC_EVAL_BINARY_SHA256,
	METRIC_TOLERANCE,
	TREC_EVAL_COMMIT,
	TREC_EVAL_VERSION,
	parseTrecEvalAll,
	sha256Bytes,
} from "./native-full-corpus-evidence.js";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";

export const MIRACL_KO_HISTORICAL_ROWS = [
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
		system: "in-language retriever",
		ndcgAt10: 0.472,
		recallAt100: 0.807,
		class: "dense",
	},
] as const;

const BENCHMARK = "miracl-ko-full-corpus-naia-vector-exact-v1";
const HYBRID = MIRACL_KO_HISTORICAL_ROWS[2];
const HISTORICAL_ROW_RESOLUTION = 0.001;

interface ComparisonReceipt {
	schemaVersion?: unknown;
	verdict?: unknown;
	publicClaimEligible?: unknown;
	benchmark?: unknown;
	attestationBinding?: {
		manifests?: Record<string, unknown>;
		hashes?: Record<string, unknown>;
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
		inProcess?: { ndcgAt10?: unknown; recallAt100?: unknown };
		reproducedByIndependentTool?: {
			ndcgAt10?: unknown;
			recallAt100?: unknown;
		};
		deltas?: { ndcgAt10?: unknown; recallAt100?: unknown };
		tolerance?: unknown;
	};
}

const BINDING_FIELDS = [
	["dataset", "datasetSha256"],
	["protocol", "protocolSha256"],
	["implementation", "implementationArtifactSha256"],
	["configuration", "configurationSha256"],
	["executionEvidence", "executionEvidenceSha256"],
] as const;

function finiteMetric(value: unknown, name: string): number {
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < 0 ||
		value > 1
	)
		throw new Error(`${name} must be finite and between 0 and 1`);
	return value;
}

function validateReceiptProvenance(receipt: ComparisonReceipt) {
	const manifests = receipt.attestationBinding?.manifests;
	const hashes = receipt.attestationBinding?.hashes;
	if (!manifests || !hashes) throw new Error("attestation binding is required");
	for (const [manifestField, hashField] of BINDING_FIELDS) {
		if (
			manifests[manifestField] === undefined ||
			hashes[hashField] !== evidenceObjectSha256(manifests[manifestField])
		)
			throw new Error(`attestation binding mismatch: ${manifestField}`);
	}
	const tool = receipt.independentEvaluatorTool;
	if (
		tool?.name !== "usnistgov/trec_eval" ||
		tool.version !== TREC_EVAL_VERSION ||
		tool.commit !== TREC_EVAL_COMMIT ||
		tool.binarySha256 !== EXPECTED_TREC_EVAL_BINARY_SHA256
	)
		throw new Error("independent evaluator identity mismatch");
	if (
		typeof tool.stdout !== "string" ||
		tool.stdoutSha256 !== sha256Bytes(tool.stdout)
	)
		throw new Error("independent evaluator stdout mismatch");
	return parseTrecEvalAll(tool.stdout);
}

export function createMiraclGlobalComparison(receiptText: string) {
	const receipt = JSON.parse(receiptText) as ComparisonReceipt;
	if (receipt.schemaVersion !== 3) throw new Error("receipt schema mismatch");
	if (receipt.benchmark !== BENCHMARK)
		throw new Error("receipt benchmark mismatch");
	if (receipt.verdict !== "LOCAL_PASS")
		throw new Error("LOCAL_PASS receipt is required");
	if (receipt.publicClaimEligible !== false)
		throw new Error(
			"local comparison receipt must not be public-claim eligible",
		);
	const reproduced = validateReceiptProvenance(receipt);
	const ndcgAt10 = finiteMetric(
		receipt.metrics?.reproducedByIndependentTool?.ndcgAt10,
		"independently reproduced nDCG@10",
	);
	const recallAt100 = finiteMetric(
		receipt.metrics?.reproducedByIndependentTool?.recallAt100,
		"independently reproduced Recall@100",
	);
	if (
		reproduced.get("ndcg_cut_10") !== ndcgAt10 ||
		reproduced.get("recall_100") !== recallAt100
	)
		throw new Error("independent evaluator metric mismatch");
	const inProcessNdcg = finiteMetric(
		receipt.metrics?.inProcess?.ndcgAt10,
		"in-process nDCG@10",
	);
	const inProcessRecall = finiteMetric(
		receipt.metrics?.inProcess?.recallAt100,
		"in-process Recall@100",
	);
	const deltaNdcg = finiteMetric(
		receipt.metrics?.deltas?.ndcgAt10,
		"nDCG@10 reproduction delta",
	);
	const deltaRecall = finiteMetric(
		receipt.metrics?.deltas?.recallAt100,
		"Recall@100 reproduction delta",
	);
	if (
		receipt.metrics?.tolerance !== METRIC_TOLERANCE ||
		deltaNdcg !== Math.abs(inProcessNdcg - ndcgAt10) ||
		deltaRecall !== Math.abs(inProcessRecall - recallAt100) ||
		deltaNdcg > METRIC_TOLERANCE ||
		deltaRecall > METRIC_TOLERANCE
	)
		throw new Error("independent metric reproduction mismatch");
	const ndcgDelta = ndcgAt10 - HYBRID.ndcgAt10;
	const recallDelta = recallAt100 - HYBRID.recallAt100;
	const withinPublishedResolution =
		Math.abs(ndcgDelta) <= HISTORICAL_ROW_RESOLUTION + Number.EPSILON &&
		Math.abs(recallDelta) <= HISTORICAL_ROW_RESOLUTION + Number.EPSILON;
	const ndcgMatches = ndcgDelta >= 0;
	const recallMatches = recallDelta >= 0;
	const hybridTier = withinPublishedResolution
		? "WITHIN_HISTORICAL_ROW_RESOLUTION"
		: ndcgMatches && recallMatches
			? "MATCHES_OR_EXCEEDS_BOTH"
			: ndcgMatches || recallMatches
				? "MIXED"
				: "BELOW_BOTH";
	return {
		schemaVersion: 1,
		benchmark: BENCHMARK,
		sourceReceiptSha256: sha256Bytes(receiptText),
		publicClaimEligible: false,
		comparisonScope:
			"historical protocol-matched MIRACL Korean development retrieval rows only",
		evidenceIdentity: {
			datasetSha256: receipt.attestationBinding?.hashes?.datasetSha256,
			protocolSha256: receipt.attestationBinding?.hashes?.protocolSha256,
			implementationArtifactSha256:
				receipt.attestationBinding?.hashes?.implementationArtifactSha256,
			configurationSha256:
				receipt.attestationBinding?.hashes?.configurationSha256,
			executionEvidenceSha256:
				receipt.attestationBinding?.hashes?.executionEvidenceSha256,
		},
		notEstablished: [
			"receipt authenticity outside the local operator trust boundary",
			"current state of the art",
			"memory-engine superiority",
			"Naia-specific retrieval innovation",
			"multilingual quality",
			"statistical significance versus historical rows",
		],
		interpretationThreshold:
			"Beating BM25 or mDPR alone is not a publishable differentiator. Differences no larger than 0.001 on both metrics are within the resolution of the three-decimal historical row. Exceeding that resolution on both metrics is a strong base retrieval result, not a Naia-specific innovation.",
		metrics: { ndcgAt10, recallAt100 },
		hybridTier,
		rows: MIRACL_KO_HISTORICAL_ROWS.map((row) => ({
			...row,
			deltas: {
				ndcgAt10: ndcgAt10 - row.ndcgAt10,
				recallAt100: recallAt100 - row.recallAt100,
			},
		})),
	};
}
