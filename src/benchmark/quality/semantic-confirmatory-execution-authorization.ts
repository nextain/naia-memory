import { createPublicKey } from "node:crypto";
import {
	evidenceObjectSha256,
	evidencePublicKeysMatch,
	hasValidEvidenceSignature,
} from "./public-evidence-crypto.js";
import {
	type Rfc3161CommandRunner,
	type Rfc3161DigestTimestampEvidence,
	type Rfc3161TimestampTrustPolicy,
	rfc3161TrustPolicyIdentity,
	validateRfc3161DigestTimestampBinding,
} from "./rfc3161-timestamp.js";
import type {
	SemanticAnalysisPlan,
	SemanticAnalysisPlanTrustPolicy,
} from "./semantic-analysis-plan.js";
import { isSemanticAnalysisPlan } from "./semantic-analysis-plan.js";

const SHA256 = /^[a-f0-9]{64}$/u;

export type SemanticCampaignConfiguration = {
	executionSeed: string;
	repetitions: number;
	topK: number;
	engines: string[];
};

export type SemanticConfirmatoryExecutionAuthorization = {
	schemaVersion: "naia-memory-semantic-confirmatory-execution-authorization-v1";
	authorizer: string;
	contractSha256: string;
	analysisPlanSha256: string;
	analysisPlanTrustPolicySha256: string;
	timestampTrustPolicyIdentitySha256: string;
	campaignConfigurationSha256: string;
	authorizedAt: string;
	expiresAt: string;
	statement: "CONFIRMATORY_EXECUTION_AUTHORIZED_AFTER_TRUSTED_PREREGISTRATION";
	signatureBase64: string;
};

export type SemanticConfirmatoryVerifierPolicy = {
	authorizerPublicKeys: Record<string, string>;
	approvedAnalysisPlanTrustPolicySha256: string;
	approvedTimestampTrustPolicyIdentitySha256: string;
};

function validTime(value: unknown): number {
	if (
		typeof value !== "string" ||
		!/^(?:\d{4})-(?:\d{2})-(?:\d{2})T(?:\d{2}):(?:\d{2}):(?:\d{2})\.\d{3}Z$/u.test(
			value,
		)
	)
		return Number.NaN;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
		? parsed
		: Number.NaN;
}

function validEd25519Key(value: unknown): value is string {
	if (typeof value !== "string") return false;
	try {
		return createPublicKey(value).asymmetricKeyType === "ed25519";
	} catch {
		return false;
	}
}

export function semanticCampaignConfigurationSha256(
	configuration: SemanticCampaignConfiguration,
): string {
	if (
		!configuration.executionSeed.trim() ||
		!Number.isInteger(configuration.repetitions) ||
		configuration.repetitions < 1 ||
		!Number.isInteger(configuration.topK) ||
		configuration.topK < 1 ||
		configuration.engines.length < 2 ||
		new Set(configuration.engines).size !== configuration.engines.length ||
		configuration.engines.some((engine) => !engine.trim())
	)
		throw new Error("semantic campaign authorization configuration is invalid");
	return evidenceObjectSha256(configuration);
}

