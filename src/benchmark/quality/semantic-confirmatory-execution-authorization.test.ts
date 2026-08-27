import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	evidenceObjectSha256,
	evidenceSignaturePayload,
} from "./public-evidence-crypto.js";
import type { SemanticAnalysisPlan } from "./semantic-analysis-plan.js";
import {
	semanticCampaignConfigurationSha256,
	validateSemanticConfirmatoryExecutionAuthorization,
} from "./semantic-confirmatory-execution-authorization.js";

const pem = (key: ReturnType<typeof generateKeyPairSync>["publicKey"]) =>
	key.export({ type: "spki", format: "pem" }).toString();

describe("semantic confirmatory execution authorization", () => {
	it("binds an independently authorized campaign to prior trusted plan evidence", () => {
		const directory = mkdtempSync(resolve(tmpdir(), "semantic-authorization-"));
		const administrator = generateKeyPairSync("ed25519");
		const authorizer = generateKeyPairSync("ed25519");
		const token = Buffer.from("timestamp-token");
		const ca = Buffer.from("timestamp-ca");
		const tokenPath = resolve(directory, "plan.tsr");
		const caPath = resolve(directory, "ca.pem");
		writeFileSync(tokenPath, token);
		writeFileSync(caPath, ca);
		const contract = { contract: "frozen" };
		const analysisPlan = {
			schemaVersion: "naia-memory-semantic-analysis-plan-v5",
			administrator: "plan-admin",
			contractSha256: evidenceObjectSha256(contract),
			engines: ["naia", "hindsight", "mem0"],
			primaryEngine: "naia",
			primaryMetric: "currentAt1",
			primaryComparisons: ["hindsight", "mem0"],
			claimScope: "direct-lifecycle-competitive-report-v1",
			comparisonLanes: {
				directLifecycle: ["hindsight", "mem0"],
				nativeTemporalCharacterization: [],
				agentManagedCharacterization: [],
				productIntegrationDiagnostic: [],
			},
			crossLaneAggregation: "prohibited",
			familyWiseAlpha: 0.05,
			multiplicityAdjustment: "holm",
			targetPower: 0.8,
			minimumDetectableDifference: 0.1,
			minimumPracticallyImportantDifference: 0.1,
			decisionRule: "holm-all-language-competitor-superiority",
			requiredIndependentAuthorClustersByLanguage: { ko: 1 },
			requiredIndependentConstructionClustersByLanguage: { ko: 1 },
			independenceUnit: "construction-cluster",
			sensitivityAnalysis:
				"author-equal-and-family-equal-directional-agreement",
			sampleSizeMethod: "paired-family simulation",
			sampleSizeAssumptionsSha256: "1".repeat(64),
			stoppingRule: "collect-all-frozen-test-families-no-outcome-peeking",
			createdAt: "2026-08-23T22:00:00.000Z",
			signedAt: "2026-08-23T23:00:00.000Z",
			statement: "ANALYSIS_PLAN_PREREGISTERED",
			signatureBase64: "placeholder",
		} as SemanticAnalysisPlan;
		const analysisPlanTrustPolicy = {
			administratorPublicKeys: { "plan-admin": pem(administrator.publicKey) },
		};
		const timestampTrustPolicy = {
			schemaVersion: "naia-memory-rfc3161-timestamp-trust-policy-v1" as const,
			trustedCaFilePath: caPath,
			trustedCaFileSha256: createHash("sha256").update(ca).digest("hex"),
			requiredPolicyOid: "1.2.3.4",
		};
		const timestampIdentitySha256 = evidenceObjectSha256({
			schemaVersion: 1,
			trustedCaFileSha256: timestampTrustPolicy.trustedCaFileSha256,
			requiredPolicyOid: timestampTrustPolicy.requiredPolicyOid,
		});
		const configuration = {
			executionSeed: "frozen-seed",
			repetitions: 2,
			topK: 5,
			engines: ["naia", "hindsight", "mem0"],
		};
		const unsigned = {
			schemaVersion:
				"naia-memory-semantic-confirmatory-execution-authorization-v1" as const,
			authorizer: "external-authorizer",
			contractSha256: evidenceObjectSha256(contract),
			analysisPlanSha256: evidenceObjectSha256(analysisPlan),
			analysisPlanTrustPolicySha256: evidenceObjectSha256(
				analysisPlanTrustPolicy,
			),
			timestampTrustPolicyIdentitySha256: timestampIdentitySha256,
			campaignConfigurationSha256:
				semanticCampaignConfigurationSha256(configuration),
			authorizedAt: "2026-08-24T01:00:00.000Z",
			expiresAt: "2026-08-25T01:00:00.000Z",
			statement:
				"CONFIRMATORY_EXECUTION_AUTHORIZED_AFTER_TRUSTED_PREREGISTRATION" as const,
		};
		const authorization = {
			...unsigned,
			signatureBase64: sign(
				null,
				evidenceSignaturePayload(unsigned),
				authorizer.privateKey,
			).toString("base64"),
		};
		const verifierPolicy = {
			authorizerPublicKeys: {
				"external-authorizer": pem(authorizer.publicKey),
			},
			approvedAnalysisPlanTrustPolicySha256: evidenceObjectSha256(
				analysisPlanTrustPolicy,
			),
			approvedTimestampTrustPolicyIdentitySha256: timestampIdentitySha256,
		};
		const validate = (overrides = {}) =>
			validateSemanticConfirmatoryExecutionAuthorization({
				authorization,
				verifierPolicy,
				contract,
				analysisPlan,
				analysisPlanTrustPolicy,
				timestampEvidence: {
					schemaVersion: "naia-memory-rfc3161-digest-timestamp-evidence-v1",
					artifactSha256: evidenceObjectSha256(analysisPlan),
					tokenSha256: createHash("sha256").update(token).digest("hex"),
					tokenPath,
				},
				timestampTrustPolicy,
				campaignConfiguration: configuration,
				firstExecutionStartedAt: "2026-08-24T02:00:00.000Z",
				commandRunner: (args) =>
					args.includes("-verify")
						? { status: 0, stdout: "", stderr: "" }
						: {
								status: 0,
								stdout:
									"Policy OID: 1.2.3.4\nTime stamp: Aug 24 00:00:00 2026 GMT\n",
								stderr: "",
							},
				...overrides,
			});
		try {
			expect(validate()).toMatchObject({
				launchAuthorizationValidatedAgainstConfiguredPolicy: true,
				analysisPlanTimestampValidatedAgainstConfiguredPolicy: true,
				authorizationScope: "execution-start-only",
			});
			expect(() =>
				validate({
					campaignConfiguration: { ...configuration, topK: 10 },
				}),
			).toThrow("authorization binding");
			expect(() =>
				validate({
					verifierPolicy: {
						...verifierPolicy,
						approvedAnalysisPlanTrustPolicySha256: "0".repeat(64),
					},
				}),
			).toThrow("authorization binding");
			expect(() =>
				validate({ firstExecutionStartedAt: "2026-08-25T02:00:00.000Z" }),
			).toThrow("authorization is invalid");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
