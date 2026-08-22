import {
	MIRACL_FULL_BENCHMARK,
	sha256Bytes,
} from "./native-full-corpus-evidence.js";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import {
	type ExecutionBinding,
	type PublicExecutionAttestation,
	type PublicExecutionChallenge,
	evaluateExecutionAttestation,
} from "./public-execution-attestation.js";
import {
	type Rfc3161CommandRunner,
	type Rfc3161DigestTimestampEvidence,
	type Rfc3161TimestampTrustPolicy,
	rfc3161TrustPolicyIdentity,
	validateRfc3161DigestTimestampBinding,
} from "./rfc3161-timestamp.js";

const SHA256 = /^[a-f0-9]{64}$/;

type BindingManifests = {
	dataset: unknown;
	protocol: unknown;
	implementation: unknown;
	configuration: unknown;
	executionEvidence: unknown;
};

type BindingHashes = Omit<ExecutionBinding, "engine" | "receiptSha256">;

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function deriveFullCorpusExecutionBinding(
	receiptText: string,
): ExecutionBinding {
	let parsed: unknown;
	try {
		parsed = JSON.parse(receiptText);
	} catch {
		throw new Error("full-corpus receipt is not valid JSON");
	}
	const receipt = record(parsed);
	const attestationBinding = record(receipt?.attestationBinding);
	const manifests = record(attestationBinding?.manifests) as
		| BindingManifests
		| undefined;
	const hashes = record(attestationBinding?.hashes) as
		| BindingHashes
		| undefined;
	if (
		receipt?.schemaVersion !== 3 ||
		receipt.verdict !== "LOCAL_PASS" ||
		receipt.assurance !== "self-observed-local" ||
		receipt.publicClaimEligible !== false ||
		receipt.benchmark !== MIRACL_FULL_BENCHMARK ||
		!manifests ||
		!hashes
	)
		throw new Error("full-corpus receipt is not an eligible LOCAL_PASS base");

	const definitions = [
		["datasetSha256", manifests.dataset],
		["protocolSha256", manifests.protocol],
		["implementationArtifactSha256", manifests.implementation],
		["configurationSha256", manifests.configuration],
		["executionEvidenceSha256", manifests.executionEvidence],
	] as const;
	for (const [field, manifest] of definitions) {
		if (
			typeof hashes[field] !== "string" ||
			!SHA256.test(hashes[field]) ||
			hashes[field] !== evidenceObjectSha256(manifest)
		)
			throw new Error(`full-corpus ${field} manifest mismatch`);
	}

	return {
		engine: MIRACL_FULL_BENCHMARK,
		datasetSha256: hashes.datasetSha256,
		protocolSha256: hashes.protocolSha256,
		receiptSha256: sha256Bytes(receiptText),
		implementationArtifactSha256: hashes.implementationArtifactSha256,
		configurationSha256: hashes.configurationSha256,
		executionEvidenceSha256: hashes.executionEvidenceSha256,
	};
}

export function evaluateFullCorpusPublicAttestation(input: {
	receiptPath: string;
	receiptText: string;
	challenge: PublicExecutionChallenge;
	attestation: PublicExecutionAttestation;
	challengeIssuerKeys: Record<string, string>;
	runnerKeys: Record<string, string>;
	benchmarkOperatorTrustDomain: string;
	runnerTrustDomains: Record<string, string>;
}) {
	const binding = deriveFullCorpusExecutionBinding(input.receiptText);
	const failures = evaluateExecutionAttestation(
		input.challenge,
		input.attestation,
		binding,
		input.challengeIssuerKeys,
		input.runnerKeys,
		input.benchmarkOperatorTrustDomain,
		input.runnerTrustDomains,
	);
	const receipt = record(JSON.parse(input.receiptText));
	const runtime = record(receipt?.runtime);
	const launch = record(runtime?.launchReceipt);
	const observationContainer = record(runtime?.observation);
	const observation = record(observationContainer?.observation);
	const launchCapturedAt = launch?.capturedAt;
	const observationCompletedAt = observation?.completedAt;
	const issuedAt = Date.parse(input.challenge.issuedAt);
	const expiresAt = Date.parse(input.challenge.expiresAt);
	const receiptStartedAt = Date.parse(
		typeof launchCapturedAt === "string" ? launchCapturedAt : "",
	);
	const receiptFinishedAt = Date.parse(
		typeof observationCompletedAt === "string" ? observationCompletedAt : "",
	);
	if (!Number.isFinite(receiptStartedAt) || !Number.isFinite(receiptFinishedAt))
		failures.push(
			`${binding.engine}: execution receipt timestamps are invalid`,
		);
	else {
		if (receiptStartedAt < issuedAt || receiptStartedAt > expiresAt)
			failures.push(
				`${binding.engine}: execution receipt launch is outside the challenge window`,
			);
		if (receiptFinishedAt < receiptStartedAt || receiptFinishedAt > expiresAt)
			failures.push(
				`${binding.engine}: execution receipt completion is outside the challenge window`,
			);
		if (input.attestation.startedAt !== launchCapturedAt)
			failures.push(
				`${binding.engine}: execution startedAt does not match the receipt launch`,
			);
		if (input.attestation.finishedAt !== observationCompletedAt)
			failures.push(
				`${binding.engine}: execution finishedAt does not match the receipt completion`,
			);
	}
	return {
		schemaVersion: 1,
		assuranceModel: "trusted-runner-signature",
		publicationGateEligible: false,
		verdict: failures.length === 0 ? "PUBLIC_ATTESTATION_PASS" : "FAIL",
		publicClaimEligible: failures.length === 0,
		baseReceipt: {
			path: input.receiptPath,
			sha256: binding.receiptSha256,
			verdict: "LOCAL_PASS",
			assurance: "self-observed-local",
		},
		binding,
		failures,
	};
}

