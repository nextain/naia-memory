import {
	evidenceObjectSha256,
	hasValidEvidenceSignature,
} from "./public-evidence-crypto.js";
import type {
	Rfc3161CommandRunner,
	Rfc3161DigestTimestampEvidence,
	Rfc3161TimestampTrustPolicy,
} from "./rfc3161-timestamp.js";
import { validateRfc3161DigestTimestampBinding } from "./rfc3161-timestamp.js";

export type PublicDatasetCustodySeal = {
	schemaVersion: "naia-memory-public-dataset-custody-seal-v1";
	custodian: string;
	datasetSha256: string;
	sealedAt: string;
	statement: "NO_BENCHMARK_OPERATOR_ACCESS_BEFORE_DISCLOSURE";
	signatureBase64: string;
};

export function isPublicDatasetCustodySeal(
	value: unknown,
): value is PublicDatasetCustodySeal {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const seal = value as Record<string, unknown>;
	const expectedKeys = [
		"schemaVersion",
		"custodian",
		"datasetSha256",
		"sealedAt",
		"statement",
		"signatureBase64",
	];
	return (
		Object.keys(seal).length === expectedKeys.length &&
		expectedKeys.every((key) => key in seal) &&
		seal.schemaVersion === "naia-memory-public-dataset-custody-seal-v1" &&
		typeof seal.custodian === "string" &&
		typeof seal.datasetSha256 === "string" &&
		typeof seal.sealedAt === "string" &&
		seal.statement === "NO_BENCHMARK_OPERATOR_ACCESS_BEFORE_DISCLOSURE" &&
		typeof seal.signatureBase64 === "string"
	);
}

export function publicDatasetCustodySealSigningPacket(input: {
	custodian: string;
	datasetSha256: string;
	sealedAt: string;
}): {
	unsignedSeal: Omit<PublicDatasetCustodySeal, "signatureBase64">;
	timestampArtifactSha256: string;
} {
	if (!input.custodian.trim()) throw new Error("dataset custodian is missing");
	if (!/^[a-f0-9]{64}$/.test(input.datasetSha256))
		throw new Error("dataset SHA-256 is invalid");
	const sealedAt = Date.parse(input.sealedAt);
	if (
		!Number.isFinite(sealedAt) ||
		new Date(sealedAt).toISOString() !== input.sealedAt
	)
		throw new Error("dataset seal timestamp is not canonical UTC");
	const unsignedSeal = {
		schemaVersion: "naia-memory-public-dataset-custody-seal-v1" as const,
		custodian: input.custodian,
		datasetSha256: input.datasetSha256,
		sealedAt: input.sealedAt,
		statement: "NO_BENCHMARK_OPERATOR_ACCESS_BEFORE_DISCLOSURE" as const,
	};
	return {
		unsignedSeal,
		timestampArtifactSha256: evidenceObjectSha256(unsignedSeal),
	};
}

export function verifyPublicDatasetCustodySeal(input: {
	seal: unknown;
	expectedDatasetSha256: string;
	custodianPublicKey: string;
	timestampEvidence: Rfc3161DigestTimestampEvidence;
	timestampTrustPolicy: Rfc3161TimestampTrustPolicy;
	challengeIssuedAt: string;
	commandRunner?: Rfc3161CommandRunner;
	tokenBytes?: Buffer;
	trustedCaBytes?: Buffer;
}): { timestampedAt: string; custodyPriorExistenceVerified: true } {
	if (!isPublicDatasetCustodySeal(input.seal))
		throw new Error("dataset custody seal shape is invalid");
	const packet = publicDatasetCustodySealSigningPacket(input.seal);
	if (input.seal.datasetSha256 !== input.expectedDatasetSha256)
		throw new Error("dataset custody seal dataset hash mismatch");
	if (!hasValidEvidenceSignature(input.seal, input.custodianPublicKey))
		throw new Error("dataset custody seal signature is untrusted or invalid");
	const timestamp = validateRfc3161DigestTimestampBinding({
		expectedArtifactSha256: packet.timestampArtifactSha256,
		evidence: input.timestampEvidence,
		trustPolicy: input.timestampTrustPolicy,
		commandRunner: input.commandRunner,
		tokenBytes: input.tokenBytes,
		trustedCaBytes: input.trustedCaBytes,
	});
	const sealedAt = Date.parse(input.seal.sealedAt);
	const timestampedAt = Date.parse(timestamp.timestampedAt);
	const challengeIssuedAt = Date.parse(input.challengeIssuedAt);
	if (![sealedAt, timestampedAt, challengeIssuedAt].every(Number.isFinite))
		throw new Error("dataset custody chronology is invalid");
	if (sealedAt > timestampedAt || timestampedAt - sealedAt > 1000)
		throw new Error("dataset custody asserted seal time differs from TSA time");
	if (timestampedAt >= challengeIssuedAt)
		throw new Error(
			"dataset custody seal was not timestamped before challenge",
		);
	return {
		timestampedAt: timestamp.timestampedAt,
		custodyPriorExistenceVerified: true,
	};
}
