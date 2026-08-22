import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	FULL_CORPUS_ATTESTATION_ARTIFACT_NAMES,
	FULL_CORPUS_ATTESTATION_JSON_ARTIFACT_NAMES,
	loadFullCorpusAttestationBundle,
} from "./native-full-corpus-attestation-bundle.js";
import { buildFullCorpusChallengeSigningPacket } from "./native-full-corpus-attestation-packet.js";
import {
	evaluateFullCorpusPublicAttestation,
	evaluateTimestampQualifiedFullCorpusPublicAttestation,
} from "./native-full-corpus-public-attestation.js";
import {
	PublicEvidenceFileTooLargeError,
	readBoundedEvidenceFile,
} from "./public-evidence-file-io.js";
import {
	isExecutionAttestation,
	isExecutionChallenge,
} from "./public-execution-attestation.js";
import {
	isRfc3161DigestTimestampEvidence,
	isRfc3161TimestampTrustPolicy,
} from "./rfc3161-timestamp.js";
import type { Rfc3161CommandRunner } from "./rfc3161-timestamp.js";

const MAX_BYTES = 16 * 1024 * 1024;

async function bounded(path: string, label: string): Promise<Buffer> {
	try {
		return await readBoundedEvidenceFile(resolve(path), MAX_BYTES);
	} catch (error) {
		if (error instanceof PublicEvidenceFileTooLargeError)
			throw new Error(`${label} exceeds the 16 MiB intake limit`);
		throw new Error(`${label} is unreadable`);
	}
}

async function json(path: string, label: string): Promise<unknown> {
	const bytes = await bounded(path, label);
	try {
		return JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new Error(`${label} is not valid JSON`);
	}
}

function failure(error: unknown): number {
	process.stdout.write(
		`${JSON.stringify({ failure: error instanceof Error ? error.message : "full-corpus attestation command failed" })}\n`,
	);
	return 1;
}

function stringMap(value: unknown): value is Record<string, string> {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.values(value).every((item) => typeof item === "string")
	);
}

