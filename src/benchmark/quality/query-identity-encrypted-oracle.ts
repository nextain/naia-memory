import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from "node:crypto";
import {
	canonicalEvidenceJson,
	evidenceObjectSha256,
} from "./public-evidence-crypto.js";
import type { QueryIdentityOracle } from "./query-identity-oracle.js";

export interface QueryIdentityEncryptedOracleEnvelope {
	schemaVersion: "naia-memory-query-identity-encrypted-oracle-v1";
	algorithm: "AES-256-GCM";
	oracleSha256: string;
	keyCommitmentSha256: string;
	ivBase64: string;
	ciphertextBase64: string;
	authTagBase64: string;
}

export interface QueryIdentityOracleReleaseKey {
	schemaVersion: "naia-memory-query-identity-oracle-release-key-v1";
	envelopeSha256: string;
	keyBase64: string;
}

function sha256Buffer(value: Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function decodeExactBase64(
	value: string,
	bytes: number,
	label: string,
): Buffer {
	if (typeof value !== "string") throw new Error(`${label} must be base64`);
	const decoded = Buffer.from(value, "base64");
	if (decoded.length !== bytes || decoded.toString("base64") !== value)
		throw new Error(`${label} must be canonical base64 for ${bytes} bytes`);
	return decoded;
}

function decodeCanonicalBase64(value: string, label: string): Buffer {
	if (typeof value !== "string") throw new Error(`${label} must be base64`);
	const decoded = Buffer.from(value, "base64");
	if (decoded.toString("base64") !== value)
		throw new Error(`${label} must be canonical base64`);
	return decoded;
}

function assertSha256(value: string, label: string): void {
	if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} is invalid`);
}

export function validateEncryptedQueryIdentityOracleEnvelope(
	envelope: QueryIdentityEncryptedOracleEnvelope,
): void {
	if (
		envelope?.schemaVersion !==
			"naia-memory-query-identity-encrypted-oracle-v1" ||
		envelope.algorithm !== "AES-256-GCM"
	)
		throw new Error("encrypted oracle envelope schema is invalid");
	assertSha256(envelope.oracleSha256, "encrypted oracle hash");
	assertSha256(envelope.keyCommitmentSha256, "oracle key commitment");
	decodeExactBase64(envelope.ivBase64, 12, "oracle encryption IV");
	decodeExactBase64(envelope.authTagBase64, 16, "oracle authentication tag");
	if (
		decodeCanonicalBase64(envelope.ciphertextBase64, "oracle ciphertext")
			.length === 0
	)
		throw new Error("oracle ciphertext must not be empty");
}

export function createEncryptedQueryIdentityOracle(input: {
	oracle: QueryIdentityOracle;
	key?: Buffer;
	iv?: Buffer;
}): {
	envelope: QueryIdentityEncryptedOracleEnvelope;
	releaseKey: QueryIdentityOracleReleaseKey;
} {
	const key = input.key ?? randomBytes(32);
	const iv = input.iv ?? randomBytes(12);
	if (key.length !== 32)
		throw new Error("oracle encryption key must be 32 bytes");
	if (iv.length !== 12)
		throw new Error("oracle encryption IV must be 12 bytes");
	const plaintext = Buffer.from(canonicalEvidenceJson(input.oracle));
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	const envelope: QueryIdentityEncryptedOracleEnvelope = {
		schemaVersion: "naia-memory-query-identity-encrypted-oracle-v1",
		algorithm: "AES-256-GCM",
		oracleSha256: evidenceObjectSha256(input.oracle),
		keyCommitmentSha256: sha256Buffer(key),
		ivBase64: iv.toString("base64"),
		ciphertextBase64: ciphertext.toString("base64"),
		authTagBase64: cipher.getAuthTag().toString("base64"),
	};
	return {
		envelope,
		releaseKey: {
			schemaVersion: "naia-memory-query-identity-oracle-release-key-v1",
			envelopeSha256: evidenceObjectSha256(envelope),
			keyBase64: key.toString("base64"),
		},
	};
}

export function verifyEncryptedQueryIdentityOracleRelease(input: {
	envelope: QueryIdentityEncryptedOracleEnvelope;
	releaseKey: QueryIdentityOracleReleaseKey;
	expectedEnvelopeSha256?: string;
}): {
	oracle: QueryIdentityOracle;
	evidenceAssurance: {
		level: "launch-bound-encrypted-oracle-consistency";
		encryptedOracleEnvelopeIntegrityVerified: true;
		releasedKeyMatchesPrecommittedEnvelope: true;
		disclosedOracleMatchesEncryptedEnvelope: true;
		oracleKeyWithholdingVerified: false;
	};
} {
	const { envelope, releaseKey } = input;
	validateEncryptedQueryIdentityOracleEnvelope(envelope);
	const envelopeSha256 = evidenceObjectSha256(envelope);
	if (
		input.expectedEnvelopeSha256 !== undefined &&
		envelopeSha256 !== input.expectedEnvelopeSha256
	)
		throw new Error("encrypted oracle envelope does not match launch receipt");
	if (
		releaseKey?.schemaVersion !==
			"naia-memory-query-identity-oracle-release-key-v1" ||
		releaseKey.envelopeSha256 !== envelopeSha256
	)
		throw new Error("oracle release key envelope binding mismatch");
	const key = decodeExactBase64(releaseKey.keyBase64, 32, "oracle release key");
	if (sha256Buffer(key) !== envelope.keyCommitmentSha256)
		throw new Error("oracle release key commitment mismatch");
	const iv = decodeExactBase64(envelope.ivBase64, 12, "oracle encryption IV");
	const authTag = decodeExactBase64(
		envelope.authTagBase64,
		16,
		"oracle authentication tag",
	);
	let plaintext: Buffer;
	try {
		const decipher = createDecipheriv("aes-256-gcm", key, iv);
		decipher.setAuthTag(authTag);
		plaintext = Buffer.concat([
			decipher.update(
				decodeCanonicalBase64(envelope.ciphertextBase64, "oracle ciphertext"),
			),
			decipher.final(),
		]);
	} catch {
		throw new Error("encrypted oracle authentication failed");
	}
	let oracle: QueryIdentityOracle;
	try {
		oracle = JSON.parse(plaintext.toString("utf8")) as QueryIdentityOracle;
	} catch {
		throw new Error("decrypted oracle is not valid JSON");
	}
	if (
		canonicalEvidenceJson(oracle) !== plaintext.toString("utf8") ||
		evidenceObjectSha256(oracle) !== envelope.oracleSha256
	)
		throw new Error("decrypted oracle does not match envelope commitment");
	return {
		oracle,
		evidenceAssurance: {
			level: "launch-bound-encrypted-oracle-consistency",
			encryptedOracleEnvelopeIntegrityVerified: true,
			releasedKeyMatchesPrecommittedEnvelope: true,
			disclosedOracleMatchesEncryptedEnvelope: true,
			oracleKeyWithholdingVerified: false,
		},
	};
}
