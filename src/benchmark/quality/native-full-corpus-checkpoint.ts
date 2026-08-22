import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

export interface FullCorpusChunkIdentity {
	sourceLockSha256: string;
	embeddingPolicySha256: string;
	dimensions: number;
	startOrdinal: number;
	documentCount: number;
}

export interface FullCorpusChunkReceipt extends FullCorpusChunkIdentity {
	schemaVersion: 1;
	docidsSha256: string;
	vectorsSha256: string;
	previousReceiptSha256: string | null;
}

function sha256(value: Uint8Array | string): string {
	return createHash("sha256").update(value).digest("hex");
}

function canonicalReceipt(receipt: FullCorpusChunkReceipt): string {
	return `${JSON.stringify(receipt, null, 2)}\n`;
}

function chunkPrefix(directory: string, startOrdinal: number): string {
	return join(directory, `chunk-${String(startOrdinal).padStart(9, "0")}`);
}

export function recoverIncompleteFullCorpusChunk(options: {
	directory: string;
	startOrdinal: number;
}): boolean {
	if (!Number.isSafeInteger(options.startOrdinal) || options.startOrdinal < 0)
		throw new Error("invalid full-corpus chunk ordinal");
	const prefix = chunkPrefix(options.directory, options.startOrdinal);
	const vectorsPath = `${prefix}.f32`;
	const docidsPath = `${prefix}.docids`;
	const receiptPath = `${prefix}.receipt.json`;
	if (existsSync(receiptPath)) return false;
	const partialPaths = [vectorsPath, docidsPath].filter(existsSync);
	for (const path of partialPaths) rmSync(path);
	return partialPaths.length > 0;
}

export function saveFullCorpusChunk(options: {
	directory: string;
	identity: FullCorpusChunkIdentity;
	docids: readonly string[];
	vectors: Float32Array;
	previousReceiptSha256: string | null;
}): { receipt: FullCorpusChunkReceipt; receiptSha256: string } {
	const { identity } = options;
	if (
		!Number.isSafeInteger(identity.startOrdinal) ||
		identity.startOrdinal < 0 ||
		!Number.isSafeInteger(identity.documentCount) ||
		identity.documentCount < 1 ||
		!Number.isSafeInteger(identity.dimensions) ||
		identity.dimensions < 1
	)
		throw new Error("invalid full-corpus chunk shape");
	if (options.docids.length !== identity.documentCount)
		throw new Error("full-corpus chunk docid count mismatch");
	if (new Set(options.docids).size !== options.docids.length)
		throw new Error("full-corpus chunk contains duplicate docids");
	if (options.vectors.length !== identity.documentCount * identity.dimensions)
		throw new Error("full-corpus chunk vector shape mismatch");
	if (options.vectors.some((value) => !Number.isFinite(value)))
		throw new Error("full-corpus chunk contains a non-finite vector");

	mkdirSync(options.directory, { recursive: true, mode: 0o700 });
	const prefix = chunkPrefix(options.directory, identity.startOrdinal);
	const vectorsPath = `${prefix}.f32`;
	const docidsPath = `${prefix}.docids`;
	const receiptPath = `${prefix}.receipt.json`;
	if (
		existsSync(vectorsPath) ||
		existsSync(docidsPath) ||
		existsSync(receiptPath)
	)
		throw new Error("full-corpus chunk output already exists");

	const vectorBytes = Buffer.from(
		options.vectors.buffer,
		options.vectors.byteOffset,
		options.vectors.byteLength,
	);
	const docidsText = `${options.docids.join("\n")}\n`;
	const receipt: FullCorpusChunkReceipt = {
		schemaVersion: 1,
		...identity,
		docidsSha256: sha256(docidsText),
		vectorsSha256: sha256(vectorBytes),
		previousReceiptSha256: options.previousReceiptSha256,
	};
	const receiptText = canonicalReceipt(receipt);
	for (const [path, contents] of [
		[vectorsPath, vectorBytes],
		[docidsPath, docidsText],
		[receiptPath, receiptText],
	] as const) {
		const temporary = `${path}.${process.pid}.tmp`;
		writeFileSync(temporary, contents, { mode: 0o600 });
		renameSync(temporary, path);
	}
	return { receipt, receiptSha256: sha256(receiptText) };
}

export function loadFullCorpusChunk(options: {
	directory: string;
	identity: FullCorpusChunkIdentity;
	expectedPreviousReceiptSha256: string | null;
}): {
	docids: string[];
	vectors: Float32Array;
	receipt: FullCorpusChunkReceipt;
	receiptSha256: string;
} | null {
	const prefix = chunkPrefix(options.directory, options.identity.startOrdinal);
	const vectorsPath = `${prefix}.f32`;
	const docidsPath = `${prefix}.docids`;
	const receiptPath = `${prefix}.receipt.json`;
	if (
		!existsSync(vectorsPath) &&
		!existsSync(docidsPath) &&
		!existsSync(receiptPath)
	)
		return null;
	if (
		!existsSync(vectorsPath) ||
		!existsSync(docidsPath) ||
		!existsSync(receiptPath)
	)
		throw new Error("incomplete full-corpus checkpoint chunk");
	const receiptText = readFileSync(receiptPath, "utf8");
	const receipt = JSON.parse(receiptText) as FullCorpusChunkReceipt;
	if (
		receipt.schemaVersion !== 1 ||
		Object.entries(options.identity).some(
			([key, value]) => receipt[key as keyof FullCorpusChunkReceipt] !== value,
		) ||
		receipt.previousReceiptSha256 !== options.expectedPreviousReceiptSha256
	)
		throw new Error("full-corpus checkpoint identity mismatch");
	const docidsText = readFileSync(docidsPath, "utf8");
	const docids = docidsText.slice(0, -1).split("\n");
	const vectorBytes = readFileSync(vectorsPath);
	if (
		!docidsText.endsWith("\n") ||
		docids.length !== receipt.documentCount ||
		new Set(docids).size !== docids.length ||
		sha256(docidsText) !== receipt.docidsSha256 ||
		vectorBytes.byteLength !== receipt.documentCount * receipt.dimensions * 4 ||
		sha256(vectorBytes) !== receipt.vectorsSha256
	)
		throw new Error("full-corpus checkpoint content mismatch");
	const vectors = new Float32Array(receipt.documentCount * receipt.dimensions);
	new Uint8Array(vectors.buffer).set(vectorBytes);
	if (vectors.some((value) => !Number.isFinite(value)))
		throw new Error("full-corpus checkpoint contains a non-finite vector");
	return {
		docids,
		vectors,
		receipt,
		receiptSha256: sha256(receiptText),
	};
}
