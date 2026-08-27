import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	buildPublicEvidenceV10SigningPacket,
	collectPublicEvidenceV10Signature,
} from "./public-evidence-v10-signing.js";

function fixture() {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	const publicKeyPem = publicKey
		.export({ type: "spki", format: "pem" })
		.toString();
	const unsignedEnvelope = {
		schemaVersion: "naia-memory-public-evidence-promotion-v10" as const,
		publisher: "publisher-1",
		coreManifestPath: "manifest-v9.json",
		coreManifestSha256: "1".repeat(64),
		datasetPath: "dataset.json",
		datasetSha256: "2".repeat(64),
		custodySealPath: "custody-seal.json",
		custodySealSha256: "3".repeat(64),
		custodyTimestampEvidencePath: "custody-timestamp.json",
		custodyTimestampEvidenceSha256: "4".repeat(64),
		custodyTimestampTokenPath: "custody.tsr",
		custodyTimestampTokenSha256: "5".repeat(64),
	};
	const packet = buildPublicEvidenceV10SigningPacket({
		unsignedEnvelope,
		publisherPublicKey: publicKeyPem,
	});
	const detachedSignature = {
		schemaVersion:
			"naia-memory-public-evidence-v10-detached-signature-v1" as const,
		packetSha256: packet.packetSha256,
		signatureBase64: sign(
			null,
			Buffer.from(packet.signingPayloadBase64, "base64"),
			privateKey,
		).toString("base64"),
	};
	return { packet, detachedSignature, publicKeyPem, unsignedEnvelope };
}

describe("public evidence v10 external signing", () => {
	it("collects an externally signed packet into a v10 envelope", () => {
		const value = fixture();
		expect(
			collectPublicEvidenceV10Signature({
				packet: value.packet,
				detachedSignature: value.detachedSignature,
				publisherPublicKey: value.publicKeyPem,
			}),
		).toEqual({
			...value.unsignedEnvelope,
			signatureBase64: value.detachedSignature.signatureBase64,
		});
	});

	it("rejects packet mutation and signature replay", () => {
		const value = fixture();
		expect(() =>
			collectPublicEvidenceV10Signature({
				packet: {
					...value.packet,
					unsignedEnvelope: {
						...value.packet.unsignedEnvelope,
						datasetSha256: "9".repeat(64),
					},
				},
				detachedSignature: value.detachedSignature,
				publisherPublicKey: value.publicKeyPem,
			}),
		).toThrow("v10 signing packet binding is invalid");

		expect(() =>
			collectPublicEvidenceV10Signature({
				packet: value.packet,
				detachedSignature: {
					...value.detachedSignature,
					packetSha256: "8".repeat(64),
				},
				publisherPublicKey: value.publicKeyPem,
			}),
		).toThrow("v10 detached signature is invalid");
	});

	it("binds collection to the publisher public key", () => {
		const value = fixture();
		const other = generateKeyPairSync("ed25519")
			.publicKey.export({ type: "spki", format: "pem" })
			.toString();
		expect(() =>
			collectPublicEvidenceV10Signature({
				packet: value.packet,
				detachedSignature: value.detachedSignature,
				publisherPublicKey: other,
			}),
		).toThrow("v10 signing packet binding is invalid");
	});
});
