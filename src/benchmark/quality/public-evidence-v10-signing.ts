import { createHash, createPublicKey, verify } from "node:crypto";
import {
	canonicalEvidenceJson,
	evidenceObjectSha256,
	evidenceSignaturePayload,
} from "./public-evidence-crypto.js";
import {
	type PublicEvidenceV10Envelope,
	isPublicEvidenceV10Envelope,
} from "./public-evidence-v10-gate.js";

const SHA256 = /^[a-f0-9]{64}$/u;

export type PublicEvidenceV10UnsignedEnvelope = Omit<
	PublicEvidenceV10Envelope,
	"signatureBase64"
>;

export type PublicEvidenceV10SigningPacket = {
	schemaVersion: "naia-memory-public-evidence-v10-signing-packet-v1";
	publisher: string;
	publisherKeySha256: string;
	unsignedEnvelope: PublicEvidenceV10UnsignedEnvelope;
	signingPayloadBase64: string;
	packetSha256: string;
};

export type PublicEvidenceV10DetachedSignature = {
	schemaVersion: "naia-memory-public-evidence-v10-detached-signature-v1";
	packetSha256: string;
	signatureBase64: string;
};

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: string[]): boolean {
	return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function publicKeySha256(publicKey: string): string {
	const key = createPublicKey(publicKey);
	if (key.asymmetricKeyType !== "ed25519")
		throw new Error("v10 publisher key must be Ed25519");
	return createHash("sha256")
		.update(key.export({ type: "spki", format: "der" }))
		.digest("hex");
}

function packetCore(input: {
	unsignedEnvelope: PublicEvidenceV10UnsignedEnvelope;
	publisherPublicKey: string;
}) {
	const signingPayload = evidenceSignaturePayload({
		...input.unsignedEnvelope,
		signatureBase64: "",
	});
	return {
		schemaVersion: "naia-memory-public-evidence-v10-signing-packet-v1" as const,
		publisher: input.unsignedEnvelope.publisher,
		publisherKeySha256: publicKeySha256(input.publisherPublicKey),
		unsignedEnvelope: input.unsignedEnvelope,
		signingPayloadBase64: signingPayload.toString("base64"),
	};
}

export function buildPublicEvidenceV10SigningPacket(input: {
	unsignedEnvelope: PublicEvidenceV10UnsignedEnvelope;
	publisherPublicKey: string;
}): PublicEvidenceV10SigningPacket {
	if (
		!isPublicEvidenceV10Envelope({
			...input.unsignedEnvelope,
			signatureBase64: "",
		})
	)
		throw new Error("v10 unsigned envelope shape is invalid");
	const core = packetCore(input);
	return { ...core, packetSha256: evidenceObjectSha256(core) };
}

export function collectPublicEvidenceV10Signature(input: {
	packet: unknown;
	detachedSignature: unknown;
	publisherPublicKey: string;
}): PublicEvidenceV10Envelope {
	if (
		!record(input.packet) ||
		!exact(input.packet, [
			"schemaVersion",
			"publisher",
			"publisherKeySha256",
			"unsignedEnvelope",
			"signingPayloadBase64",
			"packetSha256",
		])
	)
		throw new Error("v10 signing packet shape is invalid");
	const packet = input.packet as PublicEvidenceV10SigningPacket;
	if (
		packet.schemaVersion !==
			"naia-memory-public-evidence-v10-signing-packet-v1" ||
		!SHA256.test(packet.publisherKeySha256) ||
		!SHA256.test(packet.packetSha256)
	)
		throw new Error("v10 signing packet content is invalid");
	const rebuilt = packetCore({
		unsignedEnvelope: packet.unsignedEnvelope,
		publisherPublicKey: input.publisherPublicKey,
	});
	if (
		packet.publisher !== packet.unsignedEnvelope.publisher ||
		packet.publisherKeySha256 !== rebuilt.publisherKeySha256 ||
		packet.signingPayloadBase64 !== rebuilt.signingPayloadBase64 ||
		packet.packetSha256 !== evidenceObjectSha256(rebuilt)
	)
		throw new Error("v10 signing packet binding is invalid");
	if (
		!record(input.detachedSignature) ||
		!exact(input.detachedSignature, [
			"schemaVersion",
			"packetSha256",
			"signatureBase64",
		])
	)
		throw new Error("v10 detached signature shape is invalid");
	const detached =
		input.detachedSignature as PublicEvidenceV10DetachedSignature;
	const signature = Buffer.from(detached.signatureBase64, "base64");
	if (
		detached.schemaVersion !==
			"naia-memory-public-evidence-v10-detached-signature-v1" ||
		detached.packetSha256 !== packet.packetSha256 ||
		signature.length !== 64 ||
		signature.toString("base64") !== detached.signatureBase64 ||
		!verify(
			null,
			Buffer.from(packet.signingPayloadBase64, "base64"),
			input.publisherPublicKey,
			signature,
		)
	)
		throw new Error("v10 detached signature is invalid");
	const envelope = {
		...packet.unsignedEnvelope,
		signatureBase64: detached.signatureBase64,
	};
	if (!isPublicEvidenceV10Envelope(envelope))
		throw new Error("v10 collected envelope is invalid");
	return envelope;
}

export function canonicalPublicEvidenceV10SigningPacket(
	packet: PublicEvidenceV10SigningPacket,
): string {
	return canonicalEvidenceJson(packet);
}
