import { verify } from "node:crypto";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import type { SemanticPublicGateManifestSignerTrustPolicy } from "./semantic-public-gate-manifest-receipt.js";
import {
	semanticPublicGateManifestSigningPayload,
	semanticPublicGateSignerKeySha256,
	validateSemanticPublicGateManifestSignerTrustPolicy,
} from "./semantic-public-gate-manifest-receipt.js";

const SHA256 = /^[a-f0-9]{64}$/u;

export type SemanticPublicGateManifestSigningPacket = {
	schemaVersion: "naia-memory-semantic-public-gate-manifest-signing-packet-v1";
	manifestSha256: string;
	signerId: string;
	signerKeySha256: string;
	signingPayloadBase64: string;
	packetSha256: string;
};

export type SemanticPublicGateManifestDetachedSignature = {
	schemaVersion: "naia-memory-semantic-public-gate-manifest-detached-signature-v1";
	packetSha256: string;
	signatureBase64: string;
};

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: string[]): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return (
		actual.length === expected.length &&
		actual.every((key, i) => key === expected[i])
	);
}

function packetCore(input: {
	manifestSha256: string;
	signerId: string;
	signerKeySha256: string;
}) {
	const payload = semanticPublicGateManifestSigningPayload(input);
	return {
		schemaVersion:
			"naia-memory-semantic-public-gate-manifest-signing-packet-v1" as const,
		manifestSha256: input.manifestSha256,
		signerId: input.signerId,
		signerKeySha256: input.signerKeySha256,
		signingPayloadBase64: payload.toString("base64"),
	};
}

export function buildSemanticPublicGateManifestSigningPacket(input: {
	manifestSha256: string;
	signerId: string;
	trustPolicy: SemanticPublicGateManifestSignerTrustPolicy;
}): SemanticPublicGateManifestSigningPacket {
	validateSemanticPublicGateManifestSignerTrustPolicy(input.trustPolicy);
	if (!SHA256.test(input.manifestSha256))
		throw new Error("manifest signing packet digest is invalid");
	const signer = input.trustPolicy.signers?.[input.signerId];
	if (!signer) throw new Error("manifest signing packet signer is untrusted");
	const core = packetCore({
		manifestSha256: input.manifestSha256,
		signerId: input.signerId,
		signerKeySha256: semanticPublicGateSignerKeySha256(signer.publicKey),
	});
	return { ...core, packetSha256: evidenceObjectSha256(core) };
}

export function collectSemanticPublicGateManifestSignature(input: {
	packet: unknown;
	detachedSignature: unknown;
	trustPolicy: SemanticPublicGateManifestSignerTrustPolicy;
}) {
	validateSemanticPublicGateManifestSignerTrustPolicy(input.trustPolicy);
	if (
		!record(input.packet) ||
		!exact(input.packet, [
			"schemaVersion",
			"manifestSha256",
			"signerId",
			"signerKeySha256",
			"signingPayloadBase64",
			"packetSha256",
		])
	)
		throw new Error("manifest signing packet shape is invalid");
	const packet = input.packet as SemanticPublicGateManifestSigningPacket;
	if (
		packet.schemaVersion !==
			"naia-memory-semantic-public-gate-manifest-signing-packet-v1" ||
		!SHA256.test(packet.manifestSha256) ||
		!SHA256.test(packet.signerKeySha256) ||
		!SHA256.test(packet.packetSha256) ||
		typeof packet.signerId !== "string" ||
		typeof packet.signingPayloadBase64 !== "string"
	)
		throw new Error("manifest signing packet content is invalid");
	const core = packetCore(packet);
	if (
		packet.signingPayloadBase64 !== core.signingPayloadBase64 ||
		packet.packetSha256 !== evidenceObjectSha256(core)
	)
		throw new Error("manifest signing packet binding is invalid");
	if (
		!record(input.detachedSignature) ||
		!exact(input.detachedSignature, [
			"schemaVersion",
			"packetSha256",
			"signatureBase64",
		])
	)
		throw new Error("manifest detached signature shape is invalid");
	const detached =
		input.detachedSignature as SemanticPublicGateManifestDetachedSignature;
	const signature = Buffer.from(detached.signatureBase64, "base64");
	if (
		detached.schemaVersion !==
			"naia-memory-semantic-public-gate-manifest-detached-signature-v1" ||
		detached.packetSha256 !== packet.packetSha256 ||
		signature.length !== 64 ||
		signature.toString("base64") !== detached.signatureBase64
	)
		throw new Error("manifest detached signature content is invalid");
	const signer = input.trustPolicy.signers?.[packet.signerId];
	if (
		!signer ||
		semanticPublicGateSignerKeySha256(signer.publicKey) !==
			packet.signerKeySha256
	)
		throw new Error("manifest detached signature signer is untrusted");
	if (
		!verify(
			null,
			Buffer.from(packet.signingPayloadBase64, "base64"),
			signer.publicKey,
			signature,
		)
	)
		throw new Error("manifest detached signature is invalid");
	return {
		schemaVersion:
			"naia-memory-semantic-public-gate-manifest-receipt-v1" as const,
		manifestSha256: packet.manifestSha256,
		signerId: packet.signerId,
		signerKeySha256: packet.signerKeySha256,
		signatureBase64: detached.signatureBase64,
	};
}
