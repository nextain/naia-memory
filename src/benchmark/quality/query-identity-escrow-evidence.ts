import { createPublicKey } from "node:crypto";
import {
	evidenceObjectSha256,
	hasValidEvidenceSignature,
} from "./public-evidence-crypto.js";
import type { QueryIdentityLaunchReceipt } from "./query-identity-launch.js";
import type { QueryIdentityPredictionArtifact } from "./query-identity-oracle.js";
import {
	type Rfc3161CommandRunner,
	type Rfc3161DigestTimestampEvidence,
	type Rfc3161TimestampTrustPolicy,
	validateRfc3161DigestTimestampBinding,
} from "./rfc3161-timestamp.js";

export interface QueryIdentityEscrowTrustPolicy {
	schemaVersion: "naia-memory-query-identity-escrow-trust-policy-v1";
	escrows: Record<string, string>;
}

export interface QueryIdentityOracleRevealReceipt {
	schemaVersion: "naia-memory-query-identity-oracle-reveal-receipt-v1";
	escrow: string;
	oracleSha256: string;
	predictionSha256: string;
	predictionTimestampTokenSha256: string;
	predictionTimestampTrustPolicySha256: string;
	launchReceiptSha256: string;
	escrowTrustPolicySha256: string;
	escrowPolicyTimestampTrustPolicySha256: string;
	revealTimestampTrustPolicySha256: string;
	revealedAt: string;
	statement: "ORACLE_WITHHELD_UNTIL_BOUND_PREDICTION_TIMESTAMP_WAS_VERIFIED";
	signatureBase64: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function exactTime(value: unknown, label: string): number {
	if (typeof value !== "string" || !UTC.test(value))
		throw new Error(`${label} must be canonical UTC RFC3339`);
	const parsed = Date.parse(value);
	if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value)
		throw new Error(`${label} must be canonical UTC RFC3339`);
	return parsed;
}

function exactKeys(value: object, expected: string[]): boolean {
	return (
		JSON.stringify(Object.keys(value).sort()) ===
		JSON.stringify([...expected].sort())
	);
}

function trustedEscrow(
	policy: QueryIdentityEscrowTrustPolicy,
	escrow: unknown,
): string {
	if (
		!policy ||
		policy.schemaVersion !==
			"naia-memory-query-identity-escrow-trust-policy-v1" ||
		!policy.escrows ||
		typeof policy.escrows !== "object" ||
		Array.isArray(policy.escrows) ||
		Object.keys(policy.escrows).length === 0 ||
		typeof escrow !== "string" ||
		!escrow.trim()
	)
		throw new Error("query identity escrow trust policy is invalid");
	for (const [identity, key] of Object.entries(policy.escrows))
		try {
			if (
				!identity.trim() ||
				createPublicKey(key).asymmetricKeyType !== "ed25519"
			)
				throw new Error("invalid");
		} catch {
			throw new Error("query identity escrow trust policy is invalid");
		}
	const key = policy.escrows[escrow];
	if (!key) throw new Error("query identity escrow is untrusted");
	return key;
}

