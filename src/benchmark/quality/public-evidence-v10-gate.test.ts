import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import {
	keys,
	signed,
	trustPolicy,
	validManifest,
	writeValidEvidence,
} from "./public-evidence-fixture.js";
import {
	type PublicEvidenceV10Envelope,
	evaluatePublicEvidenceV10,
} from "./public-evidence-v10-gate.js";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true })),
	);
});

const sha256 = (bytes: string | Buffer) =>
	createHash("sha256").update(bytes).digest("hex");

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "naia-public-v10-"));
	roots.push(root);
	const manifest = validManifest();
	await writeValidEvidence(root, manifest);
	const coreBytes = JSON.stringify(manifest);
	await writeFile(join(root, "manifest-v9.json"), coreBytes);
	const { signatureBase64: _signature, ...unsignedSeal } = signed(
		{
			schemaVersion: "naia-memory-public-dataset-custody-seal-v1",
			custodian: "custodian-1",
			datasetSha256: manifest.dataset.sha256,
			sealedAt: "2026-08-17T00:00:00.000Z",
			statement: "NO_BENCHMARK_OPERATOR_ACCESS_BEFORE_DISCLOSURE",
		},
		"custodian-1",
	);
	const seal = signed(unsignedSeal, "custodian-1");
	const sealBytes = JSON.stringify(seal);
	await writeFile(join(root, "custody-seal.json"), sealBytes);
	const tokenBytes = Buffer.from("fixture-rfc3161-token");
	await writeFile(join(root, "custody.tsr"), tokenBytes);
	const timestampEvidence = {
		schemaVersion: "naia-memory-rfc3161-digest-timestamp-evidence-v1",
		artifactSha256: evidenceObjectSha256(unsignedSeal),
		tokenSha256: sha256(tokenBytes),
		tokenPath: "ignored-by-v10-byte-binding.tsr",
	};
	const timestampEvidenceBytes = JSON.stringify(timestampEvidence);
	await writeFile(join(root, "custody-timestamp.json"), timestampEvidenceBytes);
	const envelope = signed(
		{
			schemaVersion: "naia-memory-public-evidence-promotion-v10",
			publisher: "nextain-release",
			coreManifestPath: "manifest-v9.json",
			coreManifestSha256: sha256(coreBytes),
			datasetPath: manifest.dataset.path,
			datasetSha256: manifest.dataset.sha256,
			custodySealPath: "custody-seal.json",
			custodySealSha256: sha256(sealBytes),
			custodyTimestampEvidencePath: "custody-timestamp.json",
			custodyTimestampEvidenceSha256: sha256(timestampEvidenceBytes),
			custodyTimestampTokenPath: "custody.tsr",
			custodyTimestampTokenSha256: sha256(tokenBytes),
		},
		"nextain-release",
	) as PublicEvidenceV10Envelope;
	const ca = Buffer.from("fixture-tsa-ca");
	return {
		root,
		envelope,
		ca,
		policy: {
			core: trustPolicy,
			custodyTimestamp: {
				schemaVersion: "naia-memory-rfc3161-timestamp-trust-policy-v1" as const,
				trustedCaFilePath: "ignored-by-v10-byte-binding.pem",
				trustedCaFileSha256: sha256(ca),
				requiredPolicyOid: "1.2.3.4",
			},
		},
		commandRunner: (args: string[]) => ({
			status: 0,
			stdout: args.includes("-text")
				? "Policy OID: 1.2.3.4\nTime stamp: Aug 17 00:00:00 2026 GMT\n"
				: "Verification: OK\n",
			stderr: "",
		}),
	};
}

describe("public evidence v10 promotion gate", () => {
	it("requires a publisher-signed envelope and timestamped custody before promoting", async () => {
		const value = await fixture();
		await expect(
			evaluatePublicEvidenceV10({
				envelope: value.envelope,
				evidenceRoot: value.root,
				trustPolicy: value.policy,
				commandRunner: value.commandRunner,
				trustedCaBytes: value.ca,
			}),
		).resolves.toEqual({ promotable: true, failures: [] });
	});

	it("rejects a substituted timestamp token even when its path is valid", async () => {
		const value = await fixture();
		await writeFile(join(value.root, "custody.tsr"), "substituted");
		const decision = await evaluatePublicEvidenceV10({
			envelope: value.envelope,
			evidenceRoot: value.root,
			trustPolicy: value.policy,
			commandRunner: value.commandRunner,
			trustedCaBytes: value.ca,
		});
		expect(decision.promotable).toBe(false);
		expect(decision.failures).toContain("v10 evidence content hash mismatch");
	});

	it("rejects a backdated seal whose TSA time is not before the challenge", async () => {
		const value = await fixture();
		const decision = await evaluatePublicEvidenceV10({
			envelope: value.envelope,
			evidenceRoot: value.root,
			trustPolicy: value.policy,
			commandRunner: (args) => ({
				status: 0,
				stdout: args.includes("-text")
					? "Policy OID: 1.2.3.4\nTime stamp: Aug 18 00:00:00 2026 GMT\n"
					: "Verification: OK\n",
				stderr: "",
			}),
			trustedCaBytes: value.ca,
		});
		expect(decision.promotable).toBe(false);
		expect(decision.failures[0]).toMatch(/asserted seal time|before challenge/);
	});
});
