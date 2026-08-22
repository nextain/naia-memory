import { randomBytes } from "node:crypto";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import {
	type QueryIdentityEscrowTrustPolicy,
	type QueryIdentityOracleRevealReceipt,
	validateQueryIdentityEscrowEvidence,
} from "./query-identity-escrow-evidence.js";
import {
	type QueryIdentityOracle,
	type QueryIdentityPredictionArtifact,
	buildQueryIdentityBlindPacket,
	scoreQueryIdentityArtifact,
} from "./query-identity-oracle.js";
import {
	type QueryIdentityRunnerAcknowledgement,
	type QueryIdentityRunnerResultSeal,
	type QueryIdentityRunnerTrustPolicy,
	validateQueryIdentityRunnerEvidence,
} from "./query-identity-runner-evidence.js";
import {
	type Rfc3161CommandRunner,
	type Rfc3161DigestTimestampEvidence,
	type Rfc3161TimestampTrustPolicy,
	validateRfc3161DigestTimestampBinding,
} from "./rfc3161-timestamp.js";

export interface QueryIdentityLaunchReceipt {
	schemaVersion: "naia-memory-query-identity-launch-receipt-v2";
	oracleSha256: string;
	blindPacketSha256: string;
	launchNonce: string;
	timestampTokenSha256: string;
	timestampedAt: string;
	launchedAt: string;
	runnerTrustPolicySha256?: string;
	escrowTrustPolicySha256?: string;
	engine: string;
	model: string;
}

function exactUtc(value: string, label: string): number {
	if (
		typeof value !== "string" ||
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
	)
		throw new Error(`${label} must be canonical UTC RFC3339`);
	const parsed = Date.parse(value);
	if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value)
		throw new Error(`${label} must be canonical UTC RFC3339`);
	return parsed;
}

export function createQueryIdentityLaunchArtifacts(input: {
	oracle: QueryIdentityOracle;
	timestampEvidence: Rfc3161DigestTimestampEvidence;
	timestampTrustPolicy: Rfc3161TimestampTrustPolicy;
	engine: string;
	model: string;
	launchedAt: string;
	launchNonce?: string;
	runnerTrustPolicy?: QueryIdentityRunnerTrustPolicy;
	escrowTrustPolicy?: QueryIdentityEscrowTrustPolicy;
	commandRunner?: Rfc3161CommandRunner;
}) {
	if (!input.engine?.trim() || !input.model?.trim())
		throw new Error("query identity launch engine and model are required");
	const oraclePacket = buildQueryIdentityBlindPacket(input.oracle);
	const launchNonce = input.launchNonce ?? randomBytes(16).toString("hex");
	if (!/^[a-f0-9]{32,128}$/.test(launchNonce))
		throw new Error("query identity launch nonce is invalid");
	const blindPacket = {
		...oraclePacket,
		schemaVersion: "naia-memory-query-identity-launch-blind-packet-v1" as const,
		launchNonce,
	};
	const timestamp = validateRfc3161DigestTimestampBinding({
		expectedArtifactSha256: blindPacket.oracleSha256,
		evidence: input.timestampEvidence,
		trustPolicy: input.timestampTrustPolicy,
		commandRunner: input.commandRunner,
	});
	if (
		exactUtc(timestamp.timestampedAt, "timestampedAt") >=
		exactUtc(input.launchedAt, "launchedAt")
	)
		throw new Error("query identity oracle was not timestamped before launch");
	const receipt: QueryIdentityLaunchReceipt = {
		schemaVersion: "naia-memory-query-identity-launch-receipt-v2",
		oracleSha256: blindPacket.oracleSha256,
		blindPacketSha256: evidenceObjectSha256(blindPacket),
		launchNonce,
		timestampTokenSha256: input.timestampEvidence.tokenSha256,
		timestampedAt: timestamp.timestampedAt,
		launchedAt: input.launchedAt,
		...(input.runnerTrustPolicy
			? {
					runnerTrustPolicySha256: evidenceObjectSha256(
						input.runnerTrustPolicy,
					),
				}
			: {}),
		...(input.escrowTrustPolicy
			? {
					escrowTrustPolicySha256: evidenceObjectSha256(
						input.escrowTrustPolicy,
					),
				}
			: {}),
		engine: input.engine,
		model: input.model,
	};
	return { blindPacket, receipt };
}