export function validateQueryIdentityEscrowEvidence(input: {
	launchReceipt: QueryIdentityLaunchReceipt;
	predictions: QueryIdentityPredictionArtifact;
	predictionTimestampEvidence: Rfc3161DigestTimestampEvidence;
	predictionTimestampTrustPolicy: Rfc3161TimestampTrustPolicy;
	escrowTrustPolicy: QueryIdentityEscrowTrustPolicy;
	escrowPolicyTimestampEvidence: Rfc3161DigestTimestampEvidence;
	escrowPolicyTimestampTrustPolicy: Rfc3161TimestampTrustPolicy;
	revealReceipt: QueryIdentityOracleRevealReceipt;
	revealTimestampEvidence: Rfc3161DigestTimestampEvidence;
	revealTimestampTrustPolicy: Rfc3161TimestampTrustPolicy;
	predictionTimestampCommandRunner?: Rfc3161CommandRunner;
	escrowPolicyTimestampCommandRunner?: Rfc3161CommandRunner;
	revealTimestampCommandRunner?: Rfc3161CommandRunner;
}) {
	const policySha256 = evidenceObjectSha256(input.escrowTrustPolicy);
	const policyTimestamp = validateRfc3161DigestTimestampBinding({
		expectedArtifactSha256: policySha256,
		evidence: input.escrowPolicyTimestampEvidence,
		trustPolicy: input.escrowPolicyTimestampTrustPolicy,
		commandRunner: input.escrowPolicyTimestampCommandRunner,
	});
	if (
		exactTime(policyTimestamp.timestampedAt, "escrow policy timestamp") >=
		exactTime(input.launchReceipt.launchedAt, "launch time")
	)
		throw new Error("escrow trust policy was not timestamped before launch");
	const predictionTimestamp = validateRfc3161DigestTimestampBinding({
		expectedArtifactSha256: evidenceObjectSha256(input.predictions),
		evidence: input.predictionTimestampEvidence,
		trustPolicy: input.predictionTimestampTrustPolicy,
		commandRunner: input.predictionTimestampCommandRunner,
	});
	const receipt = input.revealReceipt;
	if (
		!receipt ||
		typeof receipt !== "object" ||
		Array.isArray(receipt) ||
		!exactKeys(receipt, [
			"schemaVersion",
			"escrow",
			"oracleSha256",
			"predictionSha256",
			"predictionTimestampTokenSha256",
			"predictionTimestampTrustPolicySha256",
			"launchReceiptSha256",
			"escrowTrustPolicySha256",
			"escrowPolicyTimestampTrustPolicySha256",
			"revealTimestampTrustPolicySha256",
			"revealedAt",
			"statement",
			"signatureBase64",
		]) ||
		receipt.schemaVersion !==
			"naia-memory-query-identity-oracle-reveal-receipt-v1" ||
		!SHA256.test(receipt.oracleSha256) ||
		receipt.oracleSha256 !== input.launchReceipt.oracleSha256 ||
		receipt.predictionSha256 !== evidenceObjectSha256(input.predictions) ||
		receipt.predictionTimestampTokenSha256 !==
			input.predictionTimestampEvidence.tokenSha256 ||
		receipt.predictionTimestampTrustPolicySha256 !==
			evidenceObjectSha256(input.predictionTimestampTrustPolicy) ||
		receipt.launchReceiptSha256 !== evidenceObjectSha256(input.launchReceipt) ||
		receipt.escrowTrustPolicySha256 !== policySha256 ||
		receipt.escrowPolicyTimestampTrustPolicySha256 !==
			evidenceObjectSha256(input.escrowPolicyTimestampTrustPolicy) ||
		receipt.revealTimestampTrustPolicySha256 !==
			evidenceObjectSha256(input.revealTimestampTrustPolicy) ||
		receipt.statement !==
			"ORACLE_WITHHELD_UNTIL_BOUND_PREDICTION_TIMESTAMP_WAS_VERIFIED"
	)
		throw new Error("query identity oracle reveal receipt is invalid");
	const predictionTimestampedAt = exactTime(
		predictionTimestamp.timestampedAt,
		"prediction timestamp",
	);
	if (
		exactTime(receipt.revealedAt, "oracle reveal time") <=
		predictionTimestampedAt
	)
		throw new Error("oracle reveal claim is not after prediction timestamp");
	const escrowKey = trustedEscrow(input.escrowTrustPolicy, receipt.escrow);
	if (!hasValidEvidenceSignature(receipt, escrowKey))
		throw new Error("query identity oracle reveal signature is invalid");
	const revealTimestamp = validateRfc3161DigestTimestampBinding({
		expectedArtifactSha256: evidenceObjectSha256(receipt),
		evidence: input.revealTimestampEvidence,
		trustPolicy: input.revealTimestampTrustPolicy,
		commandRunner: input.revealTimestampCommandRunner,
	});
	const revealTimestampedAt = exactTime(
		revealTimestamp.timestampedAt,
		"oracle reveal receipt timestamp",
	);
	if (revealTimestampedAt <= predictionTimestampedAt)
		throw new Error(
			"oracle reveal receipt was not timestamped after prediction",
		);
	if (exactTime(receipt.revealedAt, "oracle reveal time") > revealTimestampedAt)
		throw new Error(
			"oracle reveal claim is after its trusted receipt timestamp",
		);
	return {
		escrow: receipt.escrow,
		escrowTrustPolicySha256: policySha256,
		escrowPolicyTimestampedAt: policyTimestamp.timestampedAt,
		revealReceiptSha256: evidenceObjectSha256(receipt),
		revealTimestampedAt: revealTimestamp.timestampedAt,
		escrowTrustPolicyPriorExistenceRfc3161Verified: true as const,
		trustedEscrowReleaseSignatureVerified: true as const,
		trustedEscrowReleaseTimestampVerified: true as const,
		oracleWithholdingAttestedByTrustedEscrow: true as const,
		technicalOracleWithholdingVerified: false as const,
	};
}
