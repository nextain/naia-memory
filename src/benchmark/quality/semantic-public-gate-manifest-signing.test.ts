import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	buildSemanticPublicGateManifestSigningPacket,
	collectSemanticPublicGateManifestSignature,
} from "./semantic-public-gate-manifest-signing.js";

function fixture() {
	const keys = generateKeyPairSync("ed25519");
	const publicKey = keys.publicKey
		.export({ type: "spki", format: "pem" })
		.toString();
	const trustPolicy = {
		schemaVersion:
			"naia-memory-semantic-public-gate-manifest-signer-trust-policy-v1" as const,
		signers: {
			publisher: {
				publicKey,
				notBefore: "2026-08-01T00:00:00.000Z",
				notAfter: "2026-09-01T00:00:00.000Z",
			},
		},
	};
	const packet = buildSemanticPublicGateManifestSigningPacket({
		manifestSha256: "a".repeat(64),
		signerId: "publisher",
		trustPolicy,
	});
	const detachedSignature = {
		schemaVersion:
			"naia-memory-semantic-public-gate-manifest-detached-signature-v1" as const,
		packetSha256: packet.packetSha256,
		signatureBase64: sign(
			null,
			Buffer.from(packet.signingPayloadBase64, "base64"),
			keys.privateKey,
		).toString("base64"),
	};
	return { packet, detachedSignature, trustPolicy };
}

describe("semantic public gate manifest offline signing", () => {
	it("collects a trusted detached signature into a receipt", () => {
		const current = fixture();
		expect(collectSemanticPublicGateManifestSignature(current)).toMatchObject({
			manifestSha256: "a".repeat(64),
			signerId: "publisher",
		});
	});

	it("rejects packet mutation", () => {
		const current = fixture();
		current.packet.manifestSha256 = "b".repeat(64);
		expect(() => collectSemanticPublicGateManifestSignature(current)).toThrow(
			"packet binding is invalid",
		);
	});

	it("rejects a signature targeting another packet", () => {
		const current = fixture();
		current.detachedSignature.packetSha256 = "b".repeat(64);
		expect(() => collectSemanticPublicGateManifestSignature(current)).toThrow(
			"detached signature content is invalid",
		);
	});

	it("rejects malformed trust policy before creating a packet", () => {
		const current = fixture();
		current.trustPolicy.signers.publisher.notAfter =
			current.trustPolicy.signers.publisher.notBefore;
		expect(() =>
			buildSemanticPublicGateManifestSigningPacket({
				manifestSha256: "a".repeat(64),
				signerId: "publisher",
				trustPolicy: current.trustPolicy,
			}),
		).toThrow("trust policy is invalid");
	});

	it("rejects non-canonical detached signature base64", () => {
		const current = fixture();
		current.detachedSignature.signatureBase64 += "=";
		expect(() => collectSemanticPublicGateManifestSignature(current)).toThrow(
			"detached signature content is invalid",
		);
	});
});