export function scorePublicQueryIdentityRun(input: {
	oracle: QueryIdentityOracle;
	predictions: QueryIdentityPredictionArtifact;
	launchReceipt: QueryIdentityLaunchReceipt;
	timestampEvidence: Rfc3161DigestTimestampEvidence;
	timestampTrustPolicy: Rfc3161TimestampTrustPolicy;
	runnerTrustPolicy?: QueryIdentityRunnerTrustPolicy;
	escrowTrustPolicy?: QueryIdentityEscrowTrustPolicy;
	commandRunner?: Rfc3161CommandRunner;
}) {
	const score = scoreQueryIdentityArtifact(input.oracle, input.predictions);
	const reconstructed = createQueryIdentityLaunchArtifacts({
		oracle: input.oracle,
		timestampEvidence: input.timestampEvidence,
		timestampTrustPolicy: input.timestampTrustPolicy,
		engine: input.launchReceipt?.engine,
		model: input.launchReceipt?.model,
		launchedAt: input.launchReceipt?.launchedAt,
		launchNonce: input.launchReceipt?.launchNonce,
		runnerTrustPolicy:
			input.launchReceipt?.runnerTrustPolicySha256 !== undefined
				? input.runnerTrustPolicy
				: undefined,
		escrowTrustPolicy:
			input.launchReceipt?.escrowTrustPolicySha256 !== undefined
				? input.escrowTrustPolicy
				: undefined,
		commandRunner: input.commandRunner,
	});
	if (
		!input.launchReceipt ||
		input.launchReceipt.schemaVersion !==
			"naia-memory-query-identity-launch-receipt-v2" ||
		evidenceObjectSha256(input.launchReceipt) !==
			evidenceObjectSha256(reconstructed.receipt)
	)
		throw new Error("query identity launch receipt mismatch");
	if (
		input.predictions.launchReceiptSha256 !==
		evidenceObjectSha256(input.launchReceipt)
	)
		throw new Error("prediction artifact launch receipt hash mismatch");
	if (
		input.predictions.run?.engine !== input.launchReceipt.engine ||
		input.predictions.run?.model !== input.launchReceipt.model
	)
		throw new Error("prediction run identity does not match launch receipt");
	if (
		exactUtc(input.predictions.run.createdAt, "prediction createdAt") <=
		exactUtc(input.launchReceipt.launchedAt, "launchedAt")
	)
		throw new Error("predictions were not created after launch");
	return {
		...score,
		evidenceAssurance: {
			level: "oracle-prior-existence-rfc3161" as const,
			oraclePriorExistenceVerified: true as const,
			hiddenPacketDeliveryVerified: false as const,
			predictionChronologyVerified: false as const,
		},
		launchEvidence: {
			launchReceiptSha256: evidenceObjectSha256(input.launchReceipt),
			timestampTokenSha256: input.launchReceipt.timestampTokenSha256,
			timestampedAt: input.launchReceipt.timestampedAt,
			launchedAt: input.launchReceipt.launchedAt,
			oraclePriorExistenceTimestampVerified: true as const,
		},
	};
}

export function scoreRunnerSignedQueryIdentityRun(input: {
	oracle: QueryIdentityOracle;
	predictions: QueryIdentityPredictionArtifact;
	launchReceipt: QueryIdentityLaunchReceipt;
	timestampEvidence: Rfc3161DigestTimestampEvidence;
	timestampTrustPolicy: Rfc3161TimestampTrustPolicy;
	acknowledgement: QueryIdentityRunnerAcknowledgement;
	resultSeal: QueryIdentityRunnerResultSeal;
	runnerTrustPolicy: QueryIdentityRunnerTrustPolicy;
	escrowTrustPolicy?: QueryIdentityEscrowTrustPolicy;
	commandRunner?: Rfc3161CommandRunner;
}) {
	if (
		input.launchReceipt?.runnerTrustPolicySha256 !==
		evidenceObjectSha256(input.runnerTrustPolicy)
	)
		throw new Error("runner trust policy does not match launch receipt");
	const timestampScore = scorePublicQueryIdentityRun(input);
	const runnerEvidence = validateQueryIdentityRunnerEvidence({
		launchReceipt: input.launchReceipt,
		predictions: input.predictions,
		acknowledgement: input.acknowledgement,
		resultSeal: input.resultSeal,
		trustPolicy: input.runnerTrustPolicy,
	});
	return {
		...timestampScore,
		evidenceAssurance: {
			level: "runner-signed-delivery-and-result-claims" as const,
			oraclePriorExistenceVerified: true as const,
			hiddenPacketDeliveryVerified: false as const,
			trustedRunnerDeliverySignatureVerified:
				runnerEvidence.runnerSignaturesVerified,
			predictionArtifactSealSignatureVerified:
				runnerEvidence.runnerSignaturesVerified,
			runnerTrustPolicyPrecommitExternallyVerified: false as const,
			organizationalIndependenceVerified: false as const,
			predictionChronologyVerified: false as const,
			predictionPrecommitTimestampVerified: false as const,
			oracleWithheldUntilPredictionCommitVerified: false as const,
		},
		runnerEvidence,
	};
}

