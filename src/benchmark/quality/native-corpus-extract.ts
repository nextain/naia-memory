import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { StringDecoder } from "node:string_decoder";
import { createGunzip } from "node:zlib";
import Database from "better-sqlite3";

export interface NativeCorpusDocument {
	docid: string;
	title: string;
	text: string;
}

export interface NativeCorpusScanReceipt {
	documentCount: number;
	docidsSha256: string;
	compressedShardCount: number;
	compressedBytes: number;
	duplicateDocidCount: 0;
}

export interface NativeCorpusScanOptions {
	duplicateWorkDirectory?: string;
	expectedCompressedShards?: readonly {
		size: number;
		sha256: string;
	}[];
}

class ExactDiskDuplicateTracker {
	private directory = "";
	private database: Database.Database | null = null;
	private insert: Database.Statement<[string]> | null = null;

	constructor(private readonly root: string) {}

	async open(): Promise<void> {
		this.directory = await mkdtemp(join(this.root, "naia-corpus-docids-"));
		this.database = new Database(join(this.directory, "docids.sqlite"));
		this.database.pragma("journal_mode = OFF");
		this.database.pragma("synchronous = OFF");
		this.database.pragma("temp_store = FILE");
		this.database.pragma("cache_size = -16384");
		this.database.exec(
			"CREATE TABLE docids (docid TEXT PRIMARY KEY) WITHOUT ROWID; BEGIN IMMEDIATE;",
		);
		this.insert = this.database.prepare(
			"INSERT INTO docids (docid) VALUES (?) ON CONFLICT DO NOTHING",
		);
	}

	add(docid: string): void {
		if (!this.insert) throw new Error("duplicate tracker is not open");
		if (this.insert.run(docid).changes !== 1)
			throw new Error(`duplicate corpus document: ${docid}`);
	}

	async close(): Promise<void> {
		try {
			if (this.database?.inTransaction) this.database.exec("ROLLBACK");
			this.database?.close();
		} finally {
			this.insert = null;
			this.database = null;
			if (this.directory)
				await rm(this.directory, { recursive: true, force: true });
		}
	}
}

/**
 * Scan every document without retaining corpus text in memory. The callback is
 * awaited to provide backpressure for embedding/index writers. Duplicate IDs
 * fail closed because a resume cursor based on corpus position is otherwise
 * ambiguous.
 */
export async function scanNativeCorpusDocuments(
	shards: readonly string[],
	consumeDocument: (
		document: NativeCorpusDocument,
		ordinal: number,
	) => Promise<void> | void,
	options: NativeCorpusScanOptions = {},
): Promise<NativeCorpusScanReceipt> {
	if (
		options.expectedCompressedShards &&
		options.expectedCompressedShards.length !== shards.length
	)
		throw new Error("compressed shard lock count mismatch");
	const duplicateTracker = new ExactDiskDuplicateTracker(
		options.duplicateWorkDirectory ?? tmpdir(),
	);
	const docidsHash = createHash("sha256");
	let documentCount = 0;
	let totalCompressedBytes = 0;
	try {
		await duplicateTracker.open();
		for (const [shardIndex, shard] of shards.entries()) {
			let lineNumber = 0;
			let pending = "";
			const decoder = new StringDecoder("utf8");
			const compressedHash = createHash("sha256");
			let compressedSize = 0;
			const observeCompressedBytes = new Transform({
				transform(chunk, _encoding, callback) {
					compressedSize += chunk.length;
					compressedHash.update(chunk);
					callback(null, chunk);
				},
			});
			const consume = async (rawLine: string) => {
				lineNumber++;
				const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
				if (line.length === 0)
					throw new Error(`${shard}:${lineNumber}: blank JSONL row`);
				let parsed: unknown;
				try {
					parsed = JSON.parse(line);
				} catch {
					throw new Error(`${shard}:${lineNumber}: invalid JSON`);
				}
				if (!isNativeCorpusDocument(parsed))
					throw new Error(`${shard}:${lineNumber}: invalid MIRACL document`);
				duplicateTracker.add(parsed.docid);
				docidsHash.update(`${parsed.docid}\n`);
				await consumeDocument(parsed, documentCount);
				documentCount++;
			};
			await pipeline(
				createReadStream(shard),
				observeCompressedBytes,
				createGunzip(),
				async (source) => {
					for await (const chunk of source) {
						pending += decoder.write(chunk);
						let separator = pending.indexOf("\n");
						while (separator >= 0) {
							await consume(pending.slice(0, separator));
							pending = pending.slice(separator + 1);
							separator = pending.indexOf("\n");
						}
					}
				},
			);
			pending += decoder.end();
			if (pending.length > 0) await consume(pending);
			const expected = options.expectedCompressedShards?.[shardIndex];
			if (
				expected &&
				(compressedSize !== expected.size ||
					compressedHash.digest("hex") !== expected.sha256)
			)
				throw new Error(`${shard}: compressed source lock mismatch`);
			totalCompressedBytes += compressedSize;
		}
		return {
			documentCount,
			docidsSha256: docidsHash.digest("hex"),
			compressedShardCount: shards.length,
			compressedBytes: totalCompressedBytes,
			duplicateDocidCount: 0,
		};
	} finally {
		await duplicateTracker.close();
	}
}

export async function extractNativeCorpusDocuments(
	shards: readonly string[],
	requiredDocumentIds: ReadonlySet<string>,
): Promise<NativeCorpusDocument[]> {
	const found = new Map<string, NativeCorpusDocument>();
	for (const shard of shards) {
		let lineNumber = 0;
		let pending = "";
		const decoder = new StringDecoder("utf8");
		const consume = (rawLine: string) => {
			lineNumber++;
			const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
			if (line.length === 0)
				throw new Error(`${shard}:${lineNumber}: blank JSONL row`);
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				throw new Error(`${shard}:${lineNumber}: invalid JSON`);
			}
			if (!isNativeCorpusDocument(parsed))
				throw new Error(`${shard}:${lineNumber}: invalid MIRACL document`);
			if (!requiredDocumentIds.has(parsed.docid)) return;
			if (found.has(parsed.docid))
				throw new Error(`duplicate required document: ${parsed.docid}`);
			found.set(parsed.docid, parsed);
		};
		for await (const chunk of createReadStream(shard).pipe(createGunzip())) {
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
	}
	const missing = [...requiredDocumentIds].filter((id) => !found.has(id));
	if (missing.length > 0)
		throw new Error(`missing ${missing.length} required documents`);
	return [...found.values()].sort((left, right) =>
		left.docid.localeCompare(right.docid),
	);
}

function isNativeCorpusDocument(value: unknown): value is NativeCorpusDocument {
	if (typeof value !== "object" || value === null) return false;
	const row = value as Record<string, unknown>;
	return (
		typeof row.docid === "string" &&
		row.docid.length > 0 &&
		!/[\r\n]/u.test(row.docid) &&
		typeof row.title === "string" &&
		typeof row.text === "string"
	);
}

export function canonicalNativeCorpusJsonl(
	documents: readonly NativeCorpusDocument[],
): string {
	return `${documents
		.map(({ docid, title, text }) => JSON.stringify({ docid, title, text }))
		.join("\n")}\n`;
}

export function sha256Text(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
