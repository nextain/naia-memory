import { verify } from "node:crypto";
import {
	type Ed25519PublicationSignerTrustPolicy,
	ed25519PublicationSignerKeySha256,
	ed25519PublicationSigningPayload,
	validateEd25519PublicationReceipt,
	validateEd25519PublicationSignerTrustPolicy,
} from "./ed25519-publication-receipt.js";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import type {
	Rfc3161CommandRunner,
	Rfc3161DigestTimestampEvidence,
	Rfc3161TimestampTrustPolicy,
} from "./rfc3161-timestamp.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const DOMAIN = "NAIA-FULL-CORPUS-ATTESTATION-BUNDLE-V1\0";

export type FullCorpusBundleSignerTrustPolicy =
	Ed25519PublicationSignerTrustPolicy & {
		schemaVersion: "naia-memory-full-corpus-bundle-signer-trust-policy-v1";
	};

export type FullCorpusBundleSigningPacket = {
	schemaVersion: "naia-memory-full-corpus-bundle-signing-packet-v1";
	manifestSha256: string;
	signerId: string;
	signerKeySha256: string;
	signingPayloadBase64: string;
	packetSha256: string;
};

export type FullCorpusBundleDetachedSignature = {
	schemaVersion: "naia-memory-full-corpus-bundle-detached-signature-v1";
	packetSha256: string;
	signatureBase64: string;
};

export type FullCorpusBundlePublicationReceipt = {
	schemaVersion: "naia-memory-full-corpus-bundle-publication-receipt-v1";
	manifestSha256: string;
	signerId: string;
	signerKeySha256: string;
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
		actual.every((key, index) => key === expected[index])
	);
}

export function validateFullCorpusBundleSignerTrustPolicy(
	value: FullCorpusBundleSignerTrustPolicy,
): void {
	if (
		!record(value) ||
		!exact(value, ["schemaVersion", "signers"]) ||
		value.schemaVersion !==
			"naia-memory-full-corpus-bundle-signer-trust-policy-v1"
	)
		throw new Error("full-corpus bundle signer trust policy is invalid");
	try {
		validateEd25519PublicationSignerTrustPolicy(value);
	} catch {
		throw new Error("full-corpus bundle signer trust policy is invalid");
	}
}

function packetCore(input: {
	manifestSha256: string;
	signerId: string;
	signerKeySha256: string;
}) {
	const payload = ed25519PublicationSigningPayload({
		domainPrefix: DOMAIN,
		artifactSha256: input.manifestSha256,
		signerId: input.signerId,
		signerKeySha256: input.signerKeySha256,
	});
	return {
		schemaVersion: "naia-memory-full-corpus-bundle-signing-packet-v1" as const,
		manifestSha256: input.manifestSha256,
		signerId: input.signerId,
		signerKeySha256: input.signerKeySha256,
		signingPayloadBase64: payload.toString("base64"),
	};
}

export function buildFullCorpusBundleSigningPacket(input: {
	manifestSha256: string;
	signerId: string;
	trustPolicy: FullCorpusBundleSignerTrustPolicy;
}): FullCorpusBundleSigningPacket {
	validateFullCorpusBundleSignerTrustPolicy(input.trustPolicy);
	if (!SHA256.test(input.manifestSha256))
		throw new Error("full-corpus bundle manifest digest is invalid");
	const signer = input.trustPolicy.signers[input.signerId];
	if (!signer) throw new Error("full-corpus bundle signer is untrusted");
	const core = packetCore({
		manifestSha256: input.manifestSha256,
		signerId: input.signerId,
		signerKeySha256: ed25519PublicationSignerKeySha256(signer.publicKey),
	});
	return { ...core, packetSha256: evidenceObjectSha256(core) };
}