export async function runFullCorpusAttestationCli(
	args: string[],
	dependencies: { timestampCommandRunner?: Rfc3161CommandRunner } = {},
): Promise<number> {
	let [command, ...values] = args;
	let verificationBundle:
		| Awaited<ReturnType<typeof loadFullCorpusAttestationBundle>>
		| undefined;
	try {
		if (command === "verify-bundle") {
			if (values.length !== 1) {
				process.stderr.write(
					"Usage: pnpm benchmark:miracl-full-corpus-attestation verify-bundle <bundle.json>\n",
				);
				return 2;
			}
			verificationBundle = await loadFullCorpusAttestationBundle(
				values[0] as string,
			);
			command = "verify-timestamped";
			values = FULL_CORPUS_ATTESTATION_JSON_ARTIFACT_NAMES.map((name) => {
				const artifact = verificationBundle?.artifacts.find(
					(candidate) => candidate.name === name,
				);
				if (!artifact)
					throw new Error(
						`full-corpus attestation artifact ${name} is missing after bundle validation`,
					);
				return artifact.path;
			});
		}
		if (command === "challenge") {
			if (values.length !== 6) {
				process.stderr.write(
					"Usage: pnpm benchmark:miracl-full-corpus-attestation challenge <receipt.json> <issuer> <challenge-id> <nonce> <issued-at-iso> <expires-at-iso>\n",
				);
				return 2;
			}
			const [receiptPath, issuer, challengeId, nonce, issuedAt, expiresAt] =
				values as [string, string, string, string, string, string];
			const receiptText = (await bounded(receiptPath, "receipt")).toString(
				"utf8",
			);
			process.stdout.write(
				`${JSON.stringify(buildFullCorpusChallengeSigningPacket({ receiptText, issuer, challengeId, nonce, issuedAt, expiresAt }))}\n`,
			);
			return 0;
		}
		if (command === "verify") {
			if (values.length !== 4) {
				process.stderr.write(
					"Usage: pnpm benchmark:miracl-full-corpus-attestation verify <receipt.json> <challenge.json> <attestation.json> <trust-policy.json>\n",
				);
				return 2;
			}
			const [receiptPath, challengePath, attestationPath, trustPath] =
				values as [string, string, string, string];
			const [receiptBytes, challenge, attestation, trust] = await Promise.all([
				bounded(receiptPath, "receipt"),
				json(challengePath, "challenge"),
				json(attestationPath, "attestation"),
				json(trustPath, "trust policy"),
			]);
			if (trust === null || typeof trust !== "object" || Array.isArray(trust))
				throw new Error("trust policy root must be an object");
			const policy = trust as Record<string, unknown>;
			if (!isExecutionChallenge(challenge))
				throw new Error("challenge shape is invalid");
			if (!isExecutionAttestation(attestation))
				throw new Error("attestation shape is invalid");
			if (
				!stringMap(policy.challengeIssuerKeys) ||
				!stringMap(policy.runnerKeys) ||
				typeof policy.benchmarkOperatorTrustDomain !== "string" ||
				!stringMap(policy.runnerTrustDomains)
			)
				throw new Error("trust policy shape is invalid");
			const verdict = evaluateFullCorpusPublicAttestation({
				receiptPath,
				receiptText: receiptBytes.toString("utf8"),
				challenge,
				attestation,
				challengeIssuerKeys: policy.challengeIssuerKeys,
				runnerKeys: policy.runnerKeys,
				benchmarkOperatorTrustDomain:
					policy.benchmarkOperatorTrustDomain as string,
				runnerTrustDomains: policy.runnerTrustDomains,
			});
			process.stdout.write(`${JSON.stringify(verdict)}\n`);
			return verdict.publicClaimEligible ? 0 : 1;
		}
		if (command === "verify-timestamped") {
			if (values.length !== 8) {
				process.stderr.write(
					"Usage: pnpm benchmark:miracl-full-corpus-attestation verify-timestamped <receipt.json> <challenge.json> <attestation.json> <trust-policy.json> <challenge-timestamp.json> <challenge-timestamp-trust.json> <attestation-timestamp.json> <attestation-timestamp-trust.json>\n",
				);
				return 2;
			}
			const [
				receiptPath,
				challengePath,
				attestationPath,
				trustPath,
				challengeTimestampPath,
				challengeTimestampTrustPath,
				attestationTimestampPath,
				attestationTimestampTrustPath,
			] = values as [
				string,
				string,
				string,
				string,
				string,
				string,
				string,
				string,
			];
			const [
				receiptBytes,
				challenge,
				attestation,
				trust,
				challengeTimestampEvidence,
				challengeTimestampTrustPolicy,
				attestationTimestampEvidence,
				attestationTimestampTrustPolicy,
			] = verificationBundle
				? FULL_CORPUS_ATTESTATION_JSON_ARTIFACT_NAMES.map((name) => {
						const artifact = verificationBundle.artifacts.find(
							(candidate) => candidate.name === name,
						);
						if (!artifact)
							throw new Error(
								`full-corpus attestation artifact ${name} is missing after bundle validation`,
							);
						return name === "receipt"
							? artifact.bytes
							: JSON.parse(artifact.bytes.toString("utf8"));
					})
				: await Promise.all([
						bounded(receiptPath, "receipt"),
						json(challengePath, "challenge"),
						json(attestationPath, "attestation"),
						json(trustPath, "trust policy"),
						json(challengeTimestampPath, "challenge timestamp evidence"),
						json(
							challengeTimestampTrustPath,
							"challenge timestamp trust policy",
						),
						json(attestationTimestampPath, "attestation timestamp evidence"),
						json(
							attestationTimestampTrustPath,
							"attestation timestamp trust policy",
						),
					]);
			if (trust === null || typeof trust !== "object" || Array.isArray(trust))
				throw new Error("trust policy root must be an object");
			const policy = trust as Record<string, unknown>;
			if (!isExecutionChallenge(challenge))
				throw new Error("challenge shape is invalid");
			if (!isExecutionAttestation(attestation))
				throw new Error("attestation shape is invalid");
			if (
				!stringMap(policy.challengeIssuerKeys) ||
				!stringMap(policy.runnerKeys) ||
				typeof policy.benchmarkOperatorTrustDomain !== "string" ||
				!stringMap(policy.runnerTrustDomains)
			)
				throw new Error("trust policy shape is invalid");
			if (!isRfc3161DigestTimestampEvidence(challengeTimestampEvidence))
				throw new Error("challenge timestamp evidence shape is invalid");
			if (!isRfc3161TimestampTrustPolicy(challengeTimestampTrustPolicy))
				throw new Error("challenge timestamp trust policy shape is invalid");
			if (!isRfc3161DigestTimestampEvidence(attestationTimestampEvidence))
				throw new Error("attestation timestamp evidence shape is invalid");
			if (!isRfc3161TimestampTrustPolicy(attestationTimestampTrustPolicy))
				throw new Error("attestation timestamp trust policy shape is invalid");
			const verdict = evaluateTimestampQualifiedFullCorpusPublicAttestation({
				receiptPath,
				receiptText: receiptBytes.toString("utf8"),
				challenge,
				attestation,
				challengeIssuerKeys: policy.challengeIssuerKeys,
				runnerKeys: policy.runnerKeys,
				benchmarkOperatorTrustDomain: policy.benchmarkOperatorTrustDomain,
				runnerTrustDomains: policy.runnerTrustDomains,
				challengeTimestampEvidence,
				challengeTimestampTrustPolicy,
				attestationTimestampEvidence,
				attestationTimestampTrustPolicy,
				timestampCommandRunner: dependencies.timestampCommandRunner,
				challengeTimestampTokenBytes: verificationBundle?.artifacts.find(
					(artifact) => artifact.name === "challengeTimestampToken",
				)?.bytes,
				challengeTimestampTrustedCaBytes: verificationBundle?.artifacts.find(
					(artifact) => artifact.name === "challengeTimestampTrustedCa",
				)?.bytes,
				attestationTimestampTokenBytes: verificationBundle?.artifacts.find(
					(artifact) => artifact.name === "attestationTimestampToken",
				)?.bytes,
				attestationTimestampTrustedCaBytes: verificationBundle?.artifacts.find(
					(artifact) => artifact.name === "attestationTimestampTrustedCa",
				)?.bytes,
			});
			process.stdout.write(
				`${JSON.stringify(
					verificationBundle
						? {
								...verdict,
								verificationBundle: {
									schemaVersion: verificationBundle.manifest.schemaVersion,
									manifestSha256: verificationBundle.manifestSha256,
									artifactSha256: Object.fromEntries(
										verificationBundle.artifacts.map((artifact) => [
											artifact.name,
											artifact.sha256,
										]),
									),
								},
							}
						: verdict,
				)}\n`,
			);
			return verdict.publicClaimEligible ? 0 : 1;
		}
		process.stderr.write(
			"Usage: pnpm benchmark:miracl-full-corpus-attestation <challenge|verify|verify-timestamped|verify-bundle> ...\n",
		);
		return 2;
	} catch (error) {
		return failure(error);
	}
}

const invokedPath =
	process.argv[1] && pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url)
	process.exitCode = await runFullCorpusAttestationCli(process.argv.slice(2));
