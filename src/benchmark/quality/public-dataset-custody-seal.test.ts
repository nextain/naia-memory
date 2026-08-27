import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	publicDatasetCustodySealSigningPacket,
	verifyPublicDatasetCustodySeal,
} from "./public-dataset-custody-seal.js";
import { evidenceSignaturePayload } from "./public-evidence-crypto.js";

const timestampRunner = (timestamp: string) => (args: string[]) =>
	args.includes("-verify")
		? { status: 0, stdout: "Verification: OK", stderr: "" }
		: {
				status: 0,
				stdout: `Policy OID: 1.2.3.4\nTime stamp: ${timestamp}\n`,
				stderr: "",
			};

describe("public dataset custody seal", () => {
	it("binds an independently signed seal to a TSA time before challenge issuance", () => {
		const keys = generateKeyPairSync("ed25519");
		const packet = publicDatasetCustodySealSigningPacket({
			custodian: "external-custodian",
			datasetSha256: "a".repeat(64),
			sealedAt: "2026-08-17T00:00:00.000Z",
		});
		const seal = {
			...packet.unsignedSeal,
			signatureBase64: sign(
				null,
				evidenceSignaturePayload(packet.unsignedSeal),
				keys.privateKey,
			).toString("base64"),
		};
		expect(
			verifyPublicDatasetCustodySeal({
				seal,
				expectedDatasetSha256: "a".repeat(64),
				custodianPublicKey: keys.publicKey
					.export({ type: "spki", format: "pem" })
					.toString(),
				timestampEvidence: {
					schemaVersion: "naia-memory-rfc3161-digest-timestamp-evidence-v1",
					artifactSha256: packet.timestampArtifactSha256,
					tokenSha256:
						"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
					tokenPath: "unused.tsr",
				},
				timestampTrustPolicy: {
					schemaVersion: "naia-memory-rfc3161-timestamp-trust-policy-v1",
					trustedCaFilePath: "unused.pem",
					trustedCaFileSha256:
						"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
					requiredPolicyOid: "1.2.3.4",
				},
				challengeIssuedAt: "2026-08-18T00:00:00.000Z",
				commandRunner: timestampRunner("Aug 17 00:00:00 2026 GMT"),
				tokenBytes: Buffer.alloc(0),
				trustedCaBytes: Buffer.alloc(0),
			}),
		).toEqual({
			timestampedAt: "2026-08-17T00:00:00.000Z",
			custodyPriorExistenceVerified: true,
		});
	});

	it("rejects a TSA token created after challenge issuance", () => {
		const keys = generateKeyPairSync("ed25519");
		const packet = publicDatasetCustodySealSigningPacket({
			custodian: "external-custodian",
			datasetSha256: "a".repeat(64),
			sealedAt: "2026-08-18T00:00:00.000Z",
		});
		const seal = {
			...packet.unsignedSeal,
			signatureBase64: sign(
				null,
				evidenceSignaturePayload(packet.unsignedSeal),
				keys.privateKey,
			).toString("base64"),
		};
		expect(() =>
			verifyPublicDatasetCustodySeal({
				seal,
				expectedDatasetSha256: "a".repeat(64),
				custodianPublicKey: keys.publicKey
					.export({ type: "spki", format: "pem" })
					.toString(),
				timestampEvidence: {
					schemaVersion: "naia-memory-rfc3161-digest-timestamp-evidence-v1",
					artifactSha256: packet.timestampArtifactSha256,
					tokenSha256:
						"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
					tokenPath: "unused",
				},
				timestampTrustPolicy: {
					schemaVersion: "naia-memory-rfc3161-timestamp-trust-policy-v1",
					trustedCaFilePath: "unused",
					trustedCaFileSha256:
						"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
					requiredPolicyOid: "1.2.3.4",
				},
				challengeIssuedAt: "2026-08-18T00:00:00.000Z",
				commandRunner: timestampRunner("Aug 18 00:00:00 2026 GMT"),
				tokenBytes: Buffer.alloc(0),
				trustedCaBytes: Buffer.alloc(0),
			}),
		).toThrow("not timestamped before challenge");
	});

	it("rejects a valid seal presented with different dataset bytes", () => {
		const keys = generateKeyPairSync("ed25519");
		const packet = publicDatasetCustodySealSigningPacket({
			custodian: "external-custodian",
			datasetSha256: "a".repeat(64),
			sealedAt: "2026-08-17T00:00:00.000Z",
		});
		const seal = {
			...packet.unsignedSeal,
			signatureBase64: sign(
				null,
				evidenceSignaturePayload(packet.unsignedSeal),
				keys.privateKey,
			).toString("base64"),
		};
		expect(() =>
			verifyPublicDatasetCustodySeal({
				seal,
				expectedDatasetSha256: "b".repeat(64),
				custodianPublicKey: keys.publicKey
					.export({ type: "spki", format: "pem" })
					.toString(),
				timestampEvidence: {} as never,
				timestampTrustPolicy: {} as never,
				challengeIssuedAt: "2026-08-18T00:00:00.000Z",
			}),
		).toThrow("dataset hash mismatch");
	});
});
