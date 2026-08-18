import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	evidenceSignaturePayload,
	hasValidEvidenceSignature,
} from "./public-evidence-crypto.js";
import {
	type PublicExecutionAttestation,
	type PublicExecutionChallenge,
	evaluateExecutionAttestation,
	evaluateExecutionAttestations,
} from "./public-execution-attestation.js";

const digest = (character: string) => character.repeat(64);
const issuerKeys = generateKeyPairSync("ed25519");
const runnerKeys = generateKeyPairSync("ed25519");
const issuer = "independent-challenge-service";
const runner = "independent-runner";
const trust = {
	issuers: {
		[issuer]: issuerKeys.publicKey
			.export({ type: "spki", format: "pem" })
			.toString(),
	},
	runners: {
		[runner]: runnerKeys.publicKey
			.export({ type: "spki", format: "pem" })
			.toString(),
	},
};
const binding = {
	engine: "naia",
	datasetSha256: digest("a"),
	protocolSha256: digest("b"),
	receiptSha256: digest("c"),
	implementationArtifactSha256: digest("d"),
	configurationSha256: digest("e"),
	executionEvidenceSha256: digest("f"),
};

function signed<T extends Record<string, unknown>>(
	value: T,
	privateKey: typeof issuerKeys.privateKey,
) {
	return {
		...value,
		signatureBase64: sign(
			null,
			evidenceSignaturePayload(value),
			privateKey,
		).toString("base64"),
	};
}

function evidence() {
	const challenge = signed(
		{
			schemaVersion: "naia-memory-public-execution-challenge-v1" as const,
			issuer,
			challengeId: "challenge-naia",
			nonce: "0123456789abcdef0123456789abcdef",
			engine: binding.engine,
			datasetSha256: binding.datasetSha256,
			protocolSha256: binding.protocolSha256,
			issuedAt: "2026-08-18T00:00:00.000Z",
			expiresAt: "2026-08-18T01:00:00.000Z",
		},
		issuerKeys.privateKey,
	);
	const attestation = signed(
		{
			schemaVersion: "naia-memory-public-execution-attestation-v1" as const,
			runner,
			challengeId: challenge.challengeId,
			nonce: challenge.nonce,
			...binding,
			startedAt: "2026-08-18T00:10:00.000Z",
			finishedAt: "2026-08-18T00:20:00.000Z",
		},
		runnerKeys.privateKey,
	);
	return { challenge, attestation };
}

describe("public execution attestation", () => {
	it("accepts only canonical Ed25519 evidence signatures", () => {
		const value = signed({ evidence: "bound" }, issuerKeys.privateKey);
		expect(hasValidEvidenceSignature(value, trust.issuers[issuer])).toBe(true);
		const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 });
		const rsaValue = {
			...value,
			signatureBase64: sign(
				"sha256",
				evidenceSignaturePayload(value),
				rsa.privateKey,
			).toString("base64"),
		};
		expect(
			hasValidEvidenceSignature(
				rsaValue,
				rsa.publicKey.export({ type: "spki", format: "pem" }).toString(),
			),
		).toBe(false);
	});

	it("accepts a verifier challenge bound by an independent runner", () => {
		const { challenge, attestation } = evidence();
		expect(
			evaluateExecutionAttestation(
				challenge,
				attestation,
				binding,
				trust.issuers,
				trust.runners,
			),
		).toEqual([]);
	});

	it("rejects receipt substitution and a forged runner signature", () => {
		const { challenge, attestation } = evidence();
		const forged = { ...attestation, receiptSha256: digest("0") };
		expect(
			evaluateExecutionAttestation(
				challenge,
				forged,
				binding,
				trust.issuers,
				trust.runners,
			),
		).toEqual(
			expect.arrayContaining([
				"naia: execution receiptSha256 mismatch",
				"naia: execution attestation signature is untrusted or invalid",
			]),
		);
	});

	it("rejects replayed challenge identities and nonces", () => {
		const { challenge, attestation } = evidence();
		const secondBinding = { ...binding, engine: "competitor" };
		expect(
			evaluateExecutionAttestations(
				[binding, secondBinding],
				new Map([
					[binding.engine, challenge],
					[secondBinding.engine, challenge],
				]),
				new Map([
					[binding.engine, attestation],
					[secondBinding.engine, attestation],
				]),
				trust.issuers,
				trust.runners,
			),
		).toEqual(
			expect.arrayContaining([
				"execution challenge identities are replayed",
				"execution challenge nonces are replayed",
			]),
		);
	});

	it("fails closed for missing or malformed challenge bodies", () => {
		const { attestation } = evidence();
		for (const malformed of [null, 0, "", {}, []]) {
			expect(
				evaluateExecutionAttestations(
					[binding],
					new Map([[binding.engine, malformed]]),
					new Map([[binding.engine, attestation]]),
					trust.issuers,
					trust.runners,
				),
			).not.toEqual([]);
		}
	});
});
