import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import {
	evidenceObjectSha256,
	evidenceSignaturePayload,
} from "./public-evidence-crypto.js";
import {
	type Rfc3161CommandRunner,
	type Rfc3161DigestTimestampEvidence,
	type Rfc3161TimestampTrustPolicy,
	rfc3161TrustPolicyIdentity,
} from "./rfc3161-timestamp.js";
import type {
	SemanticAnalysisPlan,
	SemanticAnalysisPlanTrustPolicy,
} from "./semantic-analysis-plan.js";
import { semanticQualificationTrustAnchorFromPublicPolicy } from "./semantic-competitive-qualification-trust-store.js";
import {
	SEMANTIC_QUALIFICATION_SUBJECTS,
	type SemanticCompetitiveQualification,
	type SemanticQualificationSubjects,
	type SemanticQualificationTrustAnchor,
	validateSemanticCompetitiveQualification,
} from "./semantic-competitive-qualification.js";
import {
	type SemanticCampaignConfiguration,
	type SemanticConfirmatoryExecutionAuthorization,
	type SemanticConfirmatoryVerifierPolicy,
	validateSemanticConfirmatoryExecutionAuthorization,
} from "./semantic-confirmatory-execution-authorization.js";

export type SemanticQualificationDeploymentPolicy = {
	deploymentId: string;
	gateKeyId: string;
	gatePrivateKeyPem: string;
	verifierPolicy: SemanticConfirmatoryVerifierPolicy;
	analysisPlanTrustPolicy: SemanticAnalysisPlanTrustPolicy;
	timestampTrustPolicy: Rfc3161TimestampTrustPolicy;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateCompetitiveCandidateBinding(input: {
	campaign: unknown;
	analysisPlan: SemanticAnalysisPlan;
	authorization: SemanticConfirmatoryExecutionAuthorization;
	timestampEvidence: Rfc3161DigestTimestampEvidence;
	timestampTrustPolicy: Rfc3161TimestampTrustPolicy;
	campaignConfiguration: SemanticCampaignConfiguration;
}): void {
	if (!isRecord(input.campaign) || !isRecord(input.campaign.disclosure))
		throw new Error("semantic qualification campaign shape is invalid");
	const disclosure = input.campaign.disclosure;
	const configuration = input.campaignConfiguration;
	if (
		input.campaign.schemaVersion !== "naia-memory-semantic-campaign-v5" ||
		disclosure.eligibility !== "competitive-candidate" ||
		disclosure.executionSeed !== configuration.executionSeed ||
		disclosure.repetitions !== configuration.repetitions ||
		disclosure.topK !== configuration.topK ||
		JSON.stringify(disclosure.engines) !==
			JSON.stringify(configuration.engines) ||
		disclosure.analysisPlanSha256 !==
			evidenceObjectSha256(input.analysisPlan) ||
		disclosure.confirmatoryAuthorizationSha256 !==
			evidenceObjectSha256(input.authorization) ||
		disclosure.analysisPlanTimestampEvidenceSha256 !==
			evidenceObjectSha256(input.timestampEvidence) ||
		disclosure.analysisPlanTimestampTrustPolicyIdentitySha256 !==
			evidenceObjectSha256(
				rfc3161TrustPolicyIdentity(input.timestampTrustPolicy),
			) ||
		disclosure.claimScope !== input.analysisPlan.claimScope ||
		JSON.stringify(disclosure.comparisonLanes) !==
			JSON.stringify(input.analysisPlan.comparisonLanes) ||
		disclosure.crossLaneAggregation !== input.analysisPlan.crossLaneAggregation
	)
		throw new Error("semantic qualification campaign binding is invalid");
}

export function semanticQualificationTrustAnchor(
	policy: SemanticQualificationDeploymentPolicy,
): SemanticQualificationTrustAnchor {
	const privateKey = createPrivateKey(policy.gatePrivateKeyPem);
	if (privateKey.asymmetricKeyType !== "ed25519")
		throw new Error("semantic qualification gate key must be Ed25519");
	if (!policy.deploymentId.trim() || !policy.gateKeyId.trim())
		throw new Error("semantic qualification deployment identity is invalid");
	const gatePublicKey = createPublicKey(privateKey)
		.export({ type: "spki", format: "pem" })
		.toString();
	return semanticQualificationTrustAnchorFromPublicPolicy({
		schemaVersion:
			"naia-memory-semantic-qualification-public-deployment-policy-v1",
		deploymentId: policy.deploymentId,
		gateKeyId: policy.gateKeyId,
		gatePublicKeyPem: gatePublicKey,
		verifierPolicy: policy.verifierPolicy,
		analysisPlanTrustPolicy: policy.analysisPlanTrustPolicy,
		timestampTrustPolicyIdentity: rfc3161TrustPolicyIdentity(
			policy.timestampTrustPolicy,
		),
	});
}

export function issueSemanticCompetitiveQualification(input: {
	policy: SemanticQualificationDeploymentPolicy;
	contract: unknown;
	campaign: unknown;
	analysisPlan: SemanticAnalysisPlan;
	authorization: SemanticConfirmatoryExecutionAuthorization;
	timestampEvidence: Rfc3161DigestTimestampEvidence;
	executionEvidence: {
		receipts: Array<{ startedAt: string; completedAt: string }>;
	};
	adjudicationEvidence: unknown;
	campaignConfiguration: SemanticCampaignConfiguration;
	issuedAt: string;
	commandRunner?: Rfc3161CommandRunner;
}): SemanticCompetitiveQualification {
	const firstExecutionStartedAt = input.executionEvidence.receipts
		.map((receipt) => receipt.startedAt)
		.sort()[0];
	if (!firstExecutionStartedAt)
		throw new Error("semantic qualification has no execution receipts");
	validateSemanticConfirmatoryExecutionAuthorization({
		authorization: input.authorization,
		verifierPolicy: input.policy.verifierPolicy,
		contract: input.contract,
		analysisPlan: input.analysisPlan,
		analysisPlanTrustPolicy: input.policy.analysisPlanTrustPolicy,
		timestampEvidence: input.timestampEvidence,
		timestampTrustPolicy: input.policy.timestampTrustPolicy,
		campaignConfiguration: input.campaignConfiguration,
		firstExecutionStartedAt,
		commandRunner: input.commandRunner,
	});
	validateCompetitiveCandidateBinding({
		campaign: input.campaign,
		analysisPlan: input.analysisPlan,
		authorization: input.authorization,
		timestampEvidence: input.timestampEvidence,
		timestampTrustPolicy: input.policy.timestampTrustPolicy,
		campaignConfiguration: input.campaignConfiguration,
	});
	const subjects: SemanticQualificationSubjects = {
		contract: input.contract,
		campaign: input.campaign,
		analysisPlan: input.analysisPlan,
		authorization: input.authorization,
		timestampEvidence: input.timestampEvidence,
		executionEvidence: input.executionEvidence,
		adjudicationEvidence: input.adjudicationEvidence,
	};
	const anchor = semanticQualificationTrustAnchor(input.policy);
	const unsigned = {
		schemaVersion: "naia-memory-semantic-competitive-qualification-v1" as const,
		verdict: "qualified" as const,
		deploymentId: anchor.deploymentId,
		trustStoreSha256: anchor.trustStoreSha256,
		gateKeyId: input.policy.gateKeyId,
		subjects: Object.fromEntries(
			SEMANTIC_QUALIFICATION_SUBJECTS.map((subject) => [
				`${subject}Sha256`,
				evidenceObjectSha256(subjects[subject]),
			]),
		) as SemanticCompetitiveQualification["subjects"],
		authorizationWindow: {
			authorizedAt: input.authorization.authorizedAt,
			expiresAt: input.authorization.expiresAt,
		},
		issuedAt: input.issuedAt,
		statement:
			"COMPETITIVE_CANDIDATE_VERIFIED_AGAINST_DEPLOYMENT_TRUST_STORE" as const,
	};
	if (Date.parse(input.issuedAt) < Date.parse(input.authorization.expiresAt))
		throw new Error(
			"semantic qualification cannot be issued before authorization expiry",
		);
	const qualification: SemanticCompetitiveQualification = {
		...unsigned,
		signatureBase64: sign(
			null,
			evidenceSignaturePayload(unsigned),
			createPrivateKey(input.policy.gatePrivateKeyPem),
		).toString("base64"),
	};
	validateSemanticCompetitiveQualification({
		qualification,
		trustAnchor: anchor,
		subjects,
		executionReceipts: input.executionEvidence.receipts,
	});
	return qualification;
}
