import {
	evidenceSignaturePayload,
	hasValidEvidenceSignature,
} from "./public-evidence-crypto.js";
import {
	PUBLIC_EVIDENCE_SHA256 as SHA256,
	isCanonicalTrustDomain,
	isPublicEvidenceRecord,
} from "./public-evidence-types.js";

export type PublicExecutionChallenge = {
	schemaVersion: "naia-memory-public-execution-challenge-v1";
	issuer: string;
	challengeId: string;
	nonce: string;
	engine: string;
	datasetSha256: string;
	protocolSha256: string;
	issuedAt: string;
	expiresAt: string;
	signatureBase64: string;
};

export type PublicExecutionAttestation = {
	schemaVersion: "naia-memory-public-execution-attestation-v1";
	runner: string;
	challengeId: string;
	nonce: string;
	engine: string;
	datasetSha256: string;
	protocolSha256: string;
	receiptSha256: string;
	implementationArtifactSha256: string;
	configurationSha256: string;
	executionEvidenceSha256: string;
	startedAt: string;
	finishedAt: string;
	signatureBase64: string;
};

export type ExecutionBinding = {
	engine: string;
	datasetSha256: string;
	protocolSha256: string;
	receiptSha256: string;
	implementationArtifactSha256: string;
	configurationSha256: string;
	executionEvidenceSha256: string;
};

export type ExecutionEvidenceReference = {
	challengePath: string;
	challengeSha256: string;
	attestationPath: string;
	attestationSha256: string;
	executionEvidencePath: string;
	executionEvidenceSha256: string;
};

type ExecutionEvidenceFile = {
	kind: "execution-evidence";
	label: string;
	path: string;
	sha256: string;
};

type ExecutionAttestationFile = Omit<ExecutionEvidenceFile, "kind"> & {
	kind: "challenge" | "attestation";
	engine: ExecutionEvidenceReference & { engine: string };
};

export function validateExecutionEvidenceReference(
	prefix: string,
	reference: ExecutionEvidenceReference,
): string[] {
	const failures: string[] = [];
	for (const [label, path, digest] of [
		["challenge", reference.challengePath, reference.challengeSha256],
		["attestation", reference.attestationPath, reference.attestationSha256],
		[
			"execution evidence",
			reference.executionEvidencePath,
			reference.executionEvidenceSha256,
		],
	] as const) {
		if (!path.trim()) failures.push(`${prefix} ${label} path is missing`);
		if (!SHA256.test(digest))
			failures.push(`${prefix} ${label} SHA-256 is invalid`);
	}
	return failures;
}

export function executionEvidenceFiles(
	engine: ExecutionEvidenceReference & { engine: string },
): Array<ExecutionEvidenceFile | ExecutionAttestationFile> {
	return [
		{
			kind: "execution-evidence" as const,
			label: `${engine.engine}: execution evidence`,
			path: engine.executionEvidencePath,
			sha256: engine.executionEvidenceSha256,
		},
		{
			kind: "challenge" as const,
			label: `${engine.engine}: execution challenge`,
			path: engine.challengePath,
			sha256: engine.challengeSha256,
			engine,
		},
		{
			kind: "attestation" as const,
			label: `${engine.engine}: execution attestation`,
			path: engine.attestationPath,
			sha256: engine.attestationSha256,
			engine,
		},
	];
}

export function evaluateExecutionAttestations(
	bindings: ExecutionBinding[],
	challenges: Map<string, unknown>,
	attestations: Map<string, unknown>,
	challengeIssuerKeys: Record<string, string>,
	runnerKeys: Record<string, string>,
	benchmarkOperatorTrustDomain: string,
	runnerTrustDomains: Record<string, string>,
): string[] {
	// Replay uniqueness is scoped to one immutable evidence bundle. A verifier may
	// re-check that same bundle later; challenge expiry limits execution time, not
	// the lifetime of already signed evidence.
	const failures: string[] = [];
	const challengeIds = new Set<string>();
	const nonces = new Set<string>();
	for (const binding of bindings) {
		const challenge = challenges.get(binding.engine);
		const attestation = attestations.get(binding.engine);
		if (
			!isPublicEvidenceRecord(challenge) ||
			!isPublicEvidenceRecord(attestation)
		) {
			failures.push(
				`${binding.engine}: execution attestation is missing or invalid`,
			);
			continue;
		}
		if (
			!isExecutionChallenge(challenge) ||
			!isExecutionAttestation(attestation)
		) {
			failures.push(
				`${binding.engine}: execution attestation shape is invalid`,
			);
			continue;
		}
		if (challengeIds.has(challenge.challengeId))
			failures.push("execution challenge identities are replayed");
		if (nonces.has(challenge.nonce))
			failures.push("execution challenge nonces are replayed");
		challengeIds.add(challenge.challengeId);
		nonces.add(challenge.nonce);
		failures.push(
			...evaluateExecutionAttestation(
				challenge,
				attestation,
				binding,
				challengeIssuerKeys,
				runnerKeys,
				benchmarkOperatorTrustDomain,
				runnerTrustDomains,
			),
		);
	}
	return failures;
}

