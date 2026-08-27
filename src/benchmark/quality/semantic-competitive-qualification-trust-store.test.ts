import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { semanticQualificationTrustAnchor } from "./semantic-competitive-qualification-issuer.js";
import {
	type SemanticQualificationPublicDeploymentPolicy,
	renderSemanticQualificationTrustAnchorModule,
	semanticQualificationTrustAnchorFromPublicPolicy,
} from "./semantic-competitive-qualification-trust-store.js";

function keys() {
	const pair = generateKeyPairSync("ed25519");
	return {
		privateKey: pair.privateKey
			.export({ type: "pkcs8", format: "pem" })
			.toString(),
		publicKey: pair.publicKey
			.export({ type: "spki", format: "pem" })
			.toString(),
	};
}

function fixture() {
	const gate = keys();
	const authorizer = keys();
	const administrator = keys();
	const timestampTrustPolicy = {
		schemaVersion: "naia-memory-rfc3161-timestamp-trust-policy-v1" as const,
		trustedCaFilePath: "/release/trust/timestamp-ca.pem",
		trustedCaFileSha256: "a".repeat(64),
		requiredPolicyOid: "1.2.3.4",
	};
	const publicPolicy: SemanticQualificationPublicDeploymentPolicy = {
		schemaVersion:
			"naia-memory-semantic-qualification-public-deployment-policy-v1",
		deploymentId: "production-2026-08",
		gateKeyId: "qualification-gate-1",
		gatePublicKeyPem: gate.publicKey,
		verifierPolicy: {
			authorizerPublicKeys: { release: authorizer.publicKey },
			approvedAnalysisPlanTrustPolicySha256: "b".repeat(64),
			approvedTimestampTrustPolicyIdentitySha256: "c".repeat(64),
		},
		analysisPlanTrustPolicy: {
			administratorPublicKeys: { research: administrator.publicKey },
		},
		timestampTrustPolicyIdentity: {
			schemaVersion: 1,
			trustedCaFileSha256: timestampTrustPolicy.trustedCaFileSha256,
			requiredPolicyOid: timestampTrustPolicy.requiredPolicyOid,
		},
	};
	return { gate, publicPolicy, timestampTrustPolicy };
}

describe("semantic qualification trust-store provisioning", () => {
	it("derives the same anchor from public release policy and private issuer policy", () => {
		const { gate, publicPolicy, timestampTrustPolicy } = fixture();
		expect(
			semanticQualificationTrustAnchorFromPublicPolicy(publicPolicy),
		).toEqual(
			semanticQualificationTrustAnchor({
				deploymentId: publicPolicy.deploymentId,
				gateKeyId: publicPolicy.gateKeyId,
				gatePrivateKeyPem: gate.privateKey,
				verifierPolicy: publicPolicy.verifierPolicy,
				analysisPlanTrustPolicy: publicPolicy.analysisPlanTrustPolicy,
				timestampTrustPolicy,
			}),
		);
	});

	it("renders a deterministic secret-free static module", () => {
		const { gate, publicPolicy } = fixture();
		const rendered = renderSemanticQualificationTrustAnchorModule(publicPolicy);
		expect(rendered).toBe(
			renderSemanticQualificationTrustAnchorModule(publicPolicy),
		);
		expect(rendered).toContain(publicPolicy.deploymentId);
		expect(rendered).toContain(JSON.stringify(publicPolicy.gatePublicKeyPem));
		expect(rendered).not.toContain(gate.privateKey.trim());
		expect(rendered).not.toContain("PRIVATE KEY");
	});

	it("changes the pinned digest when any public trust policy changes", () => {
		const { publicPolicy } = fixture();
		const original =
			semanticQualificationTrustAnchorFromPublicPolicy(publicPolicy);
		const tampered = structuredClone(publicPolicy);
		tampered.timestampTrustPolicyIdentity.requiredPolicyOid = "1.2.3.5";
		expect(
			semanticQualificationTrustAnchorFromPublicPolicy(tampered)
				.trustStoreSha256,
		).not.toBe(original.trustStoreSha256);
	});

	it("canonicalizes equivalent PEM encodings before deriving the digest", () => {
		const { publicPolicy } = fixture();
		const original =
			semanticQualificationTrustAnchorFromPublicPolicy(publicPolicy);
		const alternatePem = publicPolicy.gatePublicKeyPem.replaceAll("\n", "\r\n");
		expect(
			semanticQualificationTrustAnchorFromPublicPolicy({
				...publicPolicy,
				gatePublicKeyPem: alternatePem,
			}),
		).toEqual(original);
		const nestedAlternate = structuredClone(publicPolicy);
		nestedAlternate.verifierPolicy.authorizerPublicKeys.release =
			nestedAlternate.verifierPolicy.authorizerPublicKeys.release.replaceAll(
				"\n",
				"\r\n",
			);
		nestedAlternate.analysisPlanTrustPolicy.administratorPublicKeys.research =
			nestedAlternate.analysisPlanTrustPolicy.administratorPublicKeys.research.replaceAll(
				"\n",
				"\r\n",
			);
		expect(
			semanticQualificationTrustAnchorFromPublicPolicy(nestedAlternate),
		).toEqual(original);
	});

	it("rejects a non-Ed25519 gate key and missing deployment identity", () => {
		const { publicPolicy } = fixture();
		expect(() =>
			semanticQualificationTrustAnchorFromPublicPolicy({
				...publicPolicy,
				gatePublicKeyPem: "not a public key",
			}),
		).toThrow("public deployment policy is invalid");
		expect(() =>
			semanticQualificationTrustAnchorFromPublicPolicy({
				...publicPolicy,
				deploymentId: " ",
			}),
		).toThrow("public deployment policy is invalid");
	});

	it("rejects malformed nested public trust policy inputs", () => {
		const { publicPolicy } = fixture();
		for (const malformed of [
			null,
			{
				...publicPolicy,
				verifierPolicy: {
					...publicPolicy.verifierPolicy,
					approvedAnalysisPlanTrustPolicySha256: "not-sha256",
				},
			},
			{
				...publicPolicy,
				analysisPlanTrustPolicy: { administratorPublicKeys: {} },
			},
			{
				...publicPolicy,
				timestampTrustPolicyIdentity: {
					...publicPolicy.timestampTrustPolicyIdentity,
					requiredPolicyOid: "not-an-oid",
				},
			},
		])
			expect(() =>
				semanticQualificationTrustAnchorFromPublicPolicy(malformed),
			).toThrow("public deployment policy is invalid");
	});
});
