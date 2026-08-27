#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { authorizeMultilingualTrueBatchCandidate } from "./miracl-multilingual-candidate-authorization.js";
import type { MultilingualFullCorpusResult } from "./miracl-multilingual-full-corpus-evidence.js";
import type { MultilingualTrueBatchLanguage } from "./miracl-multilingual-true-batch-equivalence.js";
import { expectedMultilingualTrueBatchIdentity } from "./miracl-multilingual-true-batch-runner.js";
import { sha256Bytes } from "./native-full-corpus-evidence.js";

const language = process.argv[2];
if (language !== "ar" && language !== "en")
	throw new Error(
		"Usage: ... <ar|en> <preflight> <completion> <baseline-result> <source-receipt> <output>",
	);
const paths = process.argv.slice(3);
if (paths.length !== 5)
	throw new Error(
		"Usage: ... <ar|en> <preflight> <completion> <baseline-result> <source-receipt> <output>",
	);
const [
	preflightPath,
	completionPath,
	baselinePath,
	sourceReceiptPath,
	outputPath,
] = paths as [string, string, string, string, string];
const preflightBytes = readFileSync(preflightPath);
const completionBytes = readFileSync(completionPath);
const baselineResultBytes = readFileSync(baselinePath);
const sourceReceiptBytes = readFileSync(sourceReceiptPath);
const expectedIdentity = expectedMultilingualTrueBatchIdentity(process.cwd());
const authorization = authorizeMultilingualTrueBatchCandidate({
	language: language as MultilingualTrueBatchLanguage,
	preflight: JSON.parse(preflightBytes.toString("utf8")),
	preflightBytes,
	completion: JSON.parse(completionBytes.toString("utf8")),
	completionBytes,
	baselineResult: JSON.parse(
		baselineResultBytes.toString("utf8"),
	) as MultilingualFullCorpusResult,
	baselineResultBytes,
	sourceReceipt: JSON.parse(sourceReceiptBytes.toString("utf8")),
	sourceReceiptBytes,
	expectedProducerSourceSha256: expectedIdentity.producerSourceSha256,
	expectedPolicySha256: expectedIdentity.policySha256,
	expectedEvaluationSourceSha256: sha256Bytes(
		readFileSync(
			resolve("src/benchmark/quality/native-full-corpus-evaluation-cli.ts"),
		),
	),
});
writeFileSync(outputPath, `${JSON.stringify(authorization, null, 2)}\n`, {
	flag: "wx",
	mode: 0o600,
});
process.stdout.write(`${JSON.stringify(authorization, null, 2)}\n`);
