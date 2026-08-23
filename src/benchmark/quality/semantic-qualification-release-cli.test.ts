import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import { semanticQualificationTrustAnchorFromPublicPolicy } from "./semantic-competitive-qualification-trust-store.js";
import {
	runSemanticQualificationReleaseCli,
	validateSemanticQualificationReleaseAnchor,
} from "./semantic-qualification-release-cli.js";

const roots: string[] = [];

async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "qualification-release-"));
	roots.push(directory);
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
	const policy = {
		schemaVersion:
			"naia-memory-semantic-qualification-public-deployment-policy-v1" as const,
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
	const path = join(directory, "deployment-policy.json");
	await writeFile(path, JSON.stringify(policy));
	return {
		path,
		anchor: semanticQualificationTrustAnchorFromPublicPolicy(policy),
		args: [
			path,
			"manifest",
			"receipt",
			"signers",
			"timestamp",
			"timestamp-policy",
		],
	};
}

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true })),
	);
});

describe("semantic qualification release CLI", () => {
	it("accepts an exact checkout anchor and deployment policy match", async () => {
		const current = await fixture();
		await expect(
			Promise.resolve(
				validateSemanticQualificationReleaseAnchor(
					current.anchor,
					current.anchor,
				),
			),
		).resolves.toBeUndefined();
	});

	it("fails closed when this checkout has no provisioned anchor", async () => {
		const current = await fixture();
		await expect(
			runSemanticQualificationReleaseCli(current.args),
		).resolves.toBe(1);
	});

	it("rejects policy drift before any sealed evidence is evaluated", async () => {
		const current = await fixture();
		expect(() =>
			validateSemanticQualificationReleaseAnchor(current.anchor, {
				...current.anchor,
				deploymentId: "other",
			}),
		).toThrow("qualification trust anchor does not match deployment policy");
	});

	it("rejects an unreadable policy and ambiguous invocation", async () => {
		await expect(runSemanticQualificationReleaseCli([])).resolves.toBe(2);
		await expect(
			runSemanticQualificationReleaseCli([
				"missing",
				"manifest",
				"receipt",
				"signers",
				"timestamp",
				"policy",
			]),
		).resolves.toBe(1);
	});
});
