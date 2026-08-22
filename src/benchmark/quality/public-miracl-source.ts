import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { createGunzip } from "node:zlib";

export const MIRACL_KO_LOCK = {
	datasetRevision: "5be20db9509754dadad47689368639fcec739c00",
	corpusRevision: "d921ec7e349ce0d28daf30b2da9da5ee698bef0d",
	upstreamRepositoryCommit: "fa3a57c89ad8f61f0a02d8c27167d8141cfd77ca",
	files: [
		{
			path: "miracl-v1.0-ko/topics/topics.miracl-v1.0-ko-dev.tsv",
			sha256:
				"a365552cfc997a8915e948a3b5994883f641e7c3f12b6af87bbfaf89729e32a8",
			size: 12_597,
		},
		{
			path: "miracl-v1.0-ko/qrels/qrels.miracl-v1.0-ko-dev.tsv",
			sha256:
				"88827ccc5b64e531b25f70eef30202d33daa9bfa3ac8cceadf5cdbd5ca5034df",
			size: 55_675,
		},
		{
			path: "miracl-corpus-v1.0-ko/docs-0.jsonl.gz",
			sha256:
				"c56a31883a291504aa9c97968fb7a5fbcc9ea1099ee1810200249e1afb7fc55d",
			size: 87_965_596,
		},
		{
			path: "miracl-corpus-v1.0-ko/docs-1.jsonl.gz",
			sha256:
				"fecd2886124e78c3aa87c59604ac9909c23165415c70a96f4edb95677b5ed0cd",
			size: 75_422_723,
		},
		{
			path: "miracl-corpus-v1.0-ko/docs-2.jsonl.gz",
			sha256:
				"93e90d098d78f50a9e76dd2e64608d65e0563787954f848da9b04286f81b75d9",
			size: 62_582_229,
		},
	] as const,
};

export function parseTopicsTsv(input: string): Map<string, string> {
	const topics = new Map<string, string>();
	for (const line of input.trim().split(/\r?\n/)) {
		const separator = line.indexOf("\t");
		if (separator < 1 || separator === line.length - 1)
			throw new Error("invalid MIRACL topic row");
		const id = line.slice(0, separator);
		if (topics.has(id)) throw new Error(`duplicate MIRACL topic: ${id}`);
		topics.set(id, line.slice(separator + 1));
	}
	return topics;
}

export function parseQrelsTsv(input: string): Map<string, string[]> {
	const qrels = new Map<string, string[]>();
	for (const [offset, line] of input.trim().split(/\r?\n/).entries()) {
		const columns = line.split("\t");
		const relevance = Number(columns[3]);
		if (
			columns.length !== 4 ||
			columns[1] !== "Q0" ||
			!Number.isFinite(relevance)
		)
			throw new Error(`invalid MIRACL qrels row ${offset + 1}`);
		if (relevance <= 0) continue;
		const [queryId, , documentId] = columns;
		if (!queryId || !documentId)
			throw new Error(`invalid MIRACL qrels row ${offset + 1}`);
		qrels.set(queryId, [...(qrels.get(queryId) ?? []), documentId]);
	}
	return new Map(
		[...qrels].map(([id, documents]) => [id, [...new Set(documents)].sort()]),
	);
}

export function parseTrecRun(input: string): Map<string, string[]> {
	const run = new Map<string, string[]>();
	const seen = new Map<string, Set<string>>();
	for (const [offset, line] of input.trim().split(/\r?\n/).entries()) {
		const columns = line.trim().split(/\s+/);
		if (columns.length !== 6) throw new Error(`invalid TREC row ${offset + 1}`);
		const [queryId, iteration, documentId, rankText, scoreText] = columns;
		const rank = Number(rankText);
		if (
			!queryId ||
			iteration !== "Q0" ||
			!documentId ||
			!Number.isSafeInteger(rank) ||
			rank < 1 ||
			!Number.isFinite(Number(scoreText))
		)
			throw new Error(`invalid TREC row ${offset + 1}`);
		const documents = run.get(queryId) ?? [];
		if (rank !== documents.length + 1)
			throw new Error(`non-contiguous rank for ${queryId}: ${rank}`);
		const querySeen = seen.get(queryId) ?? new Set<string>();
		if (querySeen.has(documentId))
			throw new Error(`duplicate TREC document for ${queryId}: ${documentId}`);
		querySeen.add(documentId);
		seen.set(queryId, querySeen);
		documents.push(documentId);
		run.set(queryId, documents);
	}
	return run;
}

