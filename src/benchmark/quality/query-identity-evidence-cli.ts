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
		if (rest.length !== 6)
			throw new Error(
				"usage: score-public <oracle.json> <predictions.json> <launch-receipt.json> <timestamp-evidence.json> <trust-policy.json> <score.json>",
			);
		writeExclusive(
			rest[5],
			scorePublicQueryIdentityRun({
				oracle: readJson<QueryIdentityOracle>(rest[0]),
				predictions: readJson<QueryIdentityPredictionArtifact>(rest[1]),
				launchReceipt: readJson<QueryIdentityLaunchReceipt>(rest[2]),
				timestampEvidence: readJson<Rfc3161DigestTimestampEvidence>(rest[3]),
				timestampTrustPolicy: readJson<Rfc3161TimestampTrustPolicy>(rest[4]),
			}),
		);
		return;
	}
	if (command === "score-runner-signed") {
		if (rest.length !== 9)
			throw new Error(
				"usage: score-runner-signed <oracle.json> <predictions.json> <launch-receipt.json> <timestamp-evidence.json> <timestamp-trust-policy.json> <runner-acknowledgement.json> <runner-result-seal.json> <runner-trust-policy.json> <score.json>",
			);
		writeExclusive(
			rest[8],
			scoreRunnerSignedQueryIdentityRun({
				oracle: readJson<QueryIdentityOracle>(rest[0]),
				predictions: readJson<QueryIdentityPredictionArtifact>(rest[1]),
				launchReceipt: readJson<QueryIdentityLaunchReceipt>(rest[2]),
				timestampEvidence: readJson<Rfc3161DigestTimestampEvidence>(rest[3]),
				timestampTrustPolicy: readJson<Rfc3161TimestampTrustPolicy>(rest[4]),
				acknowledgement: readJson<QueryIdentityRunnerAcknowledgement>(rest[5]),
				resultSeal: readJson<QueryIdentityRunnerResultSeal>(rest[6]),
				runnerTrustPolicy: readJson<QueryIdentityRunnerTrustPolicy>(rest[7]),
			}),
		);
		return;
	}
	if (command === "score-runner-timestamped") {
		if (rest.length !== 11)
			throw new Error(
				"usage: score-runner-timestamped <oracle.json> <predictions.json> <launch-receipt.json> <oracle-timestamp-evidence.json> <oracle-timestamp-trust-policy.json> <runner-acknowledgement.json> <runner-result-seal.json> <runner-trust-policy.json> <prediction-timestamp-evidence.json> <prediction-timestamp-trust-policy.json> <score.json>",
			);
		writeExclusive(
			rest[10],
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
			}),
		);
		return;
	}
	if (command === "score-escrow-attested") {
		if (rest.length !== 17)
			throw new Error(
				"usage: score-escrow-attested <oracle.json> <predictions.json> <launch-receipt.json> <oracle-timestamp-evidence.json> <oracle-timestamp-trust-policy.json> <runner-acknowledgement.json> <runner-result-seal.json> <runner-trust-policy.json> <prediction-timestamp-evidence.json> <prediction-timestamp-trust-policy.json> <escrow-trust-policy.json> <escrow-policy-timestamp-evidence.json> <escrow-policy-timestamp-trust-policy.json> <reveal-receipt.json> <reveal-timestamp-evidence.json> <reveal-timestamp-trust-policy.json> <score.json>",
			);
		writeExclusive(
			rest[16],
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
			}),
		);
		return;
	}
	throw new Error(
		"command must be blind, score, launch, launch-runner, launch-runner-escrow, score-public, score-runner-signed, score-runner-timestamped, or score-escrow-attested",
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
