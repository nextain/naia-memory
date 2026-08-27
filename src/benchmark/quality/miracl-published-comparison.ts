import { createMiraclGlobalComparison } from "./miracl-global-comparison.js";
import {
	MIRACL_FULL_BENCHMARK,
	sha256Bytes,
} from "./native-full-corpus-evidence.js";
import { canonicalEvidenceJson } from "./public-evidence-crypto.js";

type PublicVerdict = {
	schemaVersion?: unknown;
	assuranceModel?: unknown;
	publicationGateEligible?: unknown;
	verdict?: unknown;
	publicClaimEligible?: unknown;
	baseReceipt?: { sha256?: unknown; verdict?: unknown; assurance?: unknown };
	binding?: { engine?: unknown; receiptSha256?: unknown };
	failures?: unknown;
	verificationBundle?: {
		manifestSha256?: unknown;
		artifactSha256?: { receipt?: unknown };
	};
	bundlePublication?: { manifestSha256?: unknown };
};

function object(value: unknown, label: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new Error(`${label} must be an object`);
	return value as Record<string, unknown>;
}

export function createMiraclPublishedComparison(input: {
	receiptText: string;
	comparisonText: string;
	verifiedPublishedVerdict: PublicVerdict;
}) {
	const receiptSha256 = sha256Bytes(input.receiptText);
	const expectedComparison = createMiraclGlobalComparison(input.receiptText);
	let suppliedComparison: unknown;
	try {
		suppliedComparison = JSON.parse(input.comparisonText);
	} catch {
		throw new Error("historical comparison is not valid JSON");
	}
	object(suppliedComparison, "historical comparison");
	if (
		canonicalEvidenceJson(suppliedComparison) !==
		canonicalEvidenceJson(expectedComparison)
	)
		throw new Error(
			"historical comparison does not match receipt recomputation",
		);
	const verdict = input.verifiedPublishedVerdict;
	if (
		verdict.schemaVersion !== 2 ||
		verdict.assuranceModel !==
			"trusted-runner-signature-with-rfc3161-chronology" ||
		verdict.verdict !== "TIMESTAMP_QUALIFIED_PUBLIC_ATTESTATION_PASS" ||
		verdict.publicationGateEligible !== true ||
		verdict.publicClaimEligible !== true ||
		!Array.isArray(verdict.failures) ||
		verdict.failures.length !== 0
	)
		throw new Error("timestamp-qualified public attestation is required");
	if (
		verdict.baseReceipt?.sha256 !== receiptSha256 ||
		verdict.baseReceipt.verdict !== "LOCAL_PASS" ||
		verdict.baseReceipt.assurance !== "self-observed-local" ||
		verdict.binding?.receiptSha256 !== receiptSha256 ||
		verdict.binding.engine !== MIRACL_FULL_BENCHMARK
	)
		throw new Error("public attestation receipt binding mismatch");
	const verificationBundle = object(
		verdict.verificationBundle,
		"verified bundle evidence",
	);
	const bundlePublication = object(
		verdict.bundlePublication,
		"verified bundle publication evidence",
	);
	const artifactSha256 = object(
		verificationBundle.artifactSha256,
		"verified bundle artifact digests",
	);
	if (artifactSha256.receipt !== receiptSha256)
		throw new Error("verified bundle receipt digest mismatch");
	if (
		typeof verificationBundle.manifestSha256 !== "string" ||
		bundlePublication.manifestSha256 !== verificationBundle.manifestSha256
	)
		throw new Error("bundle publication manifest binding mismatch");

	return {
		schemaVersion: 1,
		benchmark: MIRACL_FULL_BENCHMARK,
		verdict: "HISTORICAL_COMPARISON_PUBLICATION_PASS",
		publicClaimEligible: true,
		eligibleClaimScope:
			"protocol-matched historical MIRACL Korean development retrieval comparison only",
		notEstablished: expectedComparison.notEstablished.filter(
			(item) =>
				item !==
				"receipt authenticity outside the local operator trust boundary",
		),
		interpretationThreshold: expectedComparison.interpretationThreshold,
		evidenceIdentity: expectedComparison.evidenceIdentity,
		baseRetriever: expectedComparison.baseRetriever,
		retrievalProtocol: expectedComparison.retrievalProtocol,
		provenanceBoundary: expectedComparison.provenanceBoundary,
		knownLimitations: expectedComparison.knownLimitations,
		sourceReceiptSha256: receiptSha256,
		comparisonSha256: sha256Bytes(input.comparisonText),
		attestation: {
			assuranceModel: verdict.assuranceModel,
			verificationBundle: verdict.verificationBundle,
			bundlePublication: verdict.bundlePublication,
		},
		metrics: expectedComparison.metrics,
		hybridTier: expectedComparison.hybridTier,
		rows: expectedComparison.rows,
	};
}
