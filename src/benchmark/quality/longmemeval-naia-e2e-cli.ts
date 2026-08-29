import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	longMemEvalProtocolSha256,
	parseLongMemEvalDataset,
	toLongMemEvalProtocolRecord,
} from "./longmemeval-contract.js";
import {
	LONGMEMEVAL_NAIA_E2E_SCHEMA,
	LONGMEMEVAL_NAIA_RETRIEVAL_POLICY,
	longMemEvalNaiaRetrievalSha256,
	runLongMemEvalNaiaE2E,
} from "./longmemeval-naia-e2e.js";

function argument(name: string): string {
	const index = process.argv.indexOf(name);
	const value = index >= 0 ? process.argv[index + 1] : undefined;
	if (!value) throw new Error(`missing ${name}`);
	return value;
}

const inputPath = resolve(argument("--input"));
const outputPath = resolve(argument("--output"));
const storesDirectory = resolve(argument("--stores-dir"));
const sourceRevision = argument("--source-revision");
if (!/^[a-f0-9]{40}$/u.test(sourceRevision))
	throw new Error("source revision must be a full 40-character Git commit");

const started = process.hrtime.bigint();
const sourceBytes = await readFile(inputPath);
const records = parseLongMemEvalDataset(
	JSON.parse(sourceBytes.toString("utf8")),
).map(toLongMemEvalProtocolRecord);
const cases = await runLongMemEvalNaiaE2E(records, storesDirectory);
const failures = cases.filter(
	(result) =>
		result.error || result.storedEpisodeCount !== result.inputTurnCount,
	// Round-trip equality covers content, role, timestamp, project, session and ID.
	// Keep this on a separate predicate line so the failure receipt stays explicit.
);
const roundTripFailures = cases.filter((result) => !result.roundTripMatch);
const failedQuestionIds = new Set([
	...failures.map((result) => result.questionId),
	...roundTripFailures.map((result) => result.questionId),
]);
const receipt = {
	schemaVersion: LONGMEMEVAL_NAIA_E2E_SCHEMA,
	source: {
		benchmark: "LongMemEval",
		variant: "longmemeval_s_cleaned",
		revision: sourceRevision,
		sha256: createHash("sha256").update(sourceBytes).digest("hex"),
	},
	protocolSha256: longMemEvalProtocolSha256(records),
	retrievalPolicy: LONGMEMEVAL_NAIA_RETRIEVAL_POLICY,
	summary: {
		caseCount: cases.length,
		acceptedCaseCount: cases.length - failedQuestionIds.size,
		inputSessionCount: cases.reduce(
			(sum, result) => sum + result.inputSessionCount,
			0,
		),
		inputTurnCount: cases.reduce(
			(sum, result) => sum + result.inputTurnCount,
			0,
		),
		storedEpisodeCount: cases.reduce(
			(sum, result) => sum + result.storedEpisodeCount,
			0,
		),
		retrievedEpisodeCount: cases.reduce(
			(sum, result) => sum + result.retrieval.length,
			0,
		),
		storeBytes: cases.reduce((sum, result) => sum + result.storeBytes, 0),
		encodeElapsedMs: cases.reduce(
			(sum, result) => sum + result.encodeElapsedMs,
			0,
		),
		recallElapsedMs: cases.reduce(
			(sum, result) => sum + result.recallElapsedMs,
			0,
		),
		roundTripMatchCount: cases.length - roundTripFailures.length,
		failureCount: failedQuestionIds.size,
	},
	retrievalSha256: longMemEvalNaiaRetrievalSha256(cases),
	execution: {
		elapsedMs: Number(process.hrtime.bigint() - started) / 1_000_000,
		peakResidentSetBytes: process.memoryUsage().rss,
		node: process.version,
		platform: `${process.platform}-${process.arch}`,
	},
	cases,
};
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(receipt.summary)}\n`);
if (failedQuestionIds.size > 0) process.exitCode = 1;
