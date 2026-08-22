#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	type QueryIdentityEncryptedOracleEnvelope,
	type QueryIdentityOracleReleaseKey,
	createEncryptedQueryIdentityOracle,
	verifyEncryptedQueryIdentityOracleRelease,
} from "./query-identity-encrypted-oracle.js";
import type {
	QueryIdentityEscrowTrustPolicy,
	QueryIdentityOracleRevealReceipt,
} from "./query-identity-escrow-evidence.js";
import {
	type QueryIdentityLaunchReceipt,
	createQueryIdentityLaunchArtifacts,
	scoreEscrowAttestedQueryIdentityRun,
	scorePublicQueryIdentityRun,
	scoreRunnerSignedQueryIdentityRun,
	scoreTimestampedRunnerQueryIdentityRun,
} from "./query-identity-launch.js";
import {
	type QueryIdentityOracle,
	type QueryIdentityPredictionArtifact,
	buildQueryIdentityBlindPacket,
	scoreQueryIdentityArtifact,
} from "./query-identity-oracle.js";
import type {
	QueryIdentityRunnerAcknowledgement,
	QueryIdentityRunnerResultSeal,
	QueryIdentityRunnerTrustPolicy,
} from "./query-identity-runner-evidence.js";
import type {
	Rfc3161DigestTimestampEvidence,
	Rfc3161TimestampTrustPolicy,
} from "./rfc3161-timestamp.js";

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

