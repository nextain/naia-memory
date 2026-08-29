import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	LONGMEMEVAL_QUESTION_TYPES,
	longMemEvalProtocolSha256,
	parseLongMemEvalDataset,
	toLongMemEvalProtocolRecord,
} from "./longmemeval-contract.js";

function argument(name: string): string {
	const index = process.argv.indexOf(name);
	const value = index >= 0 ? process.argv[index + 1] : undefined;
	if (!value) throw new Error(`missing ${name}`);
	return value;
}

const inputPath = resolve(argument("--input"));
const outputPath = resolve(argument("--output"));
const sourceRevision = argument("--source-revision");
if (!/^[a-f0-9]{40}$/u.test(sourceRevision))
	throw new Error("source revision must be a full 40-character Git commit");

const started = process.hrtime.bigint();
const sourceBytes = await readFile(inputPath);
const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
const dataset = parseLongMemEvalDataset(
	JSON.parse(sourceBytes.toString("utf8")),
);
const records = dataset.map(toLongMemEvalProtocolRecord);
const questionTypeCounts = Object.fromEntries(
	LONGMEMEVAL_QUESTION_TYPES.map((type) => [
		type,
		records.filter((record) => record.questionType === type).length,
	]),
);
const receipt = {
	schemaVersion: "naia-memory-longmemeval-ingest-receipt-v1",
	source: {
		benchmark: "LongMemEval",
		variant: "longmemeval_s_cleaned",
		revision: sourceRevision,
		sha256: sourceSha256,
		bytes: sourceBytes.byteLength,
	},
	protocol: {
		recordSchemaVersion: "naia-memory-longmemeval-protocol-v1",
		sha256: longMemEvalProtocolSha256(records),
		caseCount: records.length,
		sessionCount: records.reduce(
			(sum, record) => sum + record.sessions.length,
			0,
		),
		turnCount: records.reduce(
			(sum, record) =>
				sum +
				record.sessions.reduce(
					(inner, session) => inner + session.turns.length,
					0,
				),
			0,
		),
		emptyContentTurnCount: records.reduce(
			(sum, record) =>
				sum +
				record.sessions.reduce(
					(inner, session) =>
						inner +
						session.turns.filter((turn) => turn.content.length === 0).length,
					0,
				),
			0,
		),
		abstentionCount: records.filter((record) => record.isAbstention).length,
		duplicateSessionIdCaseCount: records.filter(
			(record) =>
				new Set(record.sessions.map((session) => session.sessionId)).size !==
				record.sessions.length,
		).length,
		questionTypeCounts,
		identityPolicy: "official-question-session-turn-order-round-trip-v1",
		answerLabelsExcludedFromRetrieval: true,
	},
	execution: {
		elapsedMs: Number(process.hrtime.bigint() - started) / 1_000_000,
		peakResidentSetBytes: process.memoryUsage().rss,
		node: process.version,
		platform: `${process.platform}-${process.arch}`,
	},
};
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(receipt)}\n`);
