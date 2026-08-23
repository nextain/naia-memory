import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
	isPublicDatasetCustodySeal,
	verifyPublicDatasetCustodySeal,
} from "./public-dataset-custody-seal.js";
import { hasValidEvidenceSignature } from "./public-evidence-crypto.js";
import {
	PublicEvidenceFileTooLargeError,
	readBoundedEvidenceFile,
} from "./public-evidence-file-io.js";
import { evaluatePublicEvidenceFiles } from "./public-evidence-gate.js";
import type {
	PublicEvidenceDecision,
	PublicEvidenceManifest,
	PublicEvidenceTrustPolicy,
} from "./public-evidence-types.js";
import { isPublicEvidenceTrustPolicy } from "./public-evidence-types.js";
import { isPublicEvidenceManifest } from "./public-manifest-validator.js";
import {
	type Rfc3161CommandRunner,
	type Rfc3161TimestampTrustPolicy,
	isRfc3161DigestTimestampEvidence,
	isRfc3161TimestampTrustPolicy,
} from "./rfc3161-timestamp.js";

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_FILE_BYTES = 16 * 1024 * 1024;

export type PublicEvidenceV10Envelope = {
	schemaVersion: "naia-memory-public-evidence-promotion-v10";
	publisher: string;
	coreManifestPath: string;
	coreManifestSha256: string;
	datasetPath: string;
	datasetSha256: string;
	custodySealPath: string;
	custodySealSha256: string;
	custodyTimestampEvidencePath: string;
	custodyTimestampEvidenceSha256: string;
	custodyTimestampTokenPath: string;
	custodyTimestampTokenSha256: string;
	signatureBase64: string;
};

export type PublicEvidenceV10TrustPolicy = {
	core: PublicEvidenceTrustPolicy;
	custodyTimestamp: Rfc3161TimestampTrustPolicy;
};

export function isPublicEvidenceV10Envelope(
	value: unknown,
): value is PublicEvidenceV10Envelope {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const item = value as Record<string, unknown>;
	const keys = [
		"schemaVersion",
		"publisher",
		"coreManifestPath",
		"coreManifestSha256",
		"datasetPath",
		"datasetSha256",
		"custodySealPath",
		"custodySealSha256",
		"custodyTimestampEvidencePath",
		"custodyTimestampEvidenceSha256",
		"custodyTimestampTokenPath",
		"custodyTimestampTokenSha256",
		"signatureBase64",
	];
	return (
		Object.keys(item).length === keys.length &&
		keys.every((key) => key in item) &&
		item.schemaVersion === "naia-memory-public-evidence-promotion-v10" &&
		keys.slice(1).every((key) => typeof item[key] === "string") &&
		[
			"coreManifestSha256",
			"datasetSha256",
			"custodySealSha256",
			"custodyTimestampEvidenceSha256",
			"custodyTimestampTokenSha256",
		].every((key) => SHA256.test(item[key] as string))
	);
}

export function isPublicEvidenceV10TrustPolicy(
	value: unknown,
): value is PublicEvidenceV10TrustPolicy {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const item = value as Record<string, unknown>;
	return (
		Object.keys(item).length === 2 &&
		"core" in item &&
		"custodyTimestamp" in item &&
		isPublicEvidenceTrustPolicy(item.core) &&
		isRfc3161TimestampTrustPolicy(item.custodyTimestamp)
	);
}

function escapesRoot(root: string, candidate: string): boolean {
	const path = relative(root, candidate);
	return (
		path === ".." ||
		path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
		isAbsolute(path)
	);
}

async function readBound(
	root: string,
	path: string,
	expectedSha256: string,
): Promise<Buffer> {
	if (isAbsolute(path))
		throw new Error("v10 evidence path escapes evidence root");
	const candidate = resolve(root, path);
	if (escapesRoot(root, candidate))
		throw new Error("v10 evidence path escapes evidence root");
	const canonical = await realpath(candidate);
	if (escapesRoot(root, canonical))
		throw new Error("v10 evidence path escapes evidence root");
	const bytes = await readBoundedEvidenceFile(canonical, MAX_FILE_BYTES);
	if (createHash("sha256").update(bytes).digest("hex") !== expectedSha256)
		throw new Error("v10 evidence content hash mismatch");
	return bytes;
}

