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
	return {
		schemaVersion: 1,
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