export function validateTrecRunCoverage(
	run: ReadonlyMap<string, readonly string[]>,
	expectedQueryIds: ReadonlySet<string>,
	expectedDepth: number,
): void {
	if (!Number.isSafeInteger(expectedDepth) || expectedDepth < 1)
		throw new Error("expected TREC depth must be a positive safe integer");
	const unexpected = [...run.keys()].filter((id) => !expectedQueryIds.has(id));
	const missing = [...expectedQueryIds].filter((id) => !run.has(id));
	const wrongDepth = [...run]
		.filter(
			([id, documents]) =>
				expectedQueryIds.has(id) && documents.length !== expectedDepth,
		)
		.map(([id, documents]) => `${id}:${documents.length}`);
	if (unexpected.length > 0 || missing.length > 0 || wrongDepth.length > 0) {
		throw new Error(
			`TREC coverage mismatch (unexpected=${unexpected.length}, missing=${missing.length}, wrongDepth=${wrongDepth.length})`,
		);
	}
}

export async function readGzipJsonlDocumentIds(
	path: string,
): Promise<string[]> {
	const ids: string[] = [];
	let pending = "";
	let physicalLine = 0;
	const decoder = new StringDecoder("utf8");
	const consume = (line: string) => {
		physicalLine++;
		const normalizedLine = line.endsWith("\r") ? line.slice(0, -1) : line;
		if (normalizedLine.length === 0)
			throw new Error(`${path}: blank JSONL row ${physicalLine}`);
		let row: { docid?: unknown };
		try {
			row = JSON.parse(normalizedLine) as { docid?: unknown };
		} catch (error) {
			throw new Error(`${path}: invalid JSON at row ${physicalLine}`, {
				cause: error,
			});
		}
		if (typeof row.docid !== "string" || row.docid.length === 0)
			throw new Error(`${path}: invalid docid at row ${physicalLine}`);
		ids.push(row.docid);
	};
	for await (const chunk of createReadStream(path).pipe(createGunzip())) {
		pending += decoder.write(chunk);
		let separator = pending.indexOf("\n");
		while (separator >= 0) {
			consume(pending.slice(0, separator));
			pending = pending.slice(separator + 1);
			separator = pending.indexOf("\n");
		}
	}
	pending += decoder.end();
	if (pending.length > 0) consume(pending);
	return ids;
}

export async function sha256File(path: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest("hex");
}

export async function verifyLockedFile(
	path: string,
	expected: { size: number; sha256: string | null },
) {
	const actualSize = (await stat(path)).size;
	if (actualSize !== expected.size)
		throw new Error(`${path}: size ${actualSize} != ${expected.size}`);
	const sha256 = await sha256File(path);
	if (expected.sha256 && sha256 !== expected.sha256)
		throw new Error(`${path}: sha256 mismatch`);
	return { size: actualSize, sha256 };
}

export async function inspectGzipJsonl(
	path: string,
): Promise<{ count: number; firstId: string; lastId: string }> {
	let count = 0;
	let firstId = "";
	let lastId = "";
	let pending = "";
	const decoder = new StringDecoder("utf8");
	let physicalLine = 0;
	const consume = (line: string) => {
		physicalLine++;
		const normalizedLine = line.endsWith("\r") ? line.slice(0, -1) : line;
		if (normalizedLine.length === 0)
			throw new Error(`${path}: blank JSONL row ${physicalLine}`);
		let row: { docid?: unknown };
		try {
			row = JSON.parse(normalizedLine) as { docid?: unknown };
		} catch (error) {
			throw new Error(`${path}: invalid JSON at row ${physicalLine}`, {
				cause: error,
			});
		}
		if (typeof row.docid !== "string" || row.docid.length === 0)
			throw new Error(`${path}: invalid docid at row ${count + 1}`);
		if (count === 0) firstId = row.docid;
		lastId = row.docid;
		count++;
	};
	for await (const chunk of createReadStream(path).pipe(createGunzip())) {
		pending += decoder.write(chunk);
		let separator = pending.indexOf("\n");
		while (separator >= 0) {
			consume(pending.slice(0, separator));
			pending = pending.slice(separator + 1);
			separator = pending.indexOf("\n");
		}
	}
	pending += decoder.end();
	if (pending.length > 0) consume(pending);
	if (count === 0) throw new Error(`${path}: empty corpus shard`);
	return { count, firstId, lastId };
}

export async function fileExists(path: string): Promise<boolean> {
	try {
		const handle = await open(path, "r");
		await handle.close();
		return true;
	} catch {
		return false;
	}
}