export function validateSemanticConfirmatoryExecutionAuthorization(input: {
	authorization: SemanticConfirmatoryExecutionAuthorization;
	verifierPolicy: SemanticConfirmatoryVerifierPolicy;
	contract: unknown;
	analysisPlan: SemanticAnalysisPlan;
	analysisPlanTrustPolicy: SemanticAnalysisPlanTrustPolicy;
	timestampEvidence: Rfc3161DigestTimestampEvidence;
	timestampTrustPolicy: Rfc3161TimestampTrustPolicy;
	campaignConfiguration: SemanticCampaignConfiguration;
	firstExecutionStartedAt: string;
	commandRunner?: Rfc3161CommandRunner;
}): {
	launchAuthorizationValidatedAgainstConfiguredPolicy: true;
	analysisPlanTimestampValidatedAgainstConfiguredPolicy: true;
	authorizationScope: "execution-start-only";
	analysisPlanTimestampedAt: string;
	authorizer: string;
} {
	const { authorization, verifierPolicy, analysisPlan } = input;
	if (!isSemanticAnalysisPlan(analysisPlan))
		throw new Error("semantic analysis plan shape is invalid");
	const authorizerKey =
		verifierPolicy.authorizerPublicKeys[authorization.authorizer];
	const analysisAdministratorKey =
		input.analysisPlanTrustPolicy.administratorPublicKeys[
			analysisPlan.administrator
		];
	const authorizedAt = validTime(authorization.authorizedAt);
	const expiresAt = validTime(authorization.expiresAt);
	const executionStartedAt = validTime(input.firstExecutionStartedAt);
	const planSignedAt = validTime(analysisPlan.signedAt);
	const analysisPlanTrustPolicySha256 = evidenceObjectSha256(
		input.analysisPlanTrustPolicy,
	);
	const timestampTrustPolicyIdentitySha256 = evidenceObjectSha256(
		rfc3161TrustPolicyIdentity(input.timestampTrustPolicy),
	);
	if (
		authorization.schemaVersion !==
			"naia-memory-semantic-confirmatory-execution-authorization-v1" ||
		typeof authorization.authorizer !== "string" ||
		!authorization.authorizer.trim() ||
		![
			authorization.contractSha256,
			authorization.analysisPlanSha256,
			authorization.analysisPlanTrustPolicySha256,
			authorization.timestampTrustPolicyIdentitySha256,
			authorization.campaignConfigurationSha256,
			verifierPolicy.approvedAnalysisPlanTrustPolicySha256,
			verifierPolicy.approvedTimestampTrustPolicyIdentitySha256,
		].every((value) => SHA256.test(value)) ||
		authorization.statement !==
			"CONFIRMATORY_EXECUTION_AUTHORIZED_AFTER_TRUSTED_PREREGISTRATION" ||
		!Number.isFinite(authorizedAt) ||
		!Number.isFinite(expiresAt) ||
		!Number.isFinite(executionStartedAt) ||
		!Number.isFinite(planSignedAt) ||
		expiresAt <= authorizedAt ||
		executionStartedAt < authorizedAt ||
		executionStartedAt >= expiresAt ||
		!validEd25519Key(authorizerKey) ||
		!hasValidEvidenceSignature(authorization, authorizerKey)
	)
		throw new Error("semantic confirmatory execution authorization is invalid");
	if (
		authorization.contractSha256 !== evidenceObjectSha256(input.contract) ||
		authorization.analysisPlanSha256 !== evidenceObjectSha256(analysisPlan) ||
		authorization.analysisPlanTrustPolicySha256 !==
			analysisPlanTrustPolicySha256 ||
		authorization.timestampTrustPolicyIdentitySha256 !==
			timestampTrustPolicyIdentitySha256 ||
		authorization.campaignConfigurationSha256 !==
			semanticCampaignConfigurationSha256(input.campaignConfiguration) ||
		verifierPolicy.approvedAnalysisPlanTrustPolicySha256 !==
			analysisPlanTrustPolicySha256 ||
		verifierPolicy.approvedTimestampTrustPolicyIdentitySha256 !==
			timestampTrustPolicyIdentitySha256
	)
		throw new Error(
			"semantic confirmatory execution authorization binding is invalid",
		);
	if (
		authorization.authorizer === analysisPlan.administrator ||
		evidencePublicKeysMatch(authorizerKey, analysisAdministratorKey)
	)
		throw new Error(
			"semantic confirmatory authorizer overlaps analysis administrator",
		);
	const timestamp = validateRfc3161DigestTimestampBinding({
		expectedArtifactSha256: evidenceObjectSha256(analysisPlan),
		evidence: input.timestampEvidence,
		trustPolicy: input.timestampTrustPolicy,
		commandRunner: input.commandRunner,
	});
	if (Date.parse(timestamp.timestampedAt) >= authorizedAt)
		throw new Error(
			"semantic analysis plan was not timestamped before authorization",
		);
	const timestampedAt = validTime(timestamp.timestampedAt);
	if (!Number.isFinite(timestampedAt) || planSignedAt > timestampedAt)
		throw new Error("semantic analysis plan signature chronology is invalid");
	return {
		launchAuthorizationValidatedAgainstConfiguredPolicy: true,
		analysisPlanTimestampValidatedAgainstConfiguredPolicy: true,
		authorizationScope: "execution-start-only",
		analysisPlanTimestampedAt: timestamp.timestampedAt,
		authorizer: authorization.authorizer,
	};
}
