import { createPublicKey } from "node:crypto";
import {
	canonicalEvidenceJson,
	evidenceObjectSha256,
	hasValidEvidenceSignature,
} from "./public-evidence-crypto.js";
import type { SemanticAttestationSigningPacket } from "./semantic-attestation-packet.js";
import {
	type SemanticPublicAttestation,
	type SemanticPublicAttestationBundle,
	type SemanticPublicTrustPolicy,
	isSemanticPublicTrustPolicy,
	validateSemanticPublicTrustPolicy,
} from "./semantic-public-attestation.js";

export type SemanticDetachedSignatureSet = {
	schemaVersion: "naia-memory-semantic-detached-signatures-v1";
	packetSha256: string;
	signatures: Array<{ assignmentId: string; signatureBase64: string }>;
};

const SHA256 = /^[a-f0-9]{64}$/;
const EXACT_PACKET_KEYS = [
	"assignments",
	"contractFrozenAt",
	"contractSha256",
	"packetSha256",
	"schemaVersion",
	"signedAt",
].sort();
const EXACT_ASSIGNMENT_KEYS = [
	"assignmentId",
	"signingPayloadBase64",
	"unsignedAttestation",
].sort();
const EXACT_UNSIGNED_KEYS = [
	"contractSha256",
	"language",
	"role",
	"schemaVersion",
	"signedAt",
	"signer",
	"statement",
].sort();
const EXACT_DETACHED_SIGNATURE_KEYS = [
	"assignmentId",
	"signatureBase64",
].sort();

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
	return JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys);
}

function strictBase64(value: unknown, byteLength?: number): value is string {
	if (typeof value !== "string") return false;
	const bytes = Buffer.from(value, "base64");
	return (
		(byteLength === undefined || bytes.length === byteLength) &&
		bytes.toString("base64") === value
	);
}

export function validateSemanticSigningPacket(
	value: unknown,
): asserts value is SemanticAttestationSigningPacket {
	if (!isRecord(value) || !hasExactKeys(value, EXACT_PACKET_KEYS))
		throw new Error("semantic signing packet shape is invalid");
	if (
		value.schemaVersion !== "naia-memory-semantic-signing-packet-v1" ||
		typeof value.contractSha256 !== "string" ||
		!SHA256.test(value.contractSha256) ||
		typeof value.contractFrozenAt !== "string" ||
		typeof value.signedAt !== "string" ||
		!Number.isFinite(Date.parse(value.contractFrozenAt)) ||
		!Number.isFinite(Date.parse(value.signedAt)) ||
		Date.parse(value.signedAt) < Date.parse(value.contractFrozenAt) ||
		typeof value.packetSha256 !== "string" ||
		!SHA256.test(value.packetSha256) ||
		!Array.isArray(value.assignments) ||
		value.assignments.length === 0
	)
		throw new Error("semantic signing packet content is invalid");
	const seen = new Set<string>();
	for (const assignment of value.assignments) {
		if (
			!isRecord(assignment) ||
			!hasExactKeys(assignment, EXACT_ASSIGNMENT_KEYS)
		)
			throw new Error("semantic signing assignment shape is invalid");
		const unsigned = assignment.unsignedAttestation;
		if (!isRecord(unsigned) || !hasExactKeys(unsigned, EXACT_UNSIGNED_KEYS))
			throw new Error("semantic unsigned attestation shape is invalid");
		if (
			unsigned.schemaVersion !== "naia-memory-semantic-attestation-v1" ||
			typeof unsigned.signer !== "string" ||
			unsigned.signer.trim().length === 0 ||
			(unsigned.role !== "author" && unsigned.role !== "native-reviewer") ||
			(unsigned.language !== "ko" &&
				unsigned.language !== "en" &&
				unsigned.language !== "ja") ||
			unsigned.contractSha256 !== value.contractSha256 ||
			unsigned.signedAt !== value.signedAt ||
			unsigned.statement !==
				(unsigned.role === "author"
					? "AUTHORSHIP_CONFIRMED"
					: "NATIVE_REVIEW_ACCEPTED")
		)
			throw new Error("semantic unsigned attestation content is invalid");
		const expectedId = JSON.stringify([
			unsigned.role,
			unsigned.language,
			unsigned.signer,
		]);
		const expectedPayload = Buffer.from(
			canonicalEvidenceJson(unsigned),
		).toString("base64");
		if (
			assignment.assignmentId !== expectedId ||
			assignment.signingPayloadBase64 !== expectedPayload ||
			!strictBase64(assignment.signingPayloadBase64)
		)
			throw new Error("semantic signing assignment binding is invalid");
		if (seen.has(expectedId))
			throw new Error("semantic signing assignment is duplicated");
		seen.add(expectedId);
	}
	const { packetSha256: _packetSha256, ...packetCore } = value;
	if (evidenceObjectSha256(packetCore) !== value.packetSha256)
		throw new Error("semantic signing packet hash is invalid");
}

