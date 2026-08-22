import { randomBytes } from "node:crypto";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
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
