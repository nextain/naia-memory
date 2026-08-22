import { createHash, createPublicKey, verify } from "node:crypto";

export function canonicalEvidenceJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value))
		return `[${value.map(canonicalEvidenceJson).join(",")}]`;
	return `{${Object.entries(value as Record<string, unknown>)
		.filter(([, item]) => item !== undefined)
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(
			([key, item]) => `${JSON.stringify(key)}:${canonicalEvidenceJson(item)}`,
		)
		.join(",")}}`;
}

export function evidenceSignaturePayload(value: object): Buffer {
	const { signatureBase64: _signature, ...unsigned } = value as {
		signatureBase64?: unknown;
	};
	return Buffer.from(canonicalEvidenceJson(unsigned));
}

export function evidenceObjectSha256(value: unknown): string {
	return createHash("sha256")
		.update(canonicalEvidenceJson(value))
		.digest("hex");
}

export function evidencePublicKeysMatch(
	left?: string,
	right?: string,
): boolean {
	if (!left || !right) return false;
	try {
		const exportDer = (value: string) =>
			createPublicKey(value).export({ type: "spki", format: "der" });
		return exportDer(left).equals(exportDer(right));
	} catch {
		return false;
	}
}

export function hasValidEvidenceSignature(
	value: object,
	publicKey?: string,
): boolean {
	const signatureBase64 = (value as { signatureBase64?: unknown })
		.signatureBase64;
	if (!publicKey || typeof signatureBase64 !== "string") return false;
	try {
		const signature = Buffer.from(signatureBase64, "base64");
		if (
			signature.length !== 64 ||
			signature.toString("base64") !== signatureBase64 ||
			createPublicKey(publicKey).asymmetricKeyType !== "ed25519"
		)
			return false;
		return verify(null, evidenceSignaturePayload(value), publicKey, signature);
	} catch {
		return false;
	}
}