function validateDetachedSignatures(
	value: unknown,
): asserts value is SemanticDetachedSignatureSet {
	if (
		!isRecord(value) ||
		value.schemaVersion !== "naia-memory-semantic-detached-signatures-v1" ||
		typeof value.packetSha256 !== "string" ||
		!SHA256.test(value.packetSha256) ||
		!Array.isArray(value.signatures)
	)
		throw new Error("semantic detached signatures shape is invalid");
	for (const item of value.signatures)
		if (
			!isRecord(item) ||
			!hasExactKeys(item, EXACT_DETACHED_SIGNATURE_KEYS) ||
			typeof item.assignmentId !== "string" ||
			!strictBase64(item.signatureBase64, 64)
		)
			throw new Error("semantic detached signature content is invalid");
}

export function assembleSemanticAttestationBundle(
	packetValue: unknown,
	detachedValue: unknown,
	trustValue: unknown,
): SemanticPublicAttestationBundle {
	validateSemanticSigningPacket(packetValue);
	validateDetachedSignatures(detachedValue);
	if (!isSemanticPublicTrustPolicy(trustValue))
		throw new Error("semantic trust policy shape is invalid");
	const packet = packetValue;
	const detached = detachedValue;
	const trust = trustValue as SemanticPublicTrustPolicy;
	validateSemanticPublicTrustPolicy(trust);
	if (detached.packetSha256 !== packet.packetSha256)
		throw new Error("semantic detached signatures target another packet");
	const signatures = new Map<string, string>();
	for (const item of detached.signatures) {
		if (signatures.has(item.assignmentId))
			throw new Error("semantic detached signature is duplicated");
		signatures.set(item.assignmentId, item.signatureBase64);
	}
	if (
		signatures.size !== packet.assignments.length ||
		packet.assignments.some((item) => !signatures.has(item.assignmentId))
	)
		throw new Error("semantic detached signatures do not cover the packet");
	const attestations: SemanticPublicAttestation[] = packet.assignments.map(
		(assignment) => {
			const unsigned = assignment.unsignedAttestation;
			const signatureBase64 = signatures.get(assignment.assignmentId) as string;
			const attestation = { ...unsigned, signatureBase64 };
			const publicKey =
				unsigned.role === "author"
					? trust.authorPublicKeysByLanguage[unsigned.language]?.[
							unsigned.signer
						]
					: trust.nativeReviewerPublicKeysByLanguage[unsigned.language]?.[
							unsigned.signer
						];
			if (
				!publicKey ||
				createPublicKey(publicKey).asymmetricKeyType !== "ed25519" ||
				!hasValidEvidenceSignature(attestation, publicKey)
			)
				throw new Error("semantic detached signature is untrusted or invalid");
			return attestation;
		},
	);
	return {
		schemaVersion: "naia-memory-semantic-attestation-bundle-v1",
		contractSha256: packet.contractSha256,
		attestations,
	};
}