export async function evaluatePublicEvidenceV10(input: {
	envelope: unknown;
	evidenceRoot: string;
	trustPolicy: PublicEvidenceV10TrustPolicy;
	commandRunner?: Rfc3161CommandRunner;
	trustedCaBytes?: Buffer;
}): Promise<PublicEvidenceDecision> {
	try {
		if (!isPublicEvidenceV10Envelope(input.envelope))
			throw new Error("v10 promotion envelope shape is invalid");
		if (!isPublicEvidenceV10TrustPolicy(input.trustPolicy))
			throw new Error("v10 verifier trust policy shape is invalid");
		const envelope = input.envelope;
		if (
			!hasValidEvidenceSignature(
				envelope,
				input.trustPolicy.core.publisherPublicKeys[envelope.publisher],
			)
		)
			throw new Error(
				"v10 promotion envelope signature is untrusted or invalid",
			);
		const root = await realpath(resolve(input.evidenceRoot));
		const [
			coreBytes,
			datasetBytes,
			sealBytes,
			timestampEvidenceBytes,
			tokenBytes,
		] = await Promise.all([
			readBound(root, envelope.coreManifestPath, envelope.coreManifestSha256),
			readBound(root, envelope.datasetPath, envelope.datasetSha256),
			readBound(root, envelope.custodySealPath, envelope.custodySealSha256),
			readBound(
				root,
				envelope.custodyTimestampEvidencePath,
				envelope.custodyTimestampEvidenceSha256,
			),
			readBound(
				root,
				envelope.custodyTimestampTokenPath,
				envelope.custodyTimestampTokenSha256,
			),
		]);
		const core: unknown = JSON.parse(coreBytes.toString("utf8"));
		const seal: unknown = JSON.parse(sealBytes.toString("utf8"));
		const timestampEvidence: unknown = JSON.parse(
			timestampEvidenceBytes.toString("utf8"),
		);
		if (!isPublicEvidenceManifest(core))
			throw new Error("v10 core manifest is invalid");
		if (
			core.publisher !== envelope.publisher ||
			core.dataset.path !== envelope.datasetPath ||
			core.dataset.sha256 !== envelope.datasetSha256
		)
			throw new Error("v10 core manifest binding mismatch");
		const coreDecision = await evaluatePublicEvidenceFiles(
			core as PublicEvidenceManifest,
			root,
			input.trustPolicy.core,
		);
		if (!coreDecision.promotable) return coreDecision;
		const challengeIssuedAt = Math.min(
			...(await Promise.all(
				core.engines
					.filter((engine) => engine.executed)
					.map(async (engine) => {
						const bytes = await readBound(
							root,
							engine.challengePath,
							engine.challengeSha256,
						);
						const challenge = JSON.parse(bytes.toString("utf8")) as {
							issuedAt?: unknown;
						};
						if (typeof challenge.issuedAt !== "string")
							throw new Error("v10 challenge issuance timestamp is invalid");
						const issuedAt = Date.parse(challenge.issuedAt);
						if (
							!Number.isFinite(issuedAt) ||
							new Date(issuedAt).toISOString() !== challenge.issuedAt
						)
							throw new Error(
								"v10 challenge issuance timestamp is not canonical UTC",
							);
						return issuedAt;
					}),
			)),
		);
		if (!Number.isFinite(challengeIssuedAt))
			throw new Error("v10 signed execution challenge is missing");
		if (
			!isPublicDatasetCustodySeal(seal) ||
			!isRfc3161DigestTimestampEvidence(timestampEvidence)
		)
			throw new Error("v10 custody evidence shape is invalid");
		verifyPublicDatasetCustodySeal({
			seal,
			expectedDatasetSha256: createHash("sha256")
				.update(datasetBytes)
				.digest("hex"),
			custodianPublicKey:
				input.trustPolicy.core.datasetCustodianPublicKeys[
					core.dataset.custodianId
				] ?? "",
			timestampEvidence,
			timestampTrustPolicy: input.trustPolicy.custodyTimestamp,
			challengeIssuedAt: new Date(challengeIssuedAt).toISOString(),
			commandRunner: input.commandRunner,
			tokenBytes,
			trustedCaBytes: input.trustedCaBytes,
		});
		return coreDecision;
	} catch (error) {
		const message =
			error instanceof PublicEvidenceFileTooLargeError
				? "v10 evidence exceeds the 16 MiB limit"
				: error instanceof Error
					? error.message
					: "v10 evidence verification failed";
		return { promotable: false, failures: [message] };
	}
}
