import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	buildFullCorpusBundleSigningPacket,
	collectFullCorpusBundleSignature,
	validateFullCorpusBundlePublication,
} from "./native-full-corpus-bundle-publication.js";
import { semanticPublicGateManifestSigningPayload } from "./semantic-public-gate-manifest-receipt.js";

function fixture() {
	const keys = generateKeyPairSync("ed25519");
	const publicKey = keys.publicKey
		.export({ type: "spki", format: "pem" })
		.toString();
	const manifestSha256 = createHash("sha256")
		.update("exact full-corpus bundle manifest bytes")
		.digest("hex");
	const trustPolicy = {
		schemaVersion:
			"naia-memory-full-corpus-bundle-signer-trust-policy-v1" as const,
		signers: {
			publisher: {
				publicKey,
				notBefore: "2026-08-01T00:00:00.000Z",
				notAfter: "2026-09-01T00:00:00.000Z",
			},
		},
	};
	const packet = buildFullCorpusBundleSigningPacket({
		manifestSha256,
		signerId: "publisher",
		trustPolicy,
	});
	const receipt = collectFullCorpusBundleSignature({
		packet,
		detachedSignature: {
			schemaVersion: "naia-memory-full-corpus-bundle-detached-signature-v1",
			packetSha256: packet.packetSha256,
			signatureBase64: sign(
				null,
				Buffer.from(packet.signingPayloadBase64, "base64"),
				keys.privateKey,
			).toString("base64"),
		},
		trustPolicy,
	});
	const receiptBytes = Buffer.from(`${JSON.stringify(receipt)}\n`);
	const tokenBytes = Buffer.from("trusted timestamp token");
	const trustedCaBytes = Buffer.from("independently trusted tsa ca");
	return {
		keys,
		manifestSha256,
		trustPolicy,
		packet,
		receipt,
		receiptBytes,
		tokenBytes,
		trustedCaBytes,
		timestampEvidence: {
			schemaVersion:
				"naia-memory-rfc3161-digest-timestamp-evidence-v1" as const,
			artifactSha256: createHash("sha256").update(receiptBytes).digest("hex"),
			tokenSha256: createHash("sha256").update(tokenBytes).digest("hex"),
			tokenPath: "/producer/path/does-not-exist.tsr",
		},
		timestampTrustPolicy: {
			schemaVersion: "naia-memory-rfc3161-timestamp-trust-policy-v1" as const,
			trustedCaFilePath: "/producer/path/does-not-exist.pem",
			trustedCaFileSha256: createHash("sha256")
				.update(trustedCaBytes)
				.digest("hex"),
			requiredPolicyOid: "1.2.3.4",
		},
		commandRunner: (args: string[]) =>
			args.includes("-verify")
				? { status: 0, stdout: "Verification: OK", stderr: "" }
				: {
						status: 0,
						stdout:
							"Policy OID: 1.2.3.4\nTime stamp: Aug 22 12:00:00 2026 GMT\n",
						stderr: "",
					},
	};
}

