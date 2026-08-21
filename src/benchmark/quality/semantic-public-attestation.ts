import { createPublicKey } from "node:crypto";
import type {
	MemoryUpdateContract,
	MemoryUpdateLanguage,
} from "./memory-update-contract.js";
import {
	evidenceObjectSha256,
	hasValidEvidenceSignature,
} from "./public-evidence-crypto.js";

export type SemanticPublicAttestation = {
	schemaVersion: "naia-memory-semantic-attestation-v1";
	signer: string;
	role: "author" | "native-reviewer";
	language: MemoryUpdateLanguage;
	contractSha256: string;
	signedAt: string;
	statement: "AUTHORSHIP_CONFIRMED" | "NATIVE_REVIEW_ACCEPTED";
	signatureBase64: string;
};

export type SemanticPublicAttestationBundle = {
	schemaVersion: "naia-memory-semantic-attestation-bundle-v1";
	contractSha256: string;
	attestations: SemanticPublicAttestation[];
};

export type SemanticPublicTrustPolicy = {
	authorPublicKeysByLanguage: Record<string, Record<string, string>>;
	nativeReviewerPublicKeysByLanguage: Record<string, Record<string, string>>;
};

const SHA256 = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEd25519Key(value: unknown): value is string {
	if (typeof value !== "string") return false;
	try {
		return createPublicKey(value).asymmetricKeyType === "ed25519";
	} catch {
		return false;
	}
}

function isKeyMap(value: unknown): value is Record<string, string> {
	return (
		isRecord(value) &&
		Object.keys(value).length > 0 &&
		Object.entries(value).every(
			([identity, key]) => identity.trim().length > 0 && isEd25519Key(key),
		)
	);
}

function isRoleKeyMap(
	value: unknown,
): value is Record<string, Record<string, string>> {
	return (
		isRecord(value) &&
		Object.keys(value).length > 0 &&
		Object.values(value).every(isKeyMap)
	);
}

export function isSemanticPublicTrustPolicy(
	value: unknown,
): value is SemanticPublicTrustPolicy {
	return (
		isRecord(value) &&
		isRoleKeyMap(value.authorPublicKeysByLanguage) &&
		isRoleKeyMap(value.nativeReviewerPublicKeysByLanguage)
	);
}

export function isSemanticPublicAttestationBundle(
	value: unknown,
): value is SemanticPublicAttestationBundle {
	return (
		isRecord(value) &&
		value.schemaVersion === "naia-memory-semantic-attestation-bundle-v1" &&
		typeof value.contractSha256 === "string" &&
		SHA256.test(value.contractSha256) &&
		Array.isArray(value.attestations) &&
		value.attestations.every(
			(item) =>
				isRecord(item) &&
				item.schemaVersion === "naia-memory-semantic-attestation-v1" &&
				typeof item.signer === "string" &&
				item.signer.trim().length > 0 &&
				(item.role === "author" || item.role === "native-reviewer") &&
				(item.language === "ko" ||
					item.language === "en" ||
					item.language === "ja") &&
				typeof item.contractSha256 === "string" &&
				typeof item.signedAt === "string" &&
				(item.statement === "AUTHORSHIP_CONFIRMED" ||
					item.statement === "NATIVE_REVIEW_ACCEPTED") &&
				typeof item.signatureBase64 === "string",
		)
	);
}

export function validateSemanticPublicTrustPolicy(
	trustPolicy: SemanticPublicTrustPolicy,
): void {
	const keyOwners = new Map<string, string>();
	const identityKeys = new Map<string, string>();
	const identityRoles = new Map<string, string>();
	for (const [role, languages] of [
		["author", trustPolicy.authorPublicKeysByLanguage],
		["native-reviewer", trustPolicy.nativeReviewerPublicKeysByLanguage],
	] as const)
		for (const identities of Object.values(languages))
			for (const [identity, key] of Object.entries(identities)) {
				const normalizedKey = createPublicKey(key)
					.export({ type: "spki", format: "der" })
					.toString("base64");
				const owner = keyOwners.get(normalizedKey);
				if (owner && owner !== identity)
					throw new Error("semantic trust keys overlap across identities");
				keyOwners.set(normalizedKey, identity);
				const priorKey = identityKeys.get(identity);
				if (priorKey && priorKey !== normalizedKey)
					throw new Error("semantic trust identity has multiple keys");
				identityKeys.set(identity, normalizedKey);
				const priorRole = identityRoles.get(identity);
				if (priorRole && priorRole !== role)
					throw new Error("semantic trust identities overlap across roles");
				identityRoles.set(identity, role);
			}
}

function assignmentKey(
	role: SemanticPublicAttestation["role"],
	language: string,
	signer: string,
): string {
	return JSON.stringify([role, language, signer]);
}

export function validateSemanticPublicAttestations(
	contract: MemoryUpdateContract,
	bundle: SemanticPublicAttestationBundle,
	trustPolicy: SemanticPublicTrustPolicy,
): void {
	const contractSha256 = evidenceObjectSha256(contract);
	if (
		!SHA256.test(bundle.contractSha256) ||
		bundle.contractSha256 !== contractSha256
	)
		throw new Error("semantic attestation bundle is not bound to the contract");
	const testCases = contract.cases.filter(
		(current) => current.split === "test",
	);
	const expected = new Set<string>();
	for (const current of testCases) {
		const provenance = current.provenance;
		if (!provenance) throw new Error(`${current.id}: provenance is missing`);
		expected.add(
			assignmentKey("author", current.language, provenance.authorId),
		);
		expected.add(
			assignmentKey("native-reviewer", current.language, provenance.reviewerId),
		);
	}
	const seen = new Set<string>();
	validateSemanticPublicTrustPolicy(trustPolicy);
	const frozenAt = Date.parse(contract.familySplitFreeze?.frozenAt ?? "");
	if (!Number.isFinite(frozenAt))
		throw new Error("semantic contract freeze timestamp is invalid");
	for (const attestation of bundle.attestations) {
		if (!isRecord(attestation))
			throw new Error("semantic attestation shape is invalid");
		const key = assignmentKey(
			attestation.role,
			attestation.language,
			attestation.signer,
		);
		const expectedStatement =
			attestation.role === "author"
				? "AUTHORSHIP_CONFIRMED"
				: "NATIVE_REVIEW_ACCEPTED";
		if (
			attestation.schemaVersion !== "naia-memory-semantic-attestation-v1" ||
			!expected.has(key) ||
			attestation.contractSha256 !== contractSha256 ||
			attestation.statement !== expectedStatement ||
			!Number.isFinite(Date.parse(attestation.signedAt)) ||
			Date.parse(attestation.signedAt) < frozenAt
		)
			throw new Error("semantic attestation content is invalid");
		if (seen.has(key)) throw new Error("semantic attestation is duplicated");
		seen.add(key);
		const publicKey =
			attestation.role === "author"
				? trustPolicy.authorPublicKeysByLanguage[attestation.language]?.[
						attestation.signer
					]
				: trustPolicy.nativeReviewerPublicKeysByLanguage[
						attestation.language
					]?.[attestation.signer];
		if (!hasValidEvidenceSignature(attestation, publicKey))
			throw new Error("semantic attestation signature is untrusted or invalid");
	}
	if (
		seen.size !== expected.size ||
		[...expected].some((key) => !seen.has(key))
	)
		throw new Error("semantic attestations do not cover all case assignments");
}
