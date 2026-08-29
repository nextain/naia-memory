import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { LocalAdapter } from "../../memory/adapters/local.js";
import { OfflineEmbeddingProvider } from "../../memory/embeddings.js";
import { MemorySystem } from "../../memory/memory-system.js";
import { ChunkedEmbeddingProvider } from "./chunked-embedding-provider.js";
import {
	type LongMemEvalBlindCase,
	type LongMemEvalBlindCorpus,
	blindCorpusSha256,
	validateLongMemEvalBlindCorpus,
} from "./longmemeval-blind-corpus.js";

function argument(name: string): string {
	const index = process.argv.indexOf(name);
	const value = index >= 0 ? process.argv[index + 1] : undefined;
	if (!value) throw new Error(`missing ${name}`);
	return value;
}

function parsePositiveInteger(value: string, name: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500)
		throw new Error(`${name} must be an integer from 1 through 500`);
	return parsed;
}

function parseOfficialDate(value: string): number {
	const match =
		/^(\d{4})\/(\d{2})\/(\d{2}) \([A-Za-z]{3}\) (\d{2}):(\d{2})$/u.exec(value);
	if (!match) throw new Error(`unsupported LongMemEval date: ${value}`);
	const [, year, month, day, hour, minute] = match;
	return Date.UTC(
		Number(year),
		Number(month) - 1,
		Number(day),
		Number(hour),
		Number(minute),
	);
}

function safeCaseName(questionId: string): string {
	return `${createHash("sha256").update(questionId).digest("hex").slice(0, 16)}.json`;
}

async function ingestBlindCase(item: LongMemEvalBlindCase, storePath: string) {
	const adapter = new LocalAdapter({ storePath, disableKGSpreading: true });
	const memory = new MemorySystem({
		adapter,
		disableImportanceGating: true,
	});
	await memory.init();
	try {
		for (const [sessionOrdinal, session] of item.haystack_sessions.entries()) {
			const sessionTimestamp = parseOfficialDate(
				item.haystack_dates[sessionOrdinal] as string,
			);
			const sessionId = item.haystack_session_ids[sessionOrdinal] as string;
			for (const [turnOrdinal, turn] of session.entries())
				await memory.encode(
					{
						content: turn.content,
						role: turn.role,
						timestamp: sessionTimestamp + turnOrdinal,
						idempotencyKey: `${item.question_id}:${sessionOrdinal}:${turnOrdinal}`,
					},
					{
						project: item.question_id,
						sessionId: `${sessionOrdinal}:${sessionId}`,
					},
				);
		}
	} finally {
		await memory.close();
	}
}

const inputPath = resolve(argument("--input"));
const outputPath = resolve(argument("--output"));
const storesDirectory = resolve(argument("--stores-dir"));
const caseCount = parsePositiveInteger(
	argument("--case-count"),
	"--case-count",
);
const inputBytes = await readFile(inputPath);
const corpus = JSON.parse(
	inputBytes.toString("utf8"),
) as LongMemEvalBlindCorpus;
validateLongMemEvalBlindCorpus(corpus);
await mkdir(storesDirectory, { recursive: true });

const baseEmbedder = new OfflineEmbeddingProvider(
	"multilingual-e5-large",
	"cpu",
	"00fc3aeb3dbb95842de2ac1961d33c6319acf57b",
	"padded-array-batch-v1",
);
const embedder = new ChunkedEmbeddingProvider(baseEmbedder, 8);
const started = process.hrtime.bigint();
const cases = [];
for (const item of corpus.cases.slice(0, caseCount)) {
	const storePath = join(storesDirectory, safeCaseName(item.question_id));
	const ingestStarted = process.hrtime.bigint();
	await ingestBlindCase(item, storePath);
	const ingestElapsedMs =
		Number(process.hrtime.bigint() - ingestStarted) / 1_000_000;
	const adapter = new LocalAdapter({
		storePath,
		embeddingProvider: embedder,
		disableKGSpreading: true,
	});
	const memory = new MemorySystem({
		adapter,
		disableImportanceGating: true,
	});
	let reindexElapsedMs = 0;
	let recallElapsedMs = 0;
	let retrieval: string[] = [];
	try {
		await memory.init();
		const reindexStarted = process.hrtime.bigint();
		await adapter.reindexEmbeddings();
		reindexElapsedMs =
			Number(process.hrtime.bigint() - reindexStarted) / 1_000_000;
		const recallStarted = process.hrtime.bigint();
		const recalled = await memory.recall(item.question, {
			project: item.question_id,
			topK: 50,
			deepRecall: true,
			scopeMode: "strict",
			crossProject: false,
		});
		recallElapsedMs =
			Number(process.hrtime.bigint() - recallStarted) / 1_000_000;
		retrieval = recalled.episodes.map((episode) => episode.id);
	} finally {
		await memory.close();
	}
	cases.push({
		questionId: item.question_id,
		turnCount: item.haystack_sessions.reduce(
			(sum, session) => sum + session.length,
			0,
		),
		ingestElapsedMs,
		reindexElapsedMs,
		recallElapsedMs,
		retrievedCount: retrieval.length,
		retrievalSha256: createHash("sha256")
			.update(JSON.stringify(retrieval))
			.digest("hex"),
		storeBytes: (await stat(storePath)).size,
	});
}

const receipt = {
	schemaVersion: "naia-memory-longmemeval-semantic-pilot-v1",
	labelAccess: "blind-corpus-only",
	input: {
		fileSha256: createHash("sha256").update(inputBytes).digest("hex"),
		contentSha256: blindCorpusSha256(corpus),
	},
	policy: {
		embedding: baseEmbedder.policyReceipt,
		embeddingSpaceId: embedder.embeddingSpaceId,
		batchInferenceMode: baseEmbedder.batchInferenceMode,
		batchSize: embedder.batchSize,
		searchMode: "rrf",
		topK: 50,
	},
	summary: {
		caseCount: cases.length,
		turnCount: cases.reduce((sum, item) => sum + item.turnCount, 0),
		ingestElapsedMs: cases.reduce((sum, item) => sum + item.ingestElapsedMs, 0),
		reindexElapsedMs: cases.reduce(
			(sum, item) => sum + item.reindexElapsedMs,
			0,
		),
		recallElapsedMs: cases.reduce((sum, item) => sum + item.recallElapsedMs, 0),
		storeBytes: cases.reduce((sum, item) => sum + item.storeBytes, 0),
		elapsedMs: Number(process.hrtime.bigint() - started) / 1_000_000,
		residentSetBytesAtReceipt: process.memoryUsage().rss,
		maxResidentSetBytes: process.resourceUsage().maxRSS * 1024,
	},
	cases,
};
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(receipt.summary)}\n`);