function hasStringFields(
	value: Record<string, unknown>,
	fields: readonly string[],
): boolean {
	return fields.every((field) => typeof value[field] === "string");
}

function isExecutionChallenge(
	value: Record<string, unknown>,
): value is PublicExecutionChallenge {
	return hasStringFields(value, [
		"schemaVersion",
		"issuer",
		"challengeId",
		"nonce",
		"engine",
		"datasetSha256",
		"protocolSha256",
		"issuedAt",
		"expiresAt",
		"signatureBase64",
	]);
}

function isExecutionAttestation(
	value: Record<string, unknown>,
): value is PublicExecutionAttestation {
	return hasStringFields(value, [
		"schemaVersion",
		"runner",
		"challengeId",
		"nonce",
		"engine",
		"datasetSha256",
		"protocolSha256",
		"receiptSha256",
		"implementationArtifactSha256",
		"configurationSha256",
		"executionEvidenceSha256",
		"startedAt",
		"finishedAt",
		"signatureBase64",
	]);
}

export function evaluateExecutionAttestation(
	challenge: PublicExecutionChallenge,
	attestation: PublicExecutionAttestation,
	binding: ExecutionBinding,
	challengeIssuerKeys: Record<string, string>,
	runnerKeys: Record<string, string>,
	benchmarkOperatorTrustDomain: string,
	runnerTrustDomains: Record<string, string>,
): string[] {
	const failures: string[] = [];
	const prefix = `${binding.engine}: execution`;
	const reject = (condition: boolean, message: string) => {
		if (condition) failures.push(`${prefix} ${message}`);
	};
	reject(
		challenge.schemaVersion !== "naia-memory-public-execution-challenge-v1",
		"challenge schema version mismatch",
	);
	reject(
		attestation.schemaVersion !== "naia-memory-public-execution-attestation-v1",
		"attestation schema version mismatch",
	);
	reject(!challenge.challengeId.trim(), "challenge identity is missing");
	reject(!/^[A-Za-z0-9_-]{32,}$/.test(challenge.nonce), "nonce is invalid");
	reject(challenge.engine !== binding.engine, "challenge engine mismatch");
	reject(
		challenge.datasetSha256 !== binding.datasetSha256,
		"challenge dataset hash mismatch",
	);
	reject(
		challenge.protocolSha256 !== binding.protocolSha256,
		"challenge protocol hash mismatch",
	);
	reject(
		!hasValidEvidenceSignature(
			challenge,
			challengeIssuerKeys[challenge.issuer],
		),
		"challenge signature is untrusted or invalid",
	);
	reject(attestation.runner === challenge.issuer, "issuer and runner overlap");
	reject(attestation.runner === binding.engine, "engine and runner overlap");
	const runnerTrustDomain = runnerTrustDomains[attestation.runner];
	reject(!runnerTrustDomain, "runner trust domain is missing");
	reject(
		Boolean(runnerTrustDomain) && !isCanonicalTrustDomain(runnerTrustDomain),
		"runner trust domain is not canonical",
	);
	reject(
		!isCanonicalTrustDomain(benchmarkOperatorTrustDomain),
		"benchmark operator trust domain is not canonical",
	);
	reject(
		Boolean(runnerTrustDomain) &&
			runnerTrustDomain === benchmarkOperatorTrustDomain,
		"runner is inside the benchmark operator trust boundary",
	);
	reject(
		attestation.challengeId !== challenge.challengeId,
		"challenge identity mismatch",
	);
	reject(attestation.nonce !== challenge.nonce, "nonce mismatch");
	for (const field of [
		"engine",
		"datasetSha256",
		"protocolSha256",
		"receiptSha256",
		"implementationArtifactSha256",
		"configurationSha256",
		"executionEvidenceSha256",
	] as const)
		reject(attestation[field] !== binding[field], `${field} mismatch`);
	reject(
		![
			binding.datasetSha256,
			binding.protocolSha256,
			binding.receiptSha256,
			binding.implementationArtifactSha256,
			binding.configurationSha256,
			binding.executionEvidenceSha256,
		].every((value) => SHA256.test(value)),
		"binding hash is invalid",
	);
	const issuedAt = Date.parse(challenge.issuedAt);
	const expiresAt = Date.parse(challenge.expiresAt);
	const startedAt = Date.parse(attestation.startedAt);
	const finishedAt = Date.parse(attestation.finishedAt);
	reject(
		![issuedAt, expiresAt, startedAt, finishedAt].every(Number.isFinite),
		"timestamp is invalid",
	);
	reject(startedAt < issuedAt, "started before challenge issuance");
	reject(startedAt > expiresAt, "started after challenge expiry");
	reject(finishedAt < startedAt, "finished before start");
	reject(finishedAt > expiresAt, "finished after challenge expiry");
	reject(
		!hasValidEvidenceSignature(attestation, runnerKeys[attestation.runner]),
		"attestation signature is untrusted or invalid",
	);
	return failures;
}
