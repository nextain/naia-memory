import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { publicDatasetCustodySealSigningPacket } from "./public-dataset-custody-seal.js";
import { trustPolicy, validManifest } from "./public-evidence-fixture.js";
import { publicEvidenceScopeSha256 } from "./public-evidence-gate.js";
import {
	evaluatePublicEvidenceV10Bundle,
	preparePublicEvidenceV10LaunchPacket,
} from "./public-evidence-v10-cli.js";

const roots: string[] = [];
async function root() {
	const value = await mkdtemp(join(tmpdir(), "naia-v10-cli-"));
	roots.push(value);
	return value;
}
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((path) => rm(path, { recursive: true })),
	);
});

describe("public evidence v10 verifier intake", () => {
	it("prepares a signing packet from the exact evidence-root bytes", async () => {
		const evidence = await root();
		const keyPath = join(await root(), "publisher.pem");
		const { publicKey } = generateKeyPairSync("ed25519");
		await writeFile(keyPath, publicKey.export({ type: "spki", format: "pem" }));
		const paths = [
			"manifest.json",
			"dataset.json",
			"seal.json",
			"timestamp.json",
			"timestamp.tsr",
		];
		const dataset = Buffer.from("artifact-1");
		const datasetSha256 = createHash("sha256").update(dataset).digest("hex");
		const manifest = validManifest();
		manifest.publisher = "external-publisher";
		manifest.dataset.sha256 = datasetSha256;
		manifest.protocol.sameInputSha256 = datasetSha256;
		for (const engine of manifest.engines) engine.datasetSha256 = datasetSha256;
		manifest.adversarialReview.evidenceScopeSha256 =
			publicEvidenceScopeSha256(manifest);
		const seal = {
			schemaVersion: "naia-memory-public-dataset-custody-seal-v1" as const,
			custodian: "custodian",
			datasetSha256,
			sealedAt: "2026-08-23T00:00:00.000Z",
			statement: "NO_BENCHMARK_OPERATOR_ACCESS_BEFORE_DISCLOSURE" as const,
			signatureBase64: "signature",
		};
		const token = Buffer.from("artifact-4");
		await writeFile(
			join(evidence, paths[0] as string),
			JSON.stringify(manifest),
		);
		await writeFile(join(evidence, paths[1] as string), dataset);
		await writeFile(join(evidence, paths[2] as string), JSON.stringify(seal));
		await writeFile(
			join(evidence, paths[3] as string),
			JSON.stringify({
				schemaVersion: "naia-memory-rfc3161-digest-timestamp-evidence-v1",
				artifactSha256:
					publicDatasetCustodySealSigningPacket(seal).timestampArtifactSha256,
				tokenSha256: createHash("sha256").update(token).digest("hex"),
				tokenPath: paths[4],
			}),
		);
		await writeFile(join(evidence, paths[4] as string), token);
		const packet = await preparePublicEvidenceV10LaunchPacket({
			evidenceRoot: evidence,
			publisher: "external-publisher",
			publisherPublicKeyPath: keyPath,
			coreManifestPath: paths[0] as string,
			datasetPath: paths[1] as string,
			custodySealPath: paths[2] as string,
			custodyTimestampEvidencePath: paths[3] as string,
			custodyTimestampTokenPath: paths[4] as string,
		});
		expect(packet.publisher).toBe("external-publisher");
		expect(packet.unsignedEnvelope.datasetPath).toBe("dataset.json");
		expect(packet.unsignedEnvelope.datasetSha256).toBe(
			"c4793fb94443793eb32e1128b2d4d2cb4c20bed467a6929ec09f78cb87af21a1",
		);
		await writeFile(
			join(evidence, paths[0] as string),
			JSON.stringify({
				publisher: "external-publisher",
				dataset: { path: paths[1], sha256: datasetSha256 },
			}),
		);
		await expect(
			preparePublicEvidenceV10LaunchPacket({
				evidenceRoot: evidence,
				publisher: "external-publisher",
				publisherPublicKeyPath: keyPath,
				coreManifestPath: paths[0] as string,
				datasetPath: paths[1] as string,
				custodySealPath: paths[2] as string,
				custodyTimestampEvidencePath: paths[3] as string,
				custodyTimestampTokenPath: paths[4] as string,
			}),
		).rejects.toThrow("core manifest is invalid");
		manifest.dataset.path = "other-dataset.json";
		manifest.adversarialReview.evidenceScopeSha256 =
			publicEvidenceScopeSha256(manifest);
		await writeFile(
			join(evidence, paths[0] as string),
			JSON.stringify(manifest),
		);
		await expect(
			preparePublicEvidenceV10LaunchPacket({
				evidenceRoot: evidence,
				publisher: "external-publisher",
				publisherPublicKeyPath: keyPath,
				coreManifestPath: paths[0] as string,
				datasetPath: paths[1] as string,
				custodySealPath: paths[2] as string,
				custodyTimestampEvidencePath: paths[3] as string,
				custodyTimestampTokenPath: paths[4] as string,
			}),
		).rejects.toThrow("core manifest binding mismatch");
	});

	it("rejects non-canonical and escaping launch artifact paths", async () => {
		const evidence = await root();
		const keyPath = join(await root(), "publisher.pem");
		const { publicKey } = generateKeyPairSync("ed25519");
		await writeFile(keyPath, publicKey.export({ type: "spki", format: "pem" }));
		await writeFile(join(evidence, "artifact"), "value");
		const base = {
			evidenceRoot: evidence,
			publisher: "publisher",
			publisherPublicKeyPath: keyPath,
			coreManifestPath: "artifact",
			datasetPath: "artifact",
			custodySealPath: "artifact",
			custodyTimestampEvidencePath: "artifact",
			custodyTimestampTokenPath: "artifact",
		};
		await expect(
			preparePublicEvidenceV10LaunchPacket({
				...base,
				datasetPath: "./artifact",
			}),
		).rejects.toThrow("canonical and relative");
		await expect(
			preparePublicEvidenceV10LaunchPacket({
				...base,
				datasetPath: "../artifact",
			}),
		).rejects.toThrow("escapes evidence root");
	});

	it("rejects verifier trust and CA supplied inside the evidence bundle", async () => {
		const evidence = await root();
		await writeFile(join(evidence, "envelope.json"), "{}");
		await writeFile(join(evidence, "trust.json"), "{}");
		await writeFile(join(evidence, "tsa.pem"), "ca");
		expect(
			await evaluatePublicEvidenceV10Bundle(
				join(evidence, "envelope.json"),
				join(evidence, "trust.json"),
				join(evidence, "tsa.pem"),
			),
		).toEqual({
			promotable: false,
			failures: [
				"v10 trust policy must be outside the submitted evidence root",
			],
		});
	});

	it("rejects a symlinked verifier trust policy that resolves into evidence", async () => {
		const evidence = await root();
		const verifier = await root();
		await writeFile(join(evidence, "envelope.json"), "{}");
		await writeFile(join(evidence, "trust.json"), "{}");
		await writeFile(join(verifier, "tsa.pem"), "ca");
		await symlink(
			join(evidence, "trust.json"),
			join(verifier, "trust-link.json"),
		);
		const result = await evaluatePublicEvidenceV10Bundle(
			join(evidence, "envelope.json"),
			join(verifier, "trust-link.json"),
			join(verifier, "tsa.pem"),
		);
		expect(result.failures).toContain(
			"v10 trust policy must be outside the submitted evidence root",
		);
	});

	it("validates verifier-owned policy and CA before evaluating evidence", async () => {
		const evidence = await root();
		const verifier = await root();
		await writeFile(join(evidence, "envelope.json"), "{}");
		await writeFile(
			join(verifier, "trust.json"),
			JSON.stringify({
				core: trustPolicy,
				custodyTimestamp: {
					schemaVersion: "naia-memory-rfc3161-timestamp-trust-policy-v1",
					trustedCaFilePath: "tsa.pem",
					trustedCaFileSha256: "0".repeat(64),
					requiredPolicyOid: "1.2.3.4",
				},
			}),
		);
		await writeFile(join(verifier, "tsa.pem"), "wrong-ca");
		expect(
			await evaluatePublicEvidenceV10Bundle(
				join(evidence, "envelope.json"),
				join(verifier, "trust.json"),
				join(verifier, "tsa.pem"),
			),
		).toEqual({
			promotable: false,
			failures: ["v10 trusted CA hash mismatch"],
		});
	});
});