export function scoreTimestampedRunnerQueryIdentityRun(input: {
	oracle: QueryIdentityOracle;
	predictions: QueryIdentityPredictionArtifact;
	launchReceipt: QueryIdentityLaunchReceipt;
	timestampEvidence: Rfc3161DigestTimestampEvidence;
	timestampTrustPolicy: Rfc3161TimestampTrustPolicy;
	acknowledgement: QueryIdentityRunnerAcknowledgement;
	resultSeal: QueryIdentityRunnerResultSeal;
	runnerTrustPolicy: QueryIdentityRunnerTrustPolicy;
	escrowTrustPolicy?: QueryIdentityEscrowTrustPolicy;
	predictionTimestampEvidence: Rfc3161DigestTimestampEvidence;
	predictionTimestampTrustPolicy: Rfc3161TimestampTrustPolicy;
	commandRunner?: Rfc3161CommandRunner;
	predictionTimestampCommandRunner?: Rfc3161CommandRunner;
}) {
	const signedScore = scoreRunnerSignedQueryIdentityRun(input);
	const predictionTimestamp = validateRfc3161DigestTimestampBinding({
		expectedArtifactSha256: evidenceObjectSha256(input.predictions),
		evidence: input.predictionTimestampEvidence,
		trustPolicy: input.predictionTimestampTrustPolicy,
		commandRunner: input.predictionTimestampCommandRunner,
	});
	const timestampedAt = exactUtc(
		predictionTimestamp.timestampedAt,
		"prediction timestampedAt",
	);
	if (timestampedAt <= exactUtc(input.launchReceipt.launchedAt, "launchedAt"))
		throw new Error("prediction commitment was not timestamped after launch");
	if (
		exactUtc(input.predictions.run.createdAt, "prediction createdAt") >
		timestampedAt
	)
		throw new Error("prediction creation claim is after its trusted timestamp");
	return {
		...signedScore,
		evidenceAssurance: {
			...signedScore.evidenceAssurance,
			level: "runner-signed-result-with-rfc3161-prediction-timestamp" as const,
			predictionChronologyVerified: true as const,
			predictionArtifactTrustedTimestampVerified: true as const,
			predictionPrecommitTimestampVerified: false as const,
			oracleWithheldUntilPredictionCommitVerified: false as const,
		},
		predictionTimestampEvidence: {
			predictionSha256: evidenceObjectSha256(input.predictions),
			timestampTokenSha256: input.predictionTimestampEvidence.tokenSha256,
			timestampedAt: predictionTimestamp.timestampedAt,
			trustedTimestampVerified: true as const,
		},
	};
}

export function scoreEscrowAttestedQueryIdentityRun(
	input: Parameters<typeof scoreTimestampedRunnerQueryIdentityRun>[0] & {
		escrowTrustPolicy: QueryIdentityEscrowTrustPolicy;
		escrowPolicyTimestampEvidence: Rfc3161DigestTimestampEvidence;
		escrowPolicyTimestampTrustPolicy: Rfc3161TimestampTrustPolicy;
		revealReceipt: QueryIdentityOracleRevealReceipt;
		revealTimestampEvidence: Rfc3161DigestTimestampEvidence;
		revealTimestampTrustPolicy: Rfc3161TimestampTrustPolicy;
		escrowPolicyTimestampCommandRunner?: Rfc3161CommandRunner;
		revealTimestampCommandRunner?: Rfc3161CommandRunner;
	},
) {
	if (
		input.launchReceipt?.escrowTrustPolicySha256 !==
		evidenceObjectSha256(input.escrowTrustPolicy)
	)
		throw new Error("escrow trust policy does not match launch receipt");
	const timestampedScore = scoreTimestampedRunnerQueryIdentityRun(input);
	const escrowEvidence = validateQueryIdentityEscrowEvidence({
		launchReceipt: input.launchReceipt,
		predictions: input.predictions,
		predictionTimestampEvidence: input.predictionTimestampEvidence,
		predictionTimestampTrustPolicy: input.predictionTimestampTrustPolicy,
		escrowTrustPolicy: input.escrowTrustPolicy,
		escrowPolicyTimestampEvidence: input.escrowPolicyTimestampEvidence,
		escrowPolicyTimestampTrustPolicy: input.escrowPolicyTimestampTrustPolicy,
		revealReceipt: input.revealReceipt,
		revealTimestampEvidence: input.revealTimestampEvidence,
		revealTimestampTrustPolicy: input.revealTimestampTrustPolicy,
		predictionTimestampCommandRunner: input.predictionTimestampCommandRunner,
		escrowPolicyTimestampCommandRunner:
			input.escrowPolicyTimestampCommandRunner,
		revealTimestampCommandRunner: input.revealTimestampCommandRunner,
	});
	return {
		...timestampedScore,
		evidenceAssurance: {
			...timestampedScore.evidenceAssurance,
			level:
				"launch-bound-prior-timestamped-escrow-release-attestation" as const,
			escrowTrustPolicyPriorExistenceRfc3161Verified:
				escrowEvidence.escrowTrustPolicyPriorExistenceRfc3161Verified,
			escrowTrustPolicyLaunchBindingVerified: true as const,
			trustedEscrowReleaseSignatureVerified:
				escrowEvidence.trustedEscrowReleaseSignatureVerified,
			trustedEscrowReleaseTimestampVerified:
				escrowEvidence.trustedEscrowReleaseTimestampVerified,
			oracleWithholdingAttestedByTrustedEscrow:
				escrowEvidence.oracleWithholdingAttestedByTrustedEscrow,
			oracleWithheldUntilPredictionCommitVerified: false as const,
			organizationalIndependenceVerified: false as const,
		},
		escrowEvidence,
	};
}
