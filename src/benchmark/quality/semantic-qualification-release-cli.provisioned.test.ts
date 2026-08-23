import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import { semanticQualificationTrustAnchorFromPublicPolicy } from "./semantic-competitive-qualification-trust-store.js";
import type { SemanticQualificationTrustAnchor } from "./semantic-competitive-qualification.js";

const fixture = vi.hoisted(() => ({
	anchor: null as SemanticQualificationTrustAnchor | null,
	runSealedManifest: vi.fn(async (_args: string[]) => 0),
}));

vi.mock("./semantic-competitive-qualification-trust-anchor.js", () => ({
	get SEMANTIC_COMPETITIVE_QUALIFICATION_TRUST_ANCHOR() {
		return fixture.anchor;
	},
}));

vi.mock("./semantic-public-gate-sealed-manifest-cli.js", () => ({
	runSemanticPublicGateSealedManifestCli: fixture.runSealedManifest,
}));

const { runSemanticQualificationReleaseCli } = await import(
	"./semantic-qualification-release-cli.js"
);

let directory: string;
let policyPath: string;
let policy: Record<string, unknown>;

beforeAll(async () => {
	directory = await mkdtemp(
		join(tmpdir(), "qualification-release-provisioned-"),
	);
	const gate = generateKeyPairSync("ed25519");
	const authorizer = generateKeyPairSync("ed25519");
	const administrator = generateKeyPairSync("ed25519");
	const timestampTrustPolicyIdentity = {
		schemaVersion: 1 as const,
		trustedCaFileSha256: "a".repeat(64),
		requiredPolicyOid: "1.2.3.4",
	};
	const analysisPlanTrustPolicy = {
		administratorPublicKeys: {
			administrator: administrator.publicKey
				.export({ type: "spki", format: "pem" })
				.toString(),
		},
	};
	policy = {
		schemaVersion:
			"naia-memory-semantic-qualification-public-deployment-policy-v1",
		deploymentId: "release-deployment",
		gateKeyId: "release-gate",
		gatePublicKeyPem: gate.publicKey
			.export({ type: "spki", format: "pem" })
			.toString(),
		verifierPolicy: {
			authorizerPublicKeys: {
				authorizer: authorizer.publicKey
					.export({ type: "spki", format: "pem" })
					.toString(),
			},
			approvedAnalysisPlanTrustPolicySha256: evidenceObjectSha256(
				analysisPlanTrustPolicy,
			),
			approvedTimestampTrustPolicyIdentitySha256: evidenceObjectSha256(
				timestampTrustPolicyIdentity,
			),
		},
		analysisPlanTrustPolicy,
		timestampTrustPolicyIdentity,
	};
	policyPath = join(directory, "deployment-policy.json");
	await writeFile(policyPath, JSON.stringify(policy));
});

afterAll(async () => {
	await rm(directory, { recursive: true });
});

describe("semantic qualification release CLI with a provisioned checkout", () => {
	it("delegates only the sealed-manifest arguments after an exact policy match", async () => {
		fixture.anchor = semanticQualificationTrustAnchorFromPublicPolicy(policy);
		fixture.runSealedManifest.mockClear();
		const sealedArgs = [
			"manifest",
			"receipt",
			"signers",
			"timestamp",
			"policy",
		];

		await expect(
			runSemanticQualificationReleaseCli([policyPath, ...sealedArgs]),
		).resolves.toBe(0);
		expect(fixture.runSealedManifest).toHaveBeenCalledOnce();
		expect(fixture.runSealedManifest).toHaveBeenCalledWith(sealedArgs);
	});

	it("rejects a drifted static anchor without invoking the sealed gate", async () => {
		fixture.anchor = {
			...semanticQualificationTrustAnchorFromPublicPolicy(policy),
			deploymentId: "other-deployment",
		};
		fixture.runSealedManifest.mockClear();
		const stdout = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);

		await expect(
			runSemanticQualificationReleaseCli([
				policyPath,
				"manifest",
				"receipt",
				"signers",
				"timestamp",
				"policy",
			]),
		).resolves.toBe(1);
		expect(fixture.runSealedManifest).not.toHaveBeenCalled();
		expect(stdout).toHaveBeenCalledWith(
			expect.stringContaining(
				'"failure":"qualification trust anchor does not match deployment policy"',
			),
		);
		stdout.mockRestore();
	});

	it("propagates a sealed-gate rejection after an exact policy match", async () => {
		fixture.anchor = semanticQualificationTrustAnchorFromPublicPolicy(policy);
		fixture.runSealedManifest.mockResolvedValueOnce(1);

		await expect(
			runSemanticQualificationReleaseCli([
				policyPath,
				"manifest",
				"receipt",
				"signers",
				"timestamp",
				"policy",
			]),
		).resolves.toBe(1);
	});
});