describe("full-corpus bundle publication", () => {
	it("binds exact manifest bytes to external signer and TSA trust", () => {
		const current = fixture();
		expect(
			validateFullCorpusBundlePublication({
				expectedManifestSha256: current.manifestSha256,
				receiptBytes: current.receiptBytes,
				signerTrustPolicy: current.trustPolicy,
				timestampEvidence: current.timestampEvidence,
				timestampTrustPolicy: current.timestampTrustPolicy,
				commandRunner: current.commandRunner,
				tokenBytes: current.tokenBytes,
				trustedCaBytes: current.trustedCaBytes,
			}),
		).toMatchObject({
			manifestSha256: current.manifestSha256,
			signerId: "publisher",
			timestampedAt: "2026-08-22T12:00:00.000Z",
		});
	});

	it("rejects manifest substitution and untrusted signer keys", () => {
		const current = fixture();
		expect(() =>
			validateFullCorpusBundlePublication({
				expectedManifestSha256: "a".repeat(64),
				receiptBytes: current.receiptBytes,
				signerTrustPolicy: current.trustPolicy,
				timestampEvidence: current.timestampEvidence,
				timestampTrustPolicy: current.timestampTrustPolicy,
				commandRunner: current.commandRunner,
				tokenBytes: current.tokenBytes,
				trustedCaBytes: current.trustedCaBytes,
			}),
		).toThrow("receipt binding is invalid");
		const other = generateKeyPairSync("ed25519");
		current.trustPolicy.signers.publisher.publicKey = other.publicKey
			.export({ type: "spki", format: "pem" })
			.toString();
		expect(() =>
			validateFullCorpusBundlePublication({
				expectedManifestSha256: current.manifestSha256,
				receiptBytes: current.receiptBytes,
				signerTrustPolicy: current.trustPolicy,
				timestampEvidence: current.timestampEvidence,
				timestampTrustPolicy: current.timestampTrustPolicy,
				commandRunner: current.commandRunner,
				tokenBytes: current.tokenBytes,
				trustedCaBytes: current.trustedCaBytes,
			}),
		).toThrow("signer key binding is invalid");
	});

	it("rejects semantic-domain signatures presented with a full-corpus schema", () => {
		const current = fixture();
		const confused = {
			...current.receipt,
			signatureBase64: sign(
				null,
				semanticPublicGateManifestSigningPayload({
					manifestSha256: current.receipt.manifestSha256,
					signerId: current.receipt.signerId,
					signerKeySha256: current.receipt.signerKeySha256,
				}),
				current.keys.privateKey,
			).toString("base64"),
		};
		const receiptBytes = Buffer.from(`${JSON.stringify(confused)}\n`);
		current.timestampEvidence.artifactSha256 = createHash("sha256")
			.update(receiptBytes)
			.digest("hex");
		expect(() =>
			validateFullCorpusBundlePublication({
				expectedManifestSha256: current.manifestSha256,
				receiptBytes,
				signerTrustPolicy: current.trustPolicy,
				timestampEvidence: current.timestampEvidence,
				timestampTrustPolicy: current.timestampTrustPolicy,
				commandRunner: current.commandRunner,
				tokenBytes: current.tokenBytes,
				trustedCaBytes: current.trustedCaBytes,
			}),
		).toThrow("receipt signature is invalid");
	});

	it("rejects a signer key outside its TSA-time validity window", () => {
		const current = fixture();
		current.trustPolicy.signers.publisher.notAfter = "2026-08-22T11:59:59.000Z";
		expect(() =>
			validateFullCorpusBundlePublication({
				expectedManifestSha256: current.manifestSha256,
				receiptBytes: current.receiptBytes,
				signerTrustPolicy: current.trustPolicy,
				timestampEvidence: current.timestampEvidence,
				timestampTrustPolicy: current.timestampTrustPolicy,
				commandRunner: current.commandRunner,
				tokenBytes: current.tokenBytes,
				trustedCaBytes: current.trustedCaBytes,
			}),
		).toThrow("was not valid at TSA time");
	});

	it("rejects non-canonical signatures and extra trust-policy fields", () => {
		const current = fixture();
		const malformed = Buffer.from(
			`${JSON.stringify({ ...current.receipt, signatureBase64: `${current.receipt.signatureBase64}=`, extra: true })}\n`,
		);
		expect(() =>
			validateFullCorpusBundlePublication({
				expectedManifestSha256: current.manifestSha256,
				receiptBytes: malformed,
				signerTrustPolicy: current.trustPolicy,
				timestampEvidence: current.timestampEvidence,
				timestampTrustPolicy: current.timestampTrustPolicy,
			}),
		).toThrow("receipt shape is invalid");
		expect(() =>
			buildFullCorpusBundleSigningPacket({
				manifestSha256: current.manifestSha256,
				signerId: "publisher",
				trustPolicy: { ...current.trustPolicy, extra: true } as never,
			}),
		).toThrow("trust policy is invalid");
	});
});
