import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	blindCorpusSha256,
	createLongMemEvalBlindCorpus,
	validateLongMemEvalBlindCorpus,
} from "./longmemeval-blind-corpus.js";
import { parseLongMemEvalDataset } from "./longmemeval-contract.js";

function argument(name: string): string {
	const index = process.argv.indexOf(name);
	const value = index >= 0 ? process.argv[index + 1] : undefined;
	if (!value) throw new Error(`missing ${name}`);
	return value;
}

const inputPath = resolve(argument("--input"));
const outputPath = resolve(argument("--output"));
const receiptPath = resolve(argument("--receipt"));
const sourceRevision = argument("--source-revision");
if (!/^[a-f0-9]{40}$/u.test(sourceRevision))
	throw new Error("source revision must be a full 40-character Git commit");

const sourceBytes = await readFile(inputPath);
const dataset = parseLongMemEvalDataset(
	JSON.parse(sourceBytes.toString("utf8")),
);
const blindCorpus = createLongMemEvalBlindCorpus(dataset);
validateLongMemEvalBlindCorpus(blindCorpus);
const outputBytes = Buffer.from(`${JSON.stringify(blindCorpus)}\n`, "utf8");
const receipt = {
	schemaVersion: "naia-memory-longmemeval-blind-corpus-receipt-v1",
	source: {
		revision: sourceRevision,
		sha256: createHash("sha256").update(sourceBytes).digest("hex"),
		bytes: sourceBytes.length,
	},
	blindCorpus: {
		sha256: blindCorpusSha256(blindCorpus),
		fileSha256: createHash("sha256").update(outputBytes).digest("hex"),
		bytes: outputBytes.length,
		caseCount: blindCorpus.cases.length,
		sessionCount: blindCorpus.cases.reduce(
			(sum, item) => sum + item.haystack_sessions.length,
			0,
		),
		turnCount: blindCorpus.cases.reduce(
			(sum, item) =>
				sum +
				item.haystack_sessions.reduce(
					(sessionSum, session) => sessionSum + session.length,
					0,
				),
			0,
		),
	},
	removedFields: ["answer", "answer_session_ids", "has_answer"],
};
await writeFile(outputPath, outputBytes);
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(receipt)}\n`);