export function collectFullCorpusBundleSignature(input: {
	packet: unknown;
	detachedSignature: unknown;
	trustPolicy: FullCorpusBundleSignerTrustPolicy;
}): FullCorpusBundlePublicationReceipt {
	validateFullCorpusBundleSignerTrustPolicy(input.trustPolicy);
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
		throw new Error("full-corpus bundle signing packet shape is invalid");
	const packet = input.packet as FullCorpusBundleSigningPacket;
	if (
		packet.schemaVersion !==
			"naia-memory-full-corpus-bundle-signing-packet-v1" ||
		!SHA256.test(packet.manifestSha256) ||
		!SHA256.test(packet.signerKeySha256) ||
		!SHA256.test(packet.packetSha256) ||
		typeof packet.signerId !== "string" ||
		typeof packet.signingPayloadBase64 !== "string"
	)
		throw new Error("full-corpus bundle signing packet content is invalid");
	const core = packetCore(packet);
	if (
		packet.signingPayloadBase64 !== core.signingPayloadBase64 ||
		packet.packetSha256 !== evidenceObjectSha256(core)
	)
		throw new Error("full-corpus bundle signing packet binding is invalid");
	if (
		!record(input.detachedSignature) ||
		!exact(input.detachedSignature, [
			"schemaVersion",
			"packetSha256",
			"signatureBase64",
		])
	)
		throw new Error("full-corpus bundle detached signature shape is invalid");
	const detached = input.detachedSignature as FullCorpusBundleDetachedSignature;
	const signature = Buffer.from(detached.signatureBase64, "base64");
	if (
		detached.schemaVersion !==
			"naia-memory-full-corpus-bundle-detached-signature-v1" ||
		detached.packetSha256 !== packet.packetSha256 ||
		signature.length !== 64 ||
		signature.toString("base64") !== detached.signatureBase64
	)
		throw new Error("full-corpus bundle detached signature content is invalid");
	const signer = input.trustPolicy.signers[packet.signerId];
	if (
		!signer ||
		ed25519PublicationSignerKeySha256(signer.publicKey) !==
			packet.signerKeySha256
	)
		throw new Error(
			"full-corpus bundle detached signature signer is untrusted",
		);
	if (
		!verify(
			null,
			Buffer.from(packet.signingPayloadBase64, "base64"),
			signer.publicKey,
			signature,
		)
	)
		throw new Error("full-corpus bundle detached signature is invalid");
	return {
		schemaVersion: "naia-memory-full-corpus-bundle-publication-receipt-v1",
		manifestSha256: packet.manifestSha256,
		signerId: packet.signerId,
		signerKeySha256: packet.signerKeySha256,
		signatureBase64: detached.signatureBase64,
	};
}

function parseReceipt(bytes: Buffer): FullCorpusBundlePublicationReceipt {
	let value: unknown;
	try {
		value = JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new Error("full-corpus bundle publication receipt is not valid JSON");
	}
	if (
		!record(value) ||
		!exact(value, [
			"schemaVersion",
			"manifestSha256",
			"signerId",
			"signerKeySha256",
			"signatureBase64",
		]) ||
		value.schemaVersion !==
			"naia-memory-full-corpus-bundle-publication-receipt-v1" ||
		typeof value.manifestSha256 !== "string" ||
		!SHA256.test(value.manifestSha256) ||
		typeof value.signerId !== "string" ||
		!value.signerId ||
		value.signerId.includes("\0") ||
		typeof value.signerKeySha256 !== "string" ||
		!SHA256.test(value.signerKeySha256) ||
		typeof value.signatureBase64 !== "string"
	)
		throw new Error("full-corpus bundle publication receipt shape is invalid");
	return value as FullCorpusBundlePublicationReceipt;
}

export function validateFullCorpusBundlePublication(input: {
	expectedManifestSha256: string;
	receiptBytes: Buffer;
	signerTrustPolicy: FullCorpusBundleSignerTrustPolicy;
	timestampEvidence: Rfc3161DigestTimestampEvidence;
	timestampTrustPolicy: Rfc3161TimestampTrustPolicy;
	commandRunner?: Rfc3161CommandRunner;
	tokenBytes?: Buffer;
	trustedCaBytes?: Buffer;
}) {
	validateFullCorpusBundleSignerTrustPolicy(input.signerTrustPolicy);
	const receipt = parseReceipt(input.receiptBytes);
	const result = validateEd25519PublicationReceipt({
		expectedArtifactSha256: input.expectedManifestSha256,
		receiptBytes: input.receiptBytes,
		receipt: {
			artifactSha256: receipt.manifestSha256,
			signerId: receipt.signerId,
			signerKeySha256: receipt.signerKeySha256,
			signatureBase64: receipt.signatureBase64,
		},
		domainPrefix: DOMAIN,
		signerTrustPolicy: input.signerTrustPolicy,
		timestampEvidence: input.timestampEvidence,
		timestampTrustPolicy: input.timestampTrustPolicy,
		commandRunner: input.commandRunner,
		tokenBytes: input.tokenBytes,
		trustedCaBytes: input.trustedCaBytes,
	});
	return { ...result, manifestSha256: result.artifactSha256 };
}
