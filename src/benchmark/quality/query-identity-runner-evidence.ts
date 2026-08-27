import { createPublicKey } from "node:crypto";
import {
	evidenceObjectSha256,
	hasValidEvidenceSignature,
} from "./public-evidence-crypto.js";
import type { QueryIdentityLaunchReceipt } from "./query-identity-launch.js";
import type { QueryIdentityPredictionArtifact } from "./query-identity-oracle.js";

export interface QueryIdentityRunnerTrustPolicy {
	schemaVersion: "naia-memory-query-identity-runner-trust-policy-v1";
	runners: Record<string, string>;
}

export interface QueryIdentityRunnerAcknowledgement {
	schemaVersion: "naia-memory-query-identity-runner-acknowledgement-v1";
	runner: string;
	launchNonce: string;
	oracleSha256: string;
	blindPacketSha256: string;
	launchReceiptSha256: string;
	runnerTrustPolicySha256: string;
	engine: string;
	model: string;
	acknowledgedAt: string;
	statement: "EXACT_BLIND_PACKET_RECEIVED_BEFORE_EXECUTION";
	signatureBase64: string;
}

export interface QueryIdentityRunnerResultSeal {
	schemaVersion: "naia-memory-query-identity-runner-result-seal-v1";
	runner: string;
	launchNonce: string;
	launchReceiptSha256: string;
	runnerTrustPolicySha256: string;
	acknowledgementSha256: string;
	predictionSha256: string;
	finishedAt: string;
	statement: "EXACT_PREDICTION_ARTIFACT_SEALED_AFTER_EXECUTION";
	signatureBase64: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const NONCE = /^[a-f0-9]{32,128}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function exactKeys(value: object, expected: string[]): boolean {
	return (
		JSON.stringify(Object.keys(value).sort()) ===
		JSON.stringify([...expected].sort())
	);
}

function exactTime(value: unknown): number {
	if (typeof value !== "string" || !UTC.test(value)) return Number.NaN;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
		? parsed
		: Number.NaN;
}

function trustedRunner(
	policy: QueryIdentityRunnerTrustPolicy,
	runner: unknown,
): string {
	if (
		!policy ||
		policy.schemaVersion !==
			"naia-memory-query-identity-runner-trust-policy-v1" ||
		!policy.runners ||
		typeof policy.runners !== "object" ||
		Array.isArray(policy.runners) ||
		Object.keys(policy.runners).length === 0 ||
		typeof runner !== "string" ||
		!runner.trim()
	)
		throw new Error("query identity runner trust policy is invalid");
	for (const [identity, key] of Object.entries(policy.runners))
		try {
			if (
				!identity.trim() ||
				createPublicKey(key).asymmetricKeyType !== "ed25519"
			)
				throw new Error("invalid");
		} catch {
			throw new Error("query identity runner trust policy is invalid");
		}
	const key = policy.runners[runner];
	if (!key) throw new Error("query identity runner is untrusted");
	return key;
}

export function validateQueryIdentityRunnerEvidence(input: {
	launchReceipt: QueryIdentityLaunchReceipt;
	predictions: QueryIdentityPredictionArtifact;
	acknowledgement: QueryIdentityRunnerAcknowledgement;
	resultSeal: QueryIdentityRunnerResultSeal;
	trustPolicy: QueryIdentityRunnerTrustPolicy;
}) {
	const { launchReceipt, predictions, acknowledgement, resultSeal } = input;
	if (
		!acknowledgement ||
		typeof acknowledgement !== "object" ||
		Array.isArray(acknowledgement) ||
		!exactKeys(acknowledgement, [
			"schemaVersion",
			"runner",
			"launchNonce",
			"oracleSha256",
			"blindPacketSha256",
			"launchReceiptSha256",
			"runnerTrustPolicySha256",
			"engine",
			"model",
			"acknowledgedAt",
			"statement",
			"signatureBase64",
		]) ||
		acknowledgement.schemaVersion !==
			"naia-memory-query-identity-runner-acknowledgement-v1" ||
		!NONCE.test(acknowledgement.launchNonce) ||
		!SHA256.test(acknowledgement.oracleSha256) ||
		!SHA256.test(acknowledgement.blindPacketSha256) ||
		acknowledgement.oracleSha256 !== launchReceipt.oracleSha256 ||
		acknowledgement.launchNonce !== launchReceipt.launchNonce ||
		acknowledgement.blindPacketSha256 !== launchReceipt.blindPacketSha256 ||
		acknowledgement.launchReceiptSha256 !==
			evidenceObjectSha256(launchReceipt) ||
		acknowledgement.runnerTrustPolicySha256 !==
			evidenceObjectSha256(input.trustPolicy) ||
		launchReceipt.runnerTrustPolicySha256 !==
			acknowledgement.runnerTrustPolicySha256 ||
		acknowledgement.engine !== launchReceipt.engine ||
		acknowledgement.model !== launchReceipt.model ||
		acknowledgement.statement !==
			"EXACT_BLIND_PACKET_RECEIVED_BEFORE_EXECUTION" ||
		!Number.isFinite(exactTime(acknowledgement.acknowledgedAt)) ||
		exactTime(acknowledgement.acknowledgedAt) <
			exactTime(launchReceipt.launchedAt)
	)
		throw new Error("query identity runner acknowledgement is invalid");
	const publicKey = trustedRunner(input.trustPolicy, acknowledgement.runner);
	if (!hasValidEvidenceSignature(acknowledgement, publicKey))
		throw new Error(
			"query identity runner acknowledgement signature is invalid",
		);
	if (
		!resultSeal ||
		typeof resultSeal !== "object" ||
		Array.isArray(resultSeal) ||
		!exactKeys(resultSeal, [
			"schemaVersion",
			"runner",
			"launchNonce",
			"launchReceiptSha256",
			"runnerTrustPolicySha256",
			"acknowledgementSha256",
			"predictionSha256",
			"finishedAt",
			"statement",
			"signatureBase64",
		]) ||
		resultSeal.schemaVersion !==
			"naia-memory-query-identity-runner-result-seal-v1" ||
		resultSeal.runner !== acknowledgement.runner ||
		resultSeal.launchNonce !== acknowledgement.launchNonce ||
		resultSeal.launchReceiptSha256 !== acknowledgement.launchReceiptSha256 ||
		resultSeal.runnerTrustPolicySha256 !==
			acknowledgement.runnerTrustPolicySha256 ||
		resultSeal.acknowledgementSha256 !==
			evidenceObjectSha256(acknowledgement) ||
		resultSeal.predictionSha256 !== evidenceObjectSha256(predictions) ||
		resultSeal.statement !==
			"EXACT_PREDICTION_ARTIFACT_SEALED_AFTER_EXECUTION" ||
		!Number.isFinite(exactTime(resultSeal.finishedAt)) ||
		exactTime(resultSeal.finishedAt) <=
			exactTime(acknowledgement.acknowledgedAt)
	)
		throw new Error("query identity runner result seal is invalid");
	if (!hasValidEvidenceSignature(resultSeal, publicKey))
		throw new Error("query identity runner result seal signature is invalid");
	return {
		runner: acknowledgement.runner,
		launchNonce: acknowledgement.launchNonce,
		acknowledgementSha256: evidenceObjectSha256(acknowledgement),
		resultSealSha256: evidenceObjectSha256(resultSeal),
		runnerSignaturesVerified: true as const,
		runnerClaimedDeliveryBeforeResult: true as const,
		trustedWallClockChronologyVerified: false as const,
		physicalDeliveryVerified: false as const,
	};
}