export function evaluateTimestampQualifiedFullCorpusPublicAttestation(input: {
	receiptPath: string;
	receiptText: string;
	challenge: PublicExecutionChallenge;
	attestation: PublicExecutionAttestation;
	challengeIssuerKeys: Record<string, string>;
	runnerKeys: Record<string, string>;
	benchmarkOperatorTrustDomain: string;
	runnerTrustDomains: Record<string, string>;
	challengeTimestampEvidence: Rfc3161DigestTimestampEvidence;
	challengeTimestampTrustPolicy: Rfc3161TimestampTrustPolicy;
	attestationTimestampEvidence: Rfc3161DigestTimestampEvidence;
	attestationTimestampTrustPolicy: Rfc3161TimestampTrustPolicy;
	timestampCommandRunner?: Rfc3161CommandRunner;
}) {
	const base = evaluateFullCorpusPublicAttestation(input);
	const failures = [...base.failures];
	let challengeTimestampedAt: string | undefined;
	let attestationTimestampedAt: string | undefined;
	try {
		challengeTimestampedAt = validateRfc3161DigestTimestampBinding({
			expectedArtifactSha256: evidenceObjectSha256(input.challenge),
			evidence: input.challengeTimestampEvidence,
			trustPolicy: input.challengeTimestampTrustPolicy,
			commandRunner: input.timestampCommandRunner,
		}).timestampedAt;
		attestationTimestampedAt = validateRfc3161DigestTimestampBinding({
			expectedArtifactSha256: evidenceObjectSha256(input.attestation),
			evidence: input.attestationTimestampEvidence,
			trustPolicy: input.attestationTimestampTrustPolicy,
			commandRunner: input.timestampCommandRunner,
		}).timestampedAt;
	} catch (error) {
		failures.push(
			`${base.binding.engine}: ${error instanceof Error ? error.message : "RFC 3161 timestamp verification failed"}`,
		);
	}
	if (challengeTimestampedAt && attestationTimestampedAt) {
		const issuedAt = Date.parse(input.challenge.issuedAt);
		const startedAt = Date.parse(input.attestation.startedAt);
		const finishedAt = Date.parse(input.attestation.finishedAt);
		const challengeTime = Date.parse(challengeTimestampedAt);
		const attestationTime = Date.parse(attestationTimestampedAt);
		if (challengeTime < issuedAt)
			failures.push(
				`${base.binding.engine}: challenge timestamp predates signed issuance`,
			);
		if (challengeTime + 1000 > startedAt)
			failures.push(
				`${base.binding.engine}: challenge was not timestamped before execution`,
			);
		if (attestationTime < finishedAt)
			failures.push(
				`${base.binding.engine}: attestation timestamp predates execution completion`,
			);
		if (attestationTime < challengeTime)
			failures.push(
				`${base.binding.engine}: attestation timestamp predates challenge timestamp`,
			);
	}
	return {
		...base,
		schemaVersion: 2,
		assuranceModel: "trusted-runner-signature-with-rfc3161-chronology",
		publicationGateEligible: failures.length === 0,
		verdict:
			failures.length === 0
				? "TIMESTAMP_QUALIFIED_PUBLIC_ATTESTATION_PASS"
				: "FAIL",
		publicClaimEligible: failures.length === 0,
		timestampQualification: {
			challengeArtifactSha256: evidenceObjectSha256(input.challenge),
			attestationArtifactSha256: evidenceObjectSha256(input.attestation),
			challengeTimestampTokenSha256:
				input.challengeTimestampEvidence.tokenSha256,
			attestationTimestampTokenSha256:
				input.attestationTimestampEvidence.tokenSha256,
			challengeTrustPolicySha256: evidenceObjectSha256(
				rfc3161TrustPolicyIdentity(input.challengeTimestampTrustPolicy),
			),
			attestationTrustPolicySha256: evidenceObjectSha256(
				rfc3161TrustPolicyIdentity(input.attestationTimestampTrustPolicy),
			),
			challengeTimestampedAt,
			attestationTimestampedAt,
		},
		failures,
	};
}
