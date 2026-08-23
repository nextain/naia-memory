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
	issueSemanticCompetitiveQualification,
	semanticQualificationTrustAnchor,
} from "./semantic-competitive-qualification-issuer.js";
import { validateSemanticCompetitiveQualification } from "./semantic-competitive-qualification.js";
import { semanticCampaignConfigurationSha256 } from "./semantic-confirmatory-execution-authorization.js";

const pem = (key: ReturnType<typeof generateKeyPairSync>["publicKey"]) =>
	key.export({ type: "spki", format: "pem" }).toString();

describe("semantic competitive qualification issuer", () => {
	it("issues only after deployment-policy validation and produces a pinned-verifiable artifact", () => {
		const directory = mkdtempSync(resolve(tmpdir(), "qualification-issuer-"));
		const administrator = generateKeyPairSync("ed25519");
		const authorizer = generateKeyPairSync("ed25519");
		const gate = generateKeyPairSync("ed25519");
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
		const campaignConfiguration = {
			executionSeed: "frozen-seed",
			repetitions: 3,
			topK: 5,
			engines: ["naia", "hindsight", "mem0"],
		};
		const unsignedAuthorization = {
			schemaVersion:
				"naia-memory-semantic-confirmatory-execution-authorization-v1" as const,
			authorizer: "external-authorizer",
			contractSha256: evidenceObjectSha256(contract),
			analysisPlanSha256: evidenceObjectSha256(analysisPlan),
			analysisPlanTrustPolicySha256: evidenceObjectSha256(
				analysisPlanTrustPolicy,
			),
			timestampTrustPolicyIdentitySha256: timestampIdentitySha256,
			campaignConfigurationSha256: semanticCampaignConfigurationSha256(
				campaignConfiguration,
			),
			authorizedAt: "2026-08-24T01:00:00.000Z",
			expiresAt: "2026-08-24T03:00:00.000Z",
			statement:
				"CONFIRMATORY_EXECUTION_AUTHORIZED_AFTER_TRUSTED_PREREGISTRATION" as const,
		};
		const authorization = {
			...unsignedAuthorization,
			signatureBase64: sign(
				null,
				evidenceSignaturePayload(unsignedAuthorization),
				authorizer.privateKey,
			).toString("base64"),
		};
		const policy = {
			deploymentId: "public-sidecar-2026-08",
			gateKeyId: "gate-2026-08",
			gatePrivateKeyPem: gate.privateKey
				.export({ type: "pkcs8", format: "pem" })
				.toString(),
			verifierPolicy: {
				authorizerPublicKeys: {
					"external-authorizer": pem(authorizer.publicKey),
				},
				approvedAnalysisPlanTrustPolicySha256: evidenceObjectSha256(
					analysisPlanTrustPolicy,
				),
				approvedTimestampTrustPolicyIdentitySha256: timestampIdentitySha256,
			},
			analysisPlanTrustPolicy,
			timestampTrustPolicy,
		};
		const timestampEvidence = {
			schemaVersion:
				"naia-memory-rfc3161-digest-timestamp-evidence-v1" as const,
			artifactSha256: evidenceObjectSha256(analysisPlan),
			tokenSha256: createHash("sha256").update(token).digest("hex"),
			tokenPath,
		};
		const campaign = {
			schemaVersion: "naia-memory-semantic-campaign-v5",
			disclosure: {
				eligibility: "competitive-candidate",
				...campaignConfiguration,
				analysisPlanSha256: evidenceObjectSha256(analysisPlan),
				confirmatoryAuthorizationSha256: evidenceObjectSha256(authorization),
				analysisPlanTimestampEvidenceSha256:
					evidenceObjectSha256(timestampEvidence),
				analysisPlanTimestampTrustPolicyIdentitySha256: timestampIdentitySha256,
				claimScope: analysisPlan.claimScope,
				comparisonLanes: analysisPlan.comparisonLanes,
				crossLaneAggregation: analysisPlan.crossLaneAggregation,
			},
		};
		const executionEvidence = {
			receipts: [
				{
					startedAt: "2026-08-24T01:30:00.000Z",
					completedAt: "2026-08-24T02:30:00.000Z",
				},
			],
		};
		const adjudicationEvidence = { adjudication: "frozen" };
		const issue = (overrides = {}) =>
			issueSemanticCompetitiveQualification({
				policy,
				contract,
				campaign,
				analysisPlan,
				authorization,
				timestampEvidence,
				executionEvidence,
				adjudicationEvidence,
				campaignConfiguration,
				issuedAt: "2026-08-24T03:00:00.000Z",
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
			const qualification = issue();
			expect(
				validateSemanticCompetitiveQualification({
					qualification,
					trustAnchor: semanticQualificationTrustAnchor(policy),
					subjects: {
						contract,
						campaign,
						analysisPlan,
						authorization,
						timestampEvidence,
						executionEvidence,
						adjudicationEvidence,
					},
					executionReceipts: executionEvidence.receipts,
				}),
			).toMatchObject({ competitiveQualificationVerified: true });
			expect(() => issue({ issuedAt: "2026-08-24T02:59:59.999Z" })).toThrow(
				"before authorization expiry",
			);
			expect(() =>
				issue({
					campaignConfiguration: { ...campaignConfiguration, topK: 10 },
				}),
			).toThrow("authorization binding");
			expect(() =>
				issue({
					campaign: {
						schemaVersion: "naia-memory-semantic-campaign-v5",
						disclosure: { eligibility: "competitive-candidate" },
					},
				}),
			).toThrow("campaign binding");
			expect(() =>
				issue({
					campaign: {
						...campaign,
						schemaVersion: "naia-memory-semantic-campaign-v4",
					},
				}),
			).toThrow("campaign binding");
			expect(() =>
				issue({
					campaign: {
						...campaign,
						disclosure: {
							...campaign.disclosure,
							comparisonLanes: {
								...analysisPlan.comparisonLanes,
								directLifecycle: ["hindsight"],
							},
						},
					},
				}),
			).toThrow("campaign binding");
			expect(() =>
				issue({
					campaign: {
						...campaign,
						disclosure: {
							...campaign.disclosure,
							confirmatoryAuthorizationSha256: "0".repeat(64),
						},
					},
				}),
			).toThrow("campaign binding");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
