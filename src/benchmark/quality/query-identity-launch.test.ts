import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	evidenceObjectSha256,
	evidenceSignaturePayload,
} from "./public-evidence-crypto.js";
import {
	createQueryIdentityLaunchArtifacts,
	scoreEscrowAttestedQueryIdentityRun,
	scorePublicQueryIdentityRun,
	scoreRunnerSignedQueryIdentityRun,
	scoreTimestampedRunnerQueryIdentityRun,
} from "./query-identity-launch.js";
import {
	QUERY_IDENTITY_PROPERTY_IDS,
	type QueryIdentityOracle,
	type QueryIdentityPredictionArtifact,
} from "./query-identity-oracle.js";

function oracle(): QueryIdentityOracle {
	const languages = ["ko", "en", "ja"] as const;
	const reasons = ["ambiguous", "out-of-ontology", "not-personal"] as const;
	return {
		schemaVersion: "naia-memory-query-identity-oracle-v1",
		construction: "independent-native-reviewed",
		cases: languages.flatMap((language) =>
			Array.from({ length: 36 }, (_, index) => ({
				id: `${language}-${index}`,
				language,
				query: `${language} query ${index}`,
				familyId: `${language}-family-${index}`,
				split: "test" as const,
				expectation:
					index < 21
						? {
								kind: "identity" as const,
								subjectId: "person:self" as const,
								propertyId: QUERY_IDENTITY_PROPERTY_IDS[index % 10],
							}
						: {
								kind: "abstain" as const,
								reason: reasons[(index - 21) % reasons.length],
							},
				provenance: {
					authorId: `author-${language}`,
					authorNativeLanguages: [language],
					reviewerId: `reviewer-${language}`,
					reviewerNativeLanguages: [language],
					reviewDecision: "accepted" as const,
				},
			})),
		),
	};
}

function timestampFixture(
	artifactSha256: string,
	timestampText = "Aug 22 01:00:00 2026 GMT",
) {
	const directory = mkdtempSync(join(tmpdir(), "query-identity-launch-"));
	const token = Buffer.from(
		`timestamp token:${artifactSha256}:${timestampText}`,
	);
	const ca = Buffer.from("trusted tsa ca");
	const tokenPath = join(directory, "oracle.tsr");
	const caPath = join(directory, "tsa-ca.pem");
	writeFileSync(tokenPath, token);
	writeFileSync(caPath, ca);
	return {
		timestampEvidence: {
			schemaVersion:
				"naia-memory-rfc3161-digest-timestamp-evidence-v1" as const,
			artifactSha256,
			tokenSha256: createHash("sha256").update(token).digest("hex"),
			tokenPath,
		},
		timestampTrustPolicy: {
			schemaVersion: "naia-memory-rfc3161-timestamp-trust-policy-v1" as const,
			trustedCaFilePath: caPath,
			trustedCaFileSha256: createHash("sha256").update(ca).digest("hex"),
			requiredPolicyOid: "1.2.3.4",
		},
		commandRunner: (args: string[]) =>
			args.includes("-verify")
				? { status: 0, stdout: "Verification: OK\n", stderr: "" }
				: {
						status: 0,
						stdout: `Status info:\nPolicy OID: 1.2.3.4\nTime stamp: ${timestampText}\n`,
						stderr: "",
					},
	};
}

