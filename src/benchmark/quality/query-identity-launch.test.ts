import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import {
	createQueryIdentityLaunchArtifacts,
	scorePublicQueryIdentityRun,
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
		const launch = createQueryIdentityLaunchArtifacts({
			oracle: currentOracle,
			...timestamp,
			engine: "naia-memory",
			model: "closed-vocabulary-v1",
			launchedAt: "2026-08-22T01:01:00.000Z",
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

		predictions.run.createdAt = launch.receipt.launchedAt;
		expect(() =>
			scorePublicQueryIdentityRun({
				oracle: currentOracle,
				predictions,
				launchReceipt: launch.receipt,
				...timestamp,
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
