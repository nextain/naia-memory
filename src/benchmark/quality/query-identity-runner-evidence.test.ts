import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	evidenceObjectSha256,
	evidenceSignaturePayload,
} from "./public-evidence-crypto.js";
import type { QueryIdentityLaunchReceipt } from "./query-identity-launch.js";
import type { QueryIdentityPredictionArtifact } from "./query-identity-oracle.js";
import {
	type QueryIdentityRunnerAcknowledgement,
	type QueryIdentityRunnerResultSeal,
	validateQueryIdentityRunnerEvidence,
} from "./query-identity-runner-evidence.js";

const keys = generateKeyPairSync("ed25519");
const runner = "independent-runner-01";
const trustPolicy = {
	schemaVersion: "naia-memory-query-identity-runner-trust-policy-v1" as const,
	runners: {
		[runner]: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
	},
};
const signed = <T extends object>(value: T) => ({
	...value,
	signatureBase64: sign(
		null,
		evidenceSignaturePayload(value),
		keys.privateKey,
	).toString("base64"),
});

function fixture() {
	const launchReceipt: QueryIdentityLaunchReceipt = {
		schemaVersion: "naia-memory-query-identity-launch-receipt-v2",
		oracleSha256: "a".repeat(64),
		blindPacketSha256: "b".repeat(64),
		launchNonce: "0123456789abcdef0123456789abcdef",
		timestampTokenSha256: "c".repeat(64),
		timestampedAt: "2026-08-22T01:00:00.000Z",
		launchedAt: "2026-08-22T01:01:00.000Z",
		runnerTrustPolicySha256: evidenceObjectSha256(trustPolicy),
		engine: "naia-memory",
		model: "closed-vocabulary-v1",
	};
	const predictions: QueryIdentityPredictionArtifact = {
		schemaVersion: "naia-memory-query-identity-predictions-v1",
		oracleSha256: launchReceipt.oracleSha256,
		launchReceiptSha256: evidenceObjectSha256(launchReceipt),
		run: {
			engine: launchReceipt.engine,
			model: launchReceipt.model,
			createdAt: "2026-08-22T01:03:00.000Z",
		},
		predictions: [],
	};
	const acknowledgement: QueryIdentityRunnerAcknowledgement = signed({
		schemaVersion:
			"naia-memory-query-identity-runner-acknowledgement-v1" as const,
		runner,
		launchNonce: launchReceipt.launchNonce,
		oracleSha256: launchReceipt.oracleSha256,
		blindPacketSha256: launchReceipt.blindPacketSha256,
		launchReceiptSha256: evidenceObjectSha256(launchReceipt),
		runnerTrustPolicySha256: evidenceObjectSha256(trustPolicy),
		engine: launchReceipt.engine,
		model: launchReceipt.model,
		acknowledgedAt: "2026-08-22T01:02:00.000Z",
		statement: "EXACT_BLIND_PACKET_RECEIVED_BEFORE_EXECUTION" as const,
	});
	const resultSeal: QueryIdentityRunnerResultSeal = signed({
		schemaVersion: "naia-memory-query-identity-runner-result-seal-v1" as const,
		runner,
		launchNonce: acknowledgement.launchNonce,
		launchReceiptSha256: acknowledgement.launchReceiptSha256,
		runnerTrustPolicySha256: acknowledgement.runnerTrustPolicySha256,
		acknowledgementSha256: evidenceObjectSha256(acknowledgement),
		predictionSha256: evidenceObjectSha256(predictions),
		finishedAt: "2026-08-22T01:04:00.000Z",
		statement: "EXACT_PREDICTION_ARTIFACT_SEALED_AFTER_EXECUTION" as const,
	});
	return { launchReceipt, predictions, acknowledgement, resultSeal };
}

describe("query identity runner evidence", () => {
	it("binds one trusted runner from blind receipt to exact prediction artifact", () => {
		expect(
			validateQueryIdentityRunnerEvidence({ ...fixture(), trustPolicy }),
		).toMatchObject({
			runnerSignaturesVerified: true,
			runnerClaimedDeliveryBeforeResult: true,
			trustedWallClockChronologyVerified: false,
			physicalDeliveryVerified: false,
		});
	});

	it("rejects prediction substitution and replay under a different nonce", () => {
		const substituted = fixture();
		substituted.predictions.run.model = "substituted";
		expect(() =>
			validateQueryIdentityRunnerEvidence({ ...substituted, trustPolicy }),
		).toThrow("result seal is invalid");
		const replayed = fixture();
		replayed.resultSeal.launchNonce = "f".repeat(32);
		expect(() =>
			validateQueryIdentityRunnerEvidence({ ...replayed, trustPolicy }),
		).toThrow("result seal is invalid");
	});

	it("rejects a runner policy substituted after launch", () => {
		const replacementKeys = generateKeyPairSync("ed25519");
		const replacementPolicy = {
			schemaVersion:
				"naia-memory-query-identity-runner-trust-policy-v1" as const,
			runners: {
				[runner]: replacementKeys.publicKey
					.export({ type: "spki", format: "pem" })
					.toString(),
			},
		};
		expect(() =>
			validateQueryIdentityRunnerEvidence({
				...fixture(),
				trustPolicy: replacementPolicy,
			}),
		).toThrow("acknowledgement is invalid");
	});

	it("rejects an acknowledgement replayed under a different launch nonce", () => {
		const replayed = fixture();
		replayed.launchReceipt.launchNonce = "f".repeat(32);
		expect(() =>
			validateQueryIdentityRunnerEvidence({ ...replayed, trustPolicy }),
		).toThrow("acknowledgement is invalid");
	});

	it("rejects untrusted, forged, and non-canonical chronology evidence", () => {
		const forged = fixture();
		forged.acknowledgement.acknowledgedAt = "2026-08-22T01:02:01.000Z";
		expect(() =>
			validateQueryIdentityRunnerEvidence({ ...forged, trustPolicy }),
		).toThrow("signature is invalid");
		const chronology = fixture();
		chronology.resultSeal.finishedAt =
			chronology.acknowledgement.acknowledgedAt;
		expect(() =>
			validateQueryIdentityRunnerEvidence({ ...chronology, trustPolicy }),
		).toThrow("result seal is invalid");
	});
});