describe("query identity launch evidence", () => {
	it("binds a trusted prior timestamp, launch receipt, and later predictions", () => {
		const currentOracle = oracle();
		const oracleSha256 = evidenceObjectSha256(currentOracle);
		const timestamp = timestampFixture(oracleSha256);
		const keys = generateKeyPairSync("ed25519");
		const runner = "independent-runner-01";
		const runnerTrustPolicy = {
			schemaVersion:
				"naia-memory-query-identity-runner-trust-policy-v1" as const,
			runners: {
				[runner]: keys.publicKey
					.export({ type: "spki", format: "pem" })
					.toString(),
			},
		};
		const escrowKeys = generateKeyPairSync("ed25519");
		const escrow = "independent-escrow-01";
		const escrowTrustPolicy = {
			schemaVersion:
				"naia-memory-query-identity-escrow-trust-policy-v1" as const,
			escrows: {
				[escrow]: escrowKeys.publicKey
					.export({ type: "spki", format: "pem" })
					.toString(),
			},
		};
		const launch = createQueryIdentityLaunchArtifacts({
			oracle: currentOracle,
			...timestamp,
			engine: "naia-memory",
			model: "closed-vocabulary-v1",
			launchedAt: "2026-08-22T01:01:00.000Z",
			launchNonce: "0123456789abcdef0123456789abcdef",
			runnerTrustPolicy,
			escrowTrustPolicy,
		});
		const predictions: QueryIdentityPredictionArtifact = {
			schemaVersion: "naia-memory-query-identity-predictions-v1",
			oracleSha256,
			launchReceiptSha256: evidenceObjectSha256(launch.receipt),
			run: {
				engine: launch.receipt.engine,
				model: launch.receipt.model,
				createdAt: "2026-08-22T01:02:00.000Z",
			},
			predictions: currentOracle.cases.map((current) => ({
				caseId: current.id,
				prediction:
					current.expectation.kind === "identity"
						? {
								subjectId: current.expectation.subjectId,
								propertyId: current.expectation.propertyId,
							}
						: undefined,
			})),
		};
		expect(
			scorePublicQueryIdentityRun({
				oracle: currentOracle,
				predictions,
				launchReceipt: launch.receipt,
				...timestamp,
				runnerTrustPolicy,
				escrowTrustPolicy,
			}),
		).toMatchObject({
			gate: "pass",
			evidenceAssurance: {
				level: "oracle-prior-existence-rfc3161",
				hiddenPacketDeliveryVerified: false,
				predictionChronologyVerified: false,
			},
			launchEvidence: { oraclePriorExistenceTimestampVerified: true },
		});
		const signed = <T extends object>(value: T) => ({
			...value,
			signatureBase64: sign(
				null,
				evidenceSignaturePayload(value),
				keys.privateKey,
			).toString("base64"),
		});
		const acknowledgement = signed({
			schemaVersion:
				"naia-memory-query-identity-runner-acknowledgement-v1" as const,
			runner,
			launchNonce: launch.receipt.launchNonce,
			oracleSha256,
			blindPacketSha256: launch.receipt.blindPacketSha256,
			launchReceiptSha256: evidenceObjectSha256(launch.receipt),
			runnerTrustPolicySha256: evidenceObjectSha256(runnerTrustPolicy),
			engine: launch.receipt.engine,
			model: launch.receipt.model,
			acknowledgedAt: "2026-08-22T01:01:30.000Z",
			statement: "EXACT_BLIND_PACKET_RECEIVED_BEFORE_EXECUTION" as const,
		});
		const resultSeal = signed({
			schemaVersion:
				"naia-memory-query-identity-runner-result-seal-v1" as const,
			runner,
			launchNonce: acknowledgement.launchNonce,
			launchReceiptSha256: acknowledgement.launchReceiptSha256,
			runnerTrustPolicySha256: acknowledgement.runnerTrustPolicySha256,
			acknowledgementSha256: evidenceObjectSha256(acknowledgement),
			predictionSha256: evidenceObjectSha256(predictions),
			finishedAt: "2026-08-22T01:03:00.000Z",
			statement: "EXACT_PREDICTION_ARTIFACT_SEALED_AFTER_EXECUTION" as const,
		});
		expect(
			scoreRunnerSignedQueryIdentityRun({
				oracle: currentOracle,
				predictions,
				launchReceipt: launch.receipt,
				...timestamp,
				acknowledgement,
				resultSeal,
				runnerTrustPolicy,
				escrowTrustPolicy,
			}),
		).toMatchObject({
			evidenceAssurance: {
				level: "runner-signed-delivery-and-result-claims",
				trustedRunnerDeliverySignatureVerified: true,
				predictionArtifactSealSignatureVerified: true,
				runnerTrustPolicyPrecommitExternallyVerified: false,
				organizationalIndependenceVerified: false,
				predictionChronologyVerified: false,
				predictionPrecommitTimestampVerified: false,
				oracleWithheldUntilPredictionCommitVerified: false,
			},
		});
		const predictionTimestamp = timestampFixture(
			evidenceObjectSha256(predictions),
			"Aug 22 01:04:00 2026 GMT",
		);
		expect(
			scoreTimestampedRunnerQueryIdentityRun({
				oracle: currentOracle,
				predictions,
				launchReceipt: launch.receipt,
				...timestamp,
				acknowledgement,
				resultSeal,
				runnerTrustPolicy,
				escrowTrustPolicy,
				predictionTimestampEvidence: predictionTimestamp.timestampEvidence,
				predictionTimestampTrustPolicy:
					predictionTimestamp.timestampTrustPolicy,
				predictionTimestampCommandRunner: predictionTimestamp.commandRunner,
			}),
		).toMatchObject({
			evidenceAssurance: {
				level: "runner-signed-result-with-rfc3161-prediction-timestamp",
				predictionChronologyVerified: true,
				predictionArtifactTrustedTimestampVerified: true,
				predictionPrecommitTimestampVerified: false,
				oracleWithheldUntilPredictionCommitVerified: false,
			},
			predictionTimestampEvidence: { trustedTimestampVerified: true },
		});
		const escrowPolicyTimestamp = timestampFixture(
			evidenceObjectSha256(escrowTrustPolicy),
			"Aug 22 00:59:00 2026 GMT",
		);
		const unsignedRevealReceipt = {
			schemaVersion:
				"naia-memory-query-identity-oracle-reveal-receipt-v1" as const,
			escrow,
			oracleSha256,
			predictionSha256: evidenceObjectSha256(predictions),
			predictionTimestampTokenSha256:
				predictionTimestamp.timestampEvidence.tokenSha256,
			predictionTimestampTrustPolicySha256: evidenceObjectSha256(
				predictionTimestamp.timestampTrustPolicy,
			),
			launchReceiptSha256: evidenceObjectSha256(launch.receipt),
			escrowTrustPolicySha256: evidenceObjectSha256(escrowTrustPolicy),
			escrowPolicyTimestampTrustPolicySha256: evidenceObjectSha256(
				escrowPolicyTimestamp.timestampTrustPolicy,
			),
			revealTimestampTrustPolicySha256: evidenceObjectSha256(
				predictionTimestamp.timestampTrustPolicy,
			),
			revealedAt: "2026-08-22T01:05:00.000Z",
			statement:
				"ORACLE_WITHHELD_UNTIL_BOUND_PREDICTION_TIMESTAMP_WAS_VERIFIED" as const,
		};
		const revealReceipt = {
			...unsignedRevealReceipt,
			signatureBase64: sign(
				null,
				evidenceSignaturePayload(unsignedRevealReceipt),
				escrowKeys.privateKey,
			).toString("base64"),
		};
		const revealTimestamp = timestampFixture(
			evidenceObjectSha256(revealReceipt),
			"Aug 22 01:06:00 2026 GMT",
		);
		const escrowInput = {
			oracle: currentOracle,
			predictions,
			launchReceipt: launch.receipt,
			...timestamp,
			acknowledgement,
			resultSeal,
			runnerTrustPolicy,
			predictionTimestampEvidence: predictionTimestamp.timestampEvidence,
			predictionTimestampTrustPolicy: predictionTimestamp.timestampTrustPolicy,
			predictionTimestampCommandRunner: predictionTimestamp.commandRunner,
			escrowTrustPolicy,
			escrowPolicyTimestampEvidence: escrowPolicyTimestamp.timestampEvidence,
			escrowPolicyTimestampTrustPolicy:
				escrowPolicyTimestamp.timestampTrustPolicy,
			escrowPolicyTimestampCommandRunner: escrowPolicyTimestamp.commandRunner,
			revealReceipt,
			revealTimestampEvidence: revealTimestamp.timestampEvidence,
			revealTimestampTrustPolicy: predictionTimestamp.timestampTrustPolicy,
			revealTimestampCommandRunner: revealTimestamp.commandRunner,
		};
		expect(scoreEscrowAttestedQueryIdentityRun(escrowInput)).toMatchObject({
			evidenceAssurance: {
				level: "launch-bound-prior-timestamped-escrow-release-attestation",
				escrowTrustPolicyPriorExistenceRfc3161Verified: true,
				escrowTrustPolicyLaunchBindingVerified: true,
				trustedEscrowReleaseSignatureVerified: true,
				trustedEscrowReleaseTimestampVerified: true,
				oracleWithholdingAttestedByTrustedEscrow: true,
				oracleWithheldUntilPredictionCommitVerified: false,
				organizationalIndependenceVerified: false,
			},
			escrowEvidence: { technicalOracleWithholdingVerified: false },
		});
		const earlyRevealTimestamp = timestampFixture(
			evidenceObjectSha256(revealReceipt),
			"Aug 22 01:03:00 2026 GMT",
		);
		expect(() =>
			scoreEscrowAttestedQueryIdentityRun({
				...escrowInput,
				revealTimestampEvidence: earlyRevealTimestamp.timestampEvidence,
				revealTimestampTrustPolicy: predictionTimestamp.timestampTrustPolicy,
				revealTimestampCommandRunner: earlyRevealTimestamp.commandRunner,
			}),
		).toThrow("reveal receipt was not timestamped after prediction");
		const latePolicyTimestamp = timestampFixture(
			evidenceObjectSha256(escrowTrustPolicy),
			"Aug 22 01:02:00 2026 GMT",
		);
		expect(() =>
			scoreEscrowAttestedQueryIdentityRun({
				...escrowInput,
				escrowPolicyTimestampEvidence: latePolicyTimestamp.timestampEvidence,
				escrowPolicyTimestampTrustPolicy:
					escrowPolicyTimestamp.timestampTrustPolicy,
				escrowPolicyTimestampCommandRunner: latePolicyTimestamp.commandRunner,
			}),
		).toThrow("escrow trust policy was not timestamped before launch");
		expect(() =>
			scoreEscrowAttestedQueryIdentityRun({
				...escrowInput,
				revealReceipt: {
					...revealReceipt,
					predictionTimestampTokenSha256: "f".repeat(64),
				},
			}),
		).toThrow("oracle reveal receipt is invalid");
		const substitutedEscrowKeys = generateKeyPairSync("ed25519");
		expect(() =>
			scoreEscrowAttestedQueryIdentityRun({
				...escrowInput,
				escrowTrustPolicy: {
					schemaVersion: "naia-memory-query-identity-escrow-trust-policy-v1",
					escrows: {
						[escrow]: substitutedEscrowKeys.publicKey
							.export({ type: "spki", format: "pem" })
							.toString(),
					},
				},
			}),
		).toThrow("escrow trust policy does not match launch receipt");
		expect(() =>
			scoreEscrowAttestedQueryIdentityRun({
				...escrowInput,
				predictionTimestampTrustPolicy:
					escrowPolicyTimestamp.timestampTrustPolicy,
			}),
		).toThrow("oracle reveal receipt is invalid");

		predictions.run.createdAt = launch.receipt.launchedAt;
		expect(() =>
			scorePublicQueryIdentityRun({
				oracle: currentOracle,
				predictions,
				launchReceipt: launch.receipt,
				...timestamp,
				runnerTrustPolicy,
				escrowTrustPolicy,
			}),
		).toThrow("not created after launch");
	});

	it("rejects a timestamp created at or after launch", () => {
		const currentOracle = oracle();
		const timestamp = timestampFixture(evidenceObjectSha256(currentOracle));
		expect(() =>
			createQueryIdentityLaunchArtifacts({
				oracle: currentOracle,
				...timestamp,
				engine: "naia-memory",
				model: "closed-vocabulary-v1",
				launchedAt: "2026-08-22T01:00:00.000Z",
			}),
		).toThrow("not timestamped before launch");
	});
});
