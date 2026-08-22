import { createHash, createPublicKey, verify } from "node:crypto";
import type {
	Rfc3161CommandRunner,
	Rfc3161DigestTimestampEvidence,
	Rfc3161TimestampTrustPolicy,
} from "./rfc3161-timestamp.js";
import { validateRfc3161DigestTimestampBinding } from "./rfc3161-timestamp.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

export type Ed25519PublicationSignerTrustPolicy = {
	signers: Record<
		string,
		{ publicKey: string; notBefore: string; notAfter: string }
	>;
};

export type Ed25519PublicationReceipt = {
	artifactSha256: string;
	signerId: string;
	signerKeySha256: string;
	signatureBase64: string;
};

function parseUtc(value: string): number {
	if (!UTC.test(value)) return Number.NaN;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
		? parsed
		: Number.NaN;
}

export function ed25519PublicationSignerKeySha256(publicKey: string): string {
	const key = createPublicKey(publicKey);
	if (key.asymmetricKeyType !== "ed25519")
		throw new Error("publication signer key is not Ed25519");
	return createHash("sha256")
		.update(key.export({ type: "spki", format: "der" }))
		.digest("hex");
}

export function validateEd25519PublicationSignerTrustPolicy(
	value: Ed25519PublicationSignerTrustPolicy,
): void {
	if (
		!value.signers ||
		typeof value.signers !== "object" ||
		Array.isArray(value.signers) ||
		Object.keys(value.signers).length === 0
	)
		throw new Error("publication signer trust policy is invalid");
	const fingerprints = new Set<string>();
	for (const [id, signer] of Object.entries(value.signers)) {
		if (
			!id ||
			id.includes("\0") ||
			!signer ||
			typeof signer !== "object" ||
			Object.keys(signer).sort().join("\0") !==
				["notAfter", "notBefore", "publicKey"].join("\0") ||
			typeof signer.publicKey !== "string" ||
			typeof signer.notBefore !== "string" ||
			typeof signer.notAfter !== "string" ||
			!Number.isFinite(parseUtc(signer.notBefore)) ||
			!Number.isFinite(parseUtc(signer.notAfter)) ||
			parseUtc(signer.notBefore) >= parseUtc(signer.notAfter)
		)
			throw new Error("publication signer trust policy is invalid");
		let fingerprint: string;
		try {
			fingerprint = ed25519PublicationSignerKeySha256(signer.publicKey);
		} catch {
			throw new Error("publication signer trust policy is invalid");
		}
		if (fingerprints.has(fingerprint))
			throw new Error("publication signer keys are duplicated");
		fingerprints.add(fingerprint);
	}
}

export function ed25519PublicationSigningPayload(input: {
	domainPrefix: string;
	artifactSha256: string;
	signerId: string;
	signerKeySha256: string;
}): Buffer {
	if (
		!input.domainPrefix.endsWith("\0") ||
		!SHA256.test(input.artifactSha256) ||
		!SHA256.test(input.signerKeySha256) ||
		!input.signerId ||
		input.signerId.includes("\0")
	)
		throw new Error("publication signing payload is invalid");
	const signer = Buffer.from(input.signerId, "utf8");
	return Buffer.concat([
		Buffer.from(input.domainPrefix, "ascii"),
		Buffer.from(
			`${input.artifactSha256}\0${input.signerKeySha256}\0${signer.length}:`,
			"ascii",
		),
		signer,
	]);
}

export function validateEd25519PublicationReceipt(input: {
	expectedArtifactSha256: string;
	receiptBytes: Buffer;
	receipt: Ed25519PublicationReceipt;
	domainPrefix: string;
	signerTrustPolicy: Ed25519PublicationSignerTrustPolicy;
	timestampEvidence: Rfc3161DigestTimestampEvidence;
	timestampTrustPolicy: Rfc3161TimestampTrustPolicy;
	commandRunner?: Rfc3161CommandRunner;
	tokenBytes?: Buffer;
	trustedCaBytes?: Buffer;
}): {
	artifactSha256: string;
	receiptSha256: string;
	signerId: string;
	timestampedAt: string;
} {
	validateEd25519PublicationSignerTrustPolicy(input.signerTrustPolicy);
	if (!SHA256.test(input.expectedArtifactSha256))
		throw new Error("publication artifact digest is invalid");
	const receiptSha256 = createHash("sha256")
		.update(input.receiptBytes)
		.digest("hex");
	const signer = input.signerTrustPolicy.signers[input.receipt.signerId];
	if (!signer || input.receipt.artifactSha256 !== input.expectedArtifactSha256)
		throw new Error("publication receipt binding is invalid");
	const keySha256 = ed25519PublicationSignerKeySha256(signer.publicKey);
	if (input.receipt.signerKeySha256 !== keySha256)
		throw new Error("publication signer key binding is invalid");
	const signature = Buffer.from(input.receipt.signatureBase64, "base64");
	if (
		signature.length !== 64 ||
		signature.toString("base64") !== input.receipt.signatureBase64 ||
		!verify(
			null,
			ed25519PublicationSigningPayload({
				domainPrefix: input.domainPrefix,
				artifactSha256: input.receipt.artifactSha256,
				signerId: input.receipt.signerId,
				signerKeySha256: input.receipt.signerKeySha256,
			}),
			signer.publicKey,
			signature,
		)
	)
		throw new Error("publication receipt signature is invalid");
	const timestamp = validateRfc3161DigestTimestampBinding({
		expectedArtifactSha256: receiptSha256,
		evidence: input.timestampEvidence,
		trustPolicy: input.timestampTrustPolicy,
		commandRunner: input.commandRunner,
		tokenBytes: input.tokenBytes,
		trustedCaBytes: input.trustedCaBytes,
	});
	const timestampedAt = Date.parse(timestamp.timestampedAt);
	if (
		timestampedAt < parseUtc(signer.notBefore) ||
		timestampedAt > parseUtc(signer.notAfter)
	)
		throw new Error("publication signer key was not valid at TSA time");
	return {
		artifactSha256: input.expectedArtifactSha256,
		receiptSha256,
		signerId: input.receipt.signerId,
		...timestamp,
	};
}
