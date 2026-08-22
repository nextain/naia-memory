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
	scorePublicQueryIdentityRun,
	scoreRunnerSignedQueryIdentityRun,
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

function timestampFixture(artifactSha256: string) {
	const directory = mkdtempSync(join(tmpdir(), "query-identity-launch-"));
	const token = Buffer.from("timestamp token");
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
						stdout:
							"Status info:\nPolicy OID: 1.2.3.4\nTime stamp: Aug 22 01:00:00 2026 GMT\n",
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
		const launch = createQueryIdentityLaunchArtifacts({
			oracle: currentOracle,
			...timestamp,
			engine: "naia-memory",
			model: "closed-vocabulary-v1",
			launchedAt: "2026-08-22T01:01:00.000Z",
			launchNonce: "0123456789abcdef0123456789abcdef",
			runnerTrustPolicy,
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

		predictions.run.createdAt = launch.receipt.launchedAt;
		expect(() =>
			scorePublicQueryIdentityRun({
				oracle: currentOracle,
				predictions,
				launchReceipt: launch.receipt,
				...timestamp,
				runnerTrustPolicy,
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