function writeExclusive(path: string, value: unknown): void {
	const target = resolve(path);
	if (existsSync(target)) throw new Error(`output already exists: ${target}`);
	const temporary = `${target}.${randomUUID()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
	renameSync(temporary, target);
}

function writeLaunchDirectory(
	path: string,
	artifacts: ReturnType<typeof createQueryIdentityLaunchArtifacts>,
	encryptedOracleEnvelope?: QueryIdentityEncryptedOracleEnvelope,
): void {
	const target = resolve(path);
	if (existsSync(target)) throw new Error(`output already exists: ${target}`);
	const temporary = `${target}.${randomUUID()}.tmp`;
	mkdirSync(dirname(target), { recursive: true });
	mkdirSync(temporary, { mode: 0o700 });
	writeFileSync(
		resolve(temporary, "blind-packet.json"),
		`${JSON.stringify(artifacts.blindPacket, null, 2)}\n`,
		{ flag: "wx", mode: 0o600 },
	);
	writeFileSync(
		resolve(temporary, "launch-receipt.json"),
		`${JSON.stringify(artifacts.receipt, null, 2)}\n`,
		{ flag: "wx", mode: 0o600 },
	);
	if (encryptedOracleEnvelope)
		writeFileSync(
			resolve(temporary, "encrypted-oracle-envelope.json"),
			`${JSON.stringify(encryptedOracleEnvelope, null, 2)}\n`,
			{ flag: "wx", mode: 0o600 },
		);
	renameSync(temporary, target);
}

function writeEncryptedOracleDirectory(
	path: string,
	artifacts: ReturnType<typeof createEncryptedQueryIdentityOracle>,
): void {
	const target = resolve(path);
	if (existsSync(target)) throw new Error(`output already exists: ${target}`);
	const temporary = `${target}.${randomUUID()}.tmp`;
	mkdirSync(dirname(target), { recursive: true });
	mkdirSync(temporary, { mode: 0o700 });
	writeFileSync(
		resolve(temporary, "encrypted-oracle-envelope.json"),
		`${JSON.stringify(artifacts.envelope, null, 2)}\n`,
		{ flag: "wx", mode: 0o600 },
	);
	writeFileSync(
		resolve(temporary, "oracle-release-key.json"),
		`${JSON.stringify(artifacts.releaseKey, null, 2)}\n`,
		{ flag: "wx", mode: 0o600 },
	);
	renameSync(temporary, target);
}

export function runQueryIdentityEvidenceCli(args: string[]): void {
	const [command, ...rest] = args;
	if (command === "blind") {
		if (rest.length !== 2)
			throw new Error("usage: blind <oracle.json> <blind-packet.json>");
		writeExclusive(
			rest[1],
			buildQueryIdentityBlindPacket(readJson<QueryIdentityOracle>(rest[0])),
		);
		return;
	}
	if (command === "encrypt-oracle") {
		if (rest.length !== 2)
			throw new Error("usage: encrypt-oracle <oracle.json> <output-directory>");
		const encrypted = createEncryptedQueryIdentityOracle({
			oracle: readJson<QueryIdentityOracle>(rest[0]),
		});
		writeEncryptedOracleDirectory(rest[1], encrypted);
		return;
	}
	if (command === "verify-oracle-release") {
		if (rest.length !== 4)
			throw new Error(
				"usage: verify-oracle-release <envelope.json> <release-key.json> <launch-receipt.json> <oracle.json>",
			);
		const launchReceipt = readJson<QueryIdentityLaunchReceipt>(rest[2]);
		if (!launchReceipt.encryptedOracleEnvelopeSha256)
			throw new Error(
				"launch receipt does not bind an encrypted oracle envelope",
			);
		const verified = verifyEncryptedQueryIdentityOracleRelease({
			envelope: readJson<QueryIdentityEncryptedOracleEnvelope>(rest[0]),
			releaseKey: readJson<QueryIdentityOracleReleaseKey>(rest[1]),
			expectedEnvelopeSha256: launchReceipt.encryptedOracleEnvelopeSha256,
		});
		writeExclusive(rest[3], verified.oracle);
		return;
	}
	if (command === "launch-encrypted") {
		if (rest.length !== 7)
			throw new Error(
				"usage: launch-encrypted <oracle.json> <envelope.json> <timestamp-evidence.json> <trust-policy.json> <engine> <model> <output-directory>",
			);
		const encryptedOracleEnvelope =
			readJson<QueryIdentityEncryptedOracleEnvelope>(rest[1]);
		writeLaunchDirectory(
			rest[6],
			createQueryIdentityLaunchArtifacts({
				oracle: readJson<QueryIdentityOracle>(rest[0]),
				encryptedOracleEnvelope,
				timestampEvidence: readJson<Rfc3161DigestTimestampEvidence>(rest[2]),
				timestampTrustPolicy: readJson<Rfc3161TimestampTrustPolicy>(rest[3]),
				engine: rest[4],
				model: rest[5],
				launchedAt: new Date().toISOString(),
			}),
			encryptedOracleEnvelope,
		);
		return;
	}
	if (command === "score") {
		if (rest.length !== 3)
			throw new Error(
				"usage: score <oracle.json> <predictions.json> <score.json>",
			);
		writeExclusive(
			rest[2],
			scoreQueryIdentityArtifact(
				readJson<QueryIdentityOracle>(rest[0]),
				readJson<QueryIdentityPredictionArtifact>(rest[1]),
			),
		);
		return;
	}
	if (command === "launch") {
		if (rest.length !== 6)
			throw new Error(
				"usage: launch <oracle.json> <timestamp-evidence.json> <trust-policy.json> <engine> <model> <output-directory>",
			);
		writeLaunchDirectory(
			rest[5],
			createQueryIdentityLaunchArtifacts({
				oracle: readJson<QueryIdentityOracle>(rest[0]),
				timestampEvidence: readJson<Rfc3161DigestTimestampEvidence>(rest[1]),
				timestampTrustPolicy: readJson<Rfc3161TimestampTrustPolicy>(rest[2]),
				engine: rest[3],
				model: rest[4],
				launchedAt: new Date().toISOString(),
			}),
		);
		return;
	}
	if (command === "launch-runner") {
		if (rest.length !== 7)
			throw new Error(
				"usage: launch-runner <oracle.json> <timestamp-evidence.json> <timestamp-trust-policy.json> <runner-trust-policy.json> <engine> <model> <output-directory>",
			);
		writeLaunchDirectory(
			rest[6],
			createQueryIdentityLaunchArtifacts({
				oracle: readJson<QueryIdentityOracle>(rest[0]),
				timestampEvidence: readJson<Rfc3161DigestTimestampEvidence>(rest[1]),
				timestampTrustPolicy: readJson<Rfc3161TimestampTrustPolicy>(rest[2]),
				runnerTrustPolicy: readJson<QueryIdentityRunnerTrustPolicy>(rest[3]),
				engine: rest[4],
				model: rest[5],
				launchedAt: new Date().toISOString(),
			}),
		);
		return;
	}
	if (command === "launch-runner-escrow") {
		if (rest.length !== 8)
			throw new Error(
				"usage: launch-runner-escrow <oracle.json> <timestamp-evidence.json> <timestamp-trust-policy.json> <runner-trust-policy.json> <escrow-trust-policy.json> <engine> <model> <output-directory>",
			);
		writeLaunchDirectory(
			rest[7],
			createQueryIdentityLaunchArtifacts({
				oracle: readJson<QueryIdentityOracle>(rest[0]),
				timestampEvidence: readJson<Rfc3161DigestTimestampEvidence>(rest[1]),
				timestampTrustPolicy: readJson<Rfc3161TimestampTrustPolicy>(rest[2]),
				runnerTrustPolicy: readJson<QueryIdentityRunnerTrustPolicy>(rest[3]),
				escrowTrustPolicy: readJson<QueryIdentityEscrowTrustPolicy>(rest[4]),
				engine: rest[5],
				model: rest[6],
				launchedAt: new Date().toISOString(),
			}),
		);
		return;
	}
	if (command === "score-public") {
		if (rest.length !== 6 && rest.length !== 7)
			throw new Error(
				"usage: score-public <oracle.json> <predictions.json> <launch-receipt.json> <timestamp-evidence.json> <trust-policy.json> [encrypted-envelope.json] <score.json>",
			);
		writeExclusive(
			rest.at(-1) as string,
			scorePublicQueryIdentityRun({
				oracle: readJson<QueryIdentityOracle>(rest[0]),
				predictions: readJson<QueryIdentityPredictionArtifact>(rest[1]),
				launchReceipt: readJson<QueryIdentityLaunchReceipt>(rest[2]),
				timestampEvidence: readJson<Rfc3161DigestTimestampEvidence>(rest[3]),
				timestampTrustPolicy: readJson<Rfc3161TimestampTrustPolicy>(rest[4]),
				...(rest.length === 7
					? {
							encryptedOracleEnvelope:
								readJson<QueryIdentityEncryptedOracleEnvelope>(rest[5]),
						}
					: {}),
			}),
		);
		return;
	}
	if (command === "score-runner-signed") {
		if (rest.length !== 9 && rest.length !== 10)
			throw new Error(
				"usage: score-runner-signed <oracle.json> <predictions.json> <launch-receipt.json> <timestamp-evidence.json> <timestamp-trust-policy.json> <runner-acknowledgement.json> <runner-result-seal.json> <runner-trust-policy.json> [encrypted-envelope.json] <score.json>",
			);
		writeExclusive(
			rest.at(-1) as string,
			scoreRunnerSignedQueryIdentityRun({
				oracle: readJson<QueryIdentityOracle>(rest[0]),
				predictions: readJson<QueryIdentityPredictionArtifact>(rest[1]),
				launchReceipt: readJson<QueryIdentityLaunchReceipt>(rest[2]),
				timestampEvidence: readJson<Rfc3161DigestTimestampEvidence>(rest[3]),
				timestampTrustPolicy: readJson<Rfc3161TimestampTrustPolicy>(rest[4]),
				acknowledgement: readJson<QueryIdentityRunnerAcknowledgement>(rest[5]),
				resultSeal: readJson<QueryIdentityRunnerResultSeal>(rest[6]),
				runnerTrustPolicy: readJson<QueryIdentityRunnerTrustPolicy>(rest[7]),
				...(rest.length === 10
					? {
							encryptedOracleEnvelope:
								readJson<QueryIdentityEncryptedOracleEnvelope>(rest[8]),
						}
					: {}),
			}),
		);
		return;
	}
	if (command === "score-runner-timestamped") {
		if (rest.length !== 11 && rest.length !== 12)
			throw new Error(
				"usage: score-runner-timestamped <oracle.json> <predictions.json> <launch-receipt.json> <oracle-timestamp-evidence.json> <oracle-timestamp-trust-policy.json> <runner-acknowledgement.json> <runner-result-seal.json> <runner-trust-policy.json> <prediction-timestamp-evidence.json> <prediction-timestamp-trust-policy.json> [encrypted-envelope.json] <score.json>",
			);
		writeExclusive(
			rest.at(-1) as string,
			scoreTimestampedRunnerQueryIdentityRun({
				oracle: readJson<QueryIdentityOracle>(rest[0]),
				predictions: readJson<QueryIdentityPredictionArtifact>(rest[1]),
				launchReceipt: readJson<QueryIdentityLaunchReceipt>(rest[2]),
				timestampEvidence: readJson<Rfc3161DigestTimestampEvidence>(rest[3]),
				timestampTrustPolicy: readJson<Rfc3161TimestampTrustPolicy>(rest[4]),
				acknowledgement: readJson<QueryIdentityRunnerAcknowledgement>(rest[5]),
				resultSeal: readJson<QueryIdentityRunnerResultSeal>(rest[6]),
				runnerTrustPolicy: readJson<QueryIdentityRunnerTrustPolicy>(rest[7]),
				predictionTimestampEvidence: readJson<Rfc3161DigestTimestampEvidence>(
					rest[8],
				),
				predictionTimestampTrustPolicy: readJson<Rfc3161TimestampTrustPolicy>(
					rest[9],
				),
				...(rest.length === 12
					? {
							encryptedOracleEnvelope:
								readJson<QueryIdentityEncryptedOracleEnvelope>(rest[10]),
						}
					: {}),
			}),
		);
		return;
	}
	if (command === "score-escrow-attested") {
		if (rest.length !== 17 && rest.length !== 18)
			throw new Error(
				"usage: score-escrow-attested <oracle.json> <predictions.json> <launch-receipt.json> <oracle-timestamp-evidence.json> <oracle-timestamp-trust-policy.json> <runner-acknowledgement.json> <runner-result-seal.json> <runner-trust-policy.json> <prediction-timestamp-evidence.json> <prediction-timestamp-trust-policy.json> <escrow-trust-policy.json> <escrow-policy-timestamp-evidence.json> <escrow-policy-timestamp-trust-policy.json> <reveal-receipt.json> <reveal-timestamp-evidence.json> <reveal-timestamp-trust-policy.json> [encrypted-envelope.json] <score.json>",
			);
		writeExclusive(
			rest.at(-1) as string,
			scoreEscrowAttestedQueryIdentityRun({
				oracle: readJson<QueryIdentityOracle>(rest[0]),
				predictions: readJson<QueryIdentityPredictionArtifact>(rest[1]),
				launchReceipt: readJson<QueryIdentityLaunchReceipt>(rest[2]),
				timestampEvidence: readJson<Rfc3161DigestTimestampEvidence>(rest[3]),
				timestampTrustPolicy: readJson<Rfc3161TimestampTrustPolicy>(rest[4]),
				acknowledgement: readJson<QueryIdentityRunnerAcknowledgement>(rest[5]),
				resultSeal: readJson<QueryIdentityRunnerResultSeal>(rest[6]),
				runnerTrustPolicy: readJson<QueryIdentityRunnerTrustPolicy>(rest[7]),
				predictionTimestampEvidence: readJson<Rfc3161DigestTimestampEvidence>(
					rest[8],
				),
				predictionTimestampTrustPolicy: readJson<Rfc3161TimestampTrustPolicy>(
					rest[9],
				),
				escrowTrustPolicy: readJson<QueryIdentityEscrowTrustPolicy>(rest[10]),
				escrowPolicyTimestampEvidence: readJson<Rfc3161DigestTimestampEvidence>(
					rest[11],
				),
				escrowPolicyTimestampTrustPolicy: readJson<Rfc3161TimestampTrustPolicy>(
					rest[12],
				),
				revealReceipt: readJson<QueryIdentityOracleRevealReceipt>(rest[13]),
				revealTimestampEvidence: readJson<Rfc3161DigestTimestampEvidence>(
					rest[14],
				),
				revealTimestampTrustPolicy: readJson<Rfc3161TimestampTrustPolicy>(
					rest[15],
				),
				...(rest.length === 18
					? {
							encryptedOracleEnvelope:
								readJson<QueryIdentityEncryptedOracleEnvelope>(rest[16]),
						}
					: {}),
			}),
		);
		return;
	}
	throw new Error(
		"command must be blind, encrypt-oracle, verify-oracle-release, launch-encrypted, score, launch, launch-runner, launch-runner-escrow, score-public, score-runner-signed, score-runner-timestamped, or score-escrow-attested",
	);
}

const invokedPath = process.argv[1]
	? pathToFileURL(resolve(process.argv[1])).href
	: undefined;
if (invokedPath === import.meta.url)
	try {
		runQueryIdentityEvidenceCli(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : "query identity evidence failed"}\n`,
		);
		process.exitCode = 1;
	}
