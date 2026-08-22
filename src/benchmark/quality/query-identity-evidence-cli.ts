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
	type QueryIdentityLaunchReceipt,
	createQueryIdentityLaunchArtifacts,
	scorePublicQueryIdentityRun,
} from "./query-identity-launch.js";
import {
	type QueryIdentityOracle,
	type QueryIdentityPredictionArtifact,
	buildQueryIdentityBlindPacket,
	scoreQueryIdentityArtifact,
} from "./query-identity-oracle.js";
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
	throw new Error("command must be blind, score, launch, or score-public");
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
