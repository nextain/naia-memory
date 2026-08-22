import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";

export interface NativeCorpusDocument {
	docid: string;
	title: string;
	text: string;
}

export async function extractNativeCorpusDocuments(
	shards: readonly string[],
	requiredDocumentIds: ReadonlySet<string>,
): Promise<NativeCorpusDocument[]> {
	const found = new Map<string, NativeCorpusDocument>();
	for (const shard of shards) {
		const lines = createInterface({
			input: createReadStream(shard).pipe(createGunzip()),
			crlfDelay: Number.POSITIVE_INFINITY,
		});
		let lineNumber = 0;
		for await (const line of lines) {
			lineNumber++;
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				throw new Error(`${shard}:${lineNumber}: invalid JSON`);
			}
			if (!isNativeCorpusDocument(parsed))
				throw new Error(`${shard}:${lineNumber}: invalid MIRACL document`);
			if (!requiredDocumentIds.has(parsed.docid)) continue;
			if (found.has(parsed.docid))
				throw new Error(`duplicate required document: ${parsed.docid}`);
			found.set(parsed.docid, parsed);
		}
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
