import { deriveFullCorpusExecutionBinding } from "./native-full-corpus-public-attestation.js";
import {
	canonicalEvidenceJson,
	evidenceObjectSha256,
} from "./public-evidence-crypto.js";
import type { PublicExecutionChallenge } from "./public-execution-attestation.js";

type UnsignedChallenge = Omit<PublicExecutionChallenge, "signatureBase64">;

export type FullCorpusChallengeSigningPacket = {
	schemaVersion: "naia-memory-full-corpus-challenge-signing-packet-v1";
	baseReceiptSha256: string;
	unsignedChallenge: UnsignedChallenge;
	signingPayloadBase64: string;
	packetSha256: string;
};

export function buildFullCorpusChallengeSigningPacket(input: {
	receiptText: string;
	issuer: string;
	challengeId: string;
	nonce: string;
	issuedAt: string;
	expiresAt: string;
}): FullCorpusChallengeSigningPacket {
	if (!input.issuer.trim() || !input.challengeId.trim())
		throw new Error("full-corpus challenge identity is missing");
	if (!/^[A-Za-z0-9_-]{32,}$/.test(input.nonce))
		throw new Error("full-corpus challenge nonce is invalid");
	const issuedAt = Date.parse(input.issuedAt);
	const expiresAt = Date.parse(input.expiresAt);
	if (
		!Number.isFinite(issuedAt) ||
		!Number.isFinite(expiresAt) ||
		expiresAt <= issuedAt
	)
		throw new Error("full-corpus challenge time window is invalid");
	const binding = deriveFullCorpusExecutionBinding(input.receiptText);
	const unsignedChallenge: UnsignedChallenge = {
		schemaVersion: "naia-memory-public-execution-challenge-v1",
		issuer: input.issuer,
		challengeId: input.challengeId,
		nonce: input.nonce,
		engine: binding.engine,
		datasetSha256: binding.datasetSha256,
		protocolSha256: binding.protocolSha256,
		issuedAt: input.issuedAt,
		expiresAt: input.expiresAt,
	};
	const packetCore = {
		schemaVersion:
			"naia-memory-full-corpus-challenge-signing-packet-v1" as const,
		baseReceiptSha256: binding.receiptSha256,
		unsignedChallenge,
		signingPayloadBase64: Buffer.from(
			canonicalEvidenceJson(unsignedChallenge),
		).toString("base64"),
	};
	return { ...packetCore, packetSha256: evidenceObjectSha256(packetCore) };
}
