import { createPublicKey } from "node:crypto";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import {
	type SemanticAnalysisPlanTrustPolicy,
	isSemanticAnalysisPlanTrustPolicy,
} from "./semantic-analysis-plan.js";
import type { SemanticQualificationTrustAnchor } from "./semantic-competitive-qualification.js";
import type { SemanticConfirmatoryVerifierPolicy } from "./semantic-confirmatory-execution-authorization.js";

export type SemanticQualificationTimestampTrustPolicyIdentity = {
	schemaVersion: 1;
	trustedCaFileSha256: string;
	requiredPolicyOid: string;
};

export type SemanticQualificationPublicDeploymentPolicy = {
	schemaVersion: "naia-memory-semantic-qualification-public-deployment-policy-v1";
	deploymentId: string;
	gateKeyId: string;
	gatePublicKeyPem: string;
	verifierPolicy: SemanticConfirmatoryVerifierPolicy;
	analysisPlanTrustPolicy: SemanticAnalysisPlanTrustPolicy;
	timestampTrustPolicyIdentity: SemanticQualificationTimestampTrustPolicyIdentity;
};

function canonicalEd25519PublicKey(value: unknown): string | null {
	if (typeof value !== "string") return null;
	try {
		const key = createPublicKey(value);
		return key.asymmetricKeyType === "ed25519"
			? key.export({ type: "spki", format: "pem" }).toString()
			: null;
	} catch {
		return null;
	}
}

const SHA256 = /^[a-f0-9]{64}$/u;
const POLICY_OID = /^\d+(?:\.\d+)+$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalPublicKeyMap(value: unknown): Record<string, string> | null {
	if (!isRecord(value) || Object.keys(value).length === 0) return null;
	const entries = Object.entries(value).map(
		([identity, publicKey]) =>
			[
				identity,
				typeof publicKey === "string"
					? canonicalEd25519PublicKey(publicKey)
					: null,
			] as const,
	);
	if (
		entries.some(
			([identity, publicKey]) => !identity.trim() || publicKey === null,
		)
	)
		return null;
	return Object.fromEntries(entries) as Record<string, string>;
}

export function semanticQualificationTrustAnchorFromPublicPolicy(
	policy: unknown,
): SemanticQualificationTrustAnchor {
	if (!isRecord(policy))
		throw new Error(
			"semantic qualification public deployment policy is invalid",
		);
	const gatePublicKey = canonicalEd25519PublicKey(policy.gatePublicKeyPem);
	const verifierPolicy = isRecord(policy.verifierPolicy)
		? policy.verifierPolicy
		: null;
	const authorizerPublicKeys = canonicalPublicKeyMap(
		verifierPolicy?.authorizerPublicKeys,
	);
	const analysisPlanTrustPolicy = isSemanticAnalysisPlanTrustPolicy(
		policy.analysisPlanTrustPolicy,
	)
		? {
				administratorPublicKeys: canonicalPublicKeyMap(
					policy.analysisPlanTrustPolicy.administratorPublicKeys,
				),
			}
		: null;
	const timestampIdentity = isRecord(policy.timestampTrustPolicyIdentity)
		? policy.timestampTrustPolicyIdentity
		: null;
	if (
		policy.schemaVersion !==
			"naia-memory-semantic-qualification-public-deployment-policy-v1" ||
		typeof policy.deploymentId !== "string" ||
		!policy.deploymentId.trim() ||
		typeof policy.gateKeyId !== "string" ||
		!policy.gateKeyId.trim() ||
		!gatePublicKey ||
		!verifierPolicy ||
		!authorizerPublicKeys ||
		typeof verifierPolicy.approvedAnalysisPlanTrustPolicySha256 !== "string" ||
		!SHA256.test(verifierPolicy.approvedAnalysisPlanTrustPolicySha256) ||
		typeof verifierPolicy.approvedTimestampTrustPolicyIdentitySha256 !==
			"string" ||
		!SHA256.test(verifierPolicy.approvedTimestampTrustPolicyIdentitySha256) ||
		!analysisPlanTrustPolicy?.administratorPublicKeys ||
		!timestampIdentity ||
		timestampIdentity.schemaVersion !== 1 ||
		typeof timestampIdentity.trustedCaFileSha256 !== "string" ||
		!SHA256.test(timestampIdentity.trustedCaFileSha256) ||
		typeof timestampIdentity.requiredPolicyOid !== "string" ||
		!POLICY_OID.test(timestampIdentity.requiredPolicyOid)
	)
		throw new Error(
			"semantic qualification public deployment policy is invalid",
		);
	const trustStoreSha256 = evidenceObjectSha256({
		deploymentId: policy.deploymentId,
		gateKeyId: policy.gateKeyId,
		gatePublicKey,
		verifierPolicy: {
			authorizerPublicKeys,
			approvedAnalysisPlanTrustPolicySha256:
				verifierPolicy.approvedAnalysisPlanTrustPolicySha256,
			approvedTimestampTrustPolicyIdentitySha256:
				verifierPolicy.approvedTimestampTrustPolicyIdentitySha256,
		},
		analysisPlanTrustPolicy,
		timestampTrustPolicyIdentity: {
			schemaVersion: 1,
			trustedCaFileSha256: timestampIdentity.trustedCaFileSha256,
			requiredPolicyOid: timestampIdentity.requiredPolicyOid,
		},
	});
	return {
		deploymentId: policy.deploymentId,
		trustStoreSha256,
		gatePublicKeys: { [policy.gateKeyId]: gatePublicKey },
	};
}

export function renderSemanticQualificationTrustAnchorModule(
	policy: SemanticQualificationPublicDeploymentPolicy,
): string {
	const anchor = semanticQualificationTrustAnchorFromPublicPolicy(policy);
	return [
		'import type { SemanticQualificationTrustAnchor } from "./semantic-competitive-qualification.js";',
		"",
		"// Generated from a deployment-owned public policy. Never place private keys in this module.",
		"export const PROVISIONED_SEMANTIC_COMPETITIVE_QUALIFICATION_TRUST_ANCHOR =",
		`${JSON.stringify(anchor, null, "\t")} as const satisfies SemanticQualificationTrustAnchor;`,
		"",
	].join("\n");
}
