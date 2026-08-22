#!/usr/bin/env node
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	type QueryIdentityOracle,
	type QueryIdentityPredictionArtifact,
	buildQueryIdentityBlindPacket,
	scoreQueryIdentityArtifact,
} from "./query-identity-oracle.js";

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

function writeExclusive(path: string, value: unknown): void {
	const target = resolve(path);
	if (existsSync(target)) throw new Error(`output already exists: ${target}`);
	const temporary = `${target}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
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
	throw new Error("command must be blind or score");
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
