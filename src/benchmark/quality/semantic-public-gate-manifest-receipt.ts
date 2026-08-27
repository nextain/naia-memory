import { createHash, createPublicKey, verify } from "node:crypto";
import {
	PublicEvidenceFileTooLargeError,
	readBoundedEvidenceFile,
} from "./public-evidence-file-io.js";
import {
	type Rfc3161CommandRunner,
	type Rfc3161DigestTimestampEvidence,
	type Rfc3161TimestampTrustPolicy,
	validateRfc3161DigestTimestampBinding,
} from "./rfc3161-timestamp.js";

const MAX_RECEIPT_BYTES = 64 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const SIGNATURE_PREFIX = "NAIA-SEMANTIC-PUBLIC-GATE-MANIFEST-V1\0";

export type SemanticPublicGateManifestReceipt = {
	schemaVersion: "naia-memory-semantic-public-gate-manifest-receipt-v1";
	manifestSha256: string;
	signerId: string;
	signerKeySha256: string;
	signatureBase64: string;
};

export type SemanticPublicGateManifestSignerTrustPolicy = {
	schemaVersion: "naia-memory-semantic-public-gate-manifest-signer-trust-policy-v1";
	signers: Record<
		string,
		{ publicKey: string; notBefore: string; notAfter: string }
	>;
};

function exactKeys(
	value: Record<string, unknown>,
	expected: string[],
): boolean {
	const actual = Object.keys(value).sort();
	return (
		actual.length === expected.length &&
		actual.every((key, index) => key === [...expected].sort()[index])
	);
}

function parseUtc(value: unknown): number {
	if (typeof value !== "string" || !UTC.test(value)) return Number.NaN;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
		? parsed
		: Number.NaN;
}

export function semanticPublicGateSignerKeySha256(publicKey: string): string {
	const key = createPublicKey(publicKey);
	if (key.asymmetricKeyType !== "ed25519")
		throw new Error("semantic public gate manifest signer key is not Ed25519");
	return createHash("sha256")
		.update(key.export({ type: "spki", format: "der" }))
		.digest("hex");
}

/** Exact, domain-separated bytes signed by an offline Ed25519 signer. */
export function semanticPublicGateManifestSigningPayload(input: {
	manifestSha256: string;
	signerId: string;
	signerKeySha256: string;
}): Buffer {
	if (
		!SHA256.test(input.manifestSha256) ||
		!SHA256.test(input.signerKeySha256) ||
		!input.signerId ||
		input.signerId.includes("\0")
	)
		throw new Error("semantic public gate manifest signing payload is invalid");
	const signer = Buffer.from(input.signerId, "utf8");
	return Buffer.concat([
		Buffer.from(SIGNATURE_PREFIX, "ascii"),
		Buffer.from(
			`${input.manifestSha256}\0${input.signerKeySha256}\0${signer.length}:`,
			"ascii",
		),
		signer,
	]);
}

function parseReceipt(bytes: Buffer): SemanticPublicGateManifestReceipt {
	let value: unknown;
	try {
		value = JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new Error("semantic public gate manifest receipt is not valid JSON");
	}
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("semantic public gate manifest receipt shape is invalid");
	const item = value as Record<string, unknown>;
	if (
		!exactKeys(item, [
			"schemaVersion",
			"manifestSha256",
			"signerId",
			"signerKeySha256",
			"signatureBase64",
		]) ||
		item.schemaVersion !==
			"naia-memory-semantic-public-gate-manifest-receipt-v1" ||
		typeof item.manifestSha256 !== "string" ||
		!SHA256.test(item.manifestSha256) ||
		typeof item.signerId !== "string" ||
		!item.signerId ||
		item.signerId.includes("\0") ||
		typeof item.signerKeySha256 !== "string" ||
		!SHA256.test(item.signerKeySha256) ||
		typeof item.signatureBase64 !== "string"
	)
		throw new Error("semantic public gate manifest receipt shape is invalid");
	return value as SemanticPublicGateManifestReceipt;
}

export function validateSemanticPublicGateManifestSignerTrustPolicy(
	value: SemanticPublicGateManifestSignerTrustPolicy,
): void {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		!exactKeys(value as unknown as Record<string, unknown>, [
			"schemaVersion",
			"signers",
		]) ||
		value.schemaVersion !==
			"naia-memory-semantic-public-gate-manifest-signer-trust-policy-v1" ||
		!value.signers ||
		typeof value.signers !== "object" ||
		Array.isArray(value.signers) ||
		Object.keys(value.signers).length === 0
	)
		throw new Error(
			"semantic public gate manifest signer trust policy is invalid",
		);
	const fingerprints = new Set<string>();
	for (const [id, signer] of Object.entries(value.signers)) {
		if (
			!id ||
			id.includes("\0") ||
			!signer ||
			typeof signer !== "object" ||
			!exactKeys(signer as unknown as Record<string, unknown>, [
				"publicKey",
				"notBefore",
				"notAfter",
			]) ||
			!Number.isFinite(parseUtc(signer.notBefore)) ||
			!Number.isFinite(parseUtc(signer.notAfter)) ||
			parseUtc(signer.notBefore) >= parseUtc(signer.notAfter)
		)
			throw new Error(
				"semantic public gate manifest signer trust policy is invalid",
			);
		let fingerprint: string;
		try {
			fingerprint = semanticPublicGateSignerKeySha256(signer.publicKey);
		} catch {
			throw new Error(
				"semantic public gate manifest signer trust policy is invalid",
			);
		}
		if (fingerprints.has(fingerprint))
			throw new Error(
				"semantic public gate manifest signer keys are duplicated",
			);
		fingerprints.add(fingerprint);
	}
}

async function bounded(
	path: string,
	limit: number,
	label: string,
): Promise<Buffer> {
	try {
		return await readBoundedEvidenceFile(path, limit);
	} catch (error) {
		if (error instanceof PublicEvidenceFileTooLargeError)
			throw new Error(`${label} exceeds its intake limit`);
		throw new Error(`${label} is unreadable`);
	}
}

export async function validateSemanticPublicGateManifestReceipt(input: {
	expectedManifestSha256: string;
	receiptPath: string;
	signerTrustPolicy: SemanticPublicGateManifestSignerTrustPolicy;
	timestampEvidence: Rfc3161DigestTimestampEvidence;
	timestampTrustPolicy: Rfc3161TimestampTrustPolicy;
	commandRunner?: Rfc3161CommandRunner;
}): Promise<{
	manifestSha256: string;
	receiptSha256: string;
	signerId: string;
	timestampedAt: string;
}> {
	validateSemanticPublicGateManifestSignerTrustPolicy(input.signerTrustPolicy);
	if (!SHA256.test(input.expectedManifestSha256))
		throw new Error("semantic public gate manifest digest is invalid");
	const receiptBytes = await bounded(
		input.receiptPath,
		MAX_RECEIPT_BYTES,
		"semantic public gate manifest receipt",
	);
	const manifestSha256 = input.expectedManifestSha256;
	const receiptSha256 = createHash("sha256").update(receiptBytes).digest("hex");
	const receipt = parseReceipt(receiptBytes);
	const signer = input.signerTrustPolicy.signers[receipt.signerId];
	if (!signer || receipt.manifestSha256 !== manifestSha256)
		throw new Error("semantic public gate manifest receipt binding is invalid");
	const keySha256 = semanticPublicGateSignerKeySha256(signer.publicKey);
	if (receipt.signerKeySha256 !== keySha256)
		throw new Error(
			"semantic public gate manifest signer key binding is invalid",
		);
	const signature = Buffer.from(receipt.signatureBase64, "base64");
	if (
		signature.length !== 64 ||
		signature.toString("base64") !== receipt.signatureBase64 ||
		!verify(
			null,
			semanticPublicGateManifestSigningPayload(receipt),
			signer.publicKey,
			signature,
		)
	)
		throw new Error(
			"semantic public gate manifest receipt signature is invalid",
		);
	const timestamp = validateRfc3161DigestTimestampBinding({
		expectedArtifactSha256: receiptSha256,
		evidence: input.timestampEvidence,
		trustPolicy: input.timestampTrustPolicy,
		commandRunner: input.commandRunner,
	});
	const timestampedAt = Date.parse(timestamp.timestampedAt);
	if (
		timestampedAt < parseUtc(signer.notBefore) ||
		timestampedAt > parseUtc(signer.notAfter)
	)
		throw new Error(
			"semantic public gate manifest signer key was not valid at TSA time",
		);
	return {
		manifestSha256,
		receiptSha256,
		signerId: receipt.signerId,
		...timestamp,
	};
}
