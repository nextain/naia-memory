import { createHash } from "node:crypto";
import {
	closeSync,
	fsyncSync,
	linkSync,
	mkdirSync,
	openSync,
	rmSync,
	writeSync,
} from "node:fs";
import { dirname } from "node:path";
import type { RankedQuery } from "./ranking-ab-analysis.js";

export interface EnglishPreflightVectorPassage {
	ordinal: number;
	docid: string;
	content: string;
}

export interface EnglishPreflightVectorObservation {
	dimensions: number;
	perItem: Float32Array;
	batchOrdered: Float32Array;
	batchOrderedRepeat: Float32Array;
	batchShuffledRestored: Float32Array;
}

function sha256(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function canonicalRows(
	passages: readonly EnglishPreflightVectorPassage[],
): string {
	return passages.map((passage) => `${JSON.stringify(passage)}\n`).join("");
}

function validateInput(input: {
	passages: readonly EnglishPreflightVectorPassage[];
	vectors: EnglishPreflightVectorObservation;
}): void {
	const { dimensions } = input.vectors;
	if (!Number.isSafeInteger(dimensions) || dimensions <= 0)
		throw new Error("English vector artifact dimensions are invalid");
	const ordinals = new Set<number>();
	const docids = new Set<string>();
	for (const passage of input.passages) {
		if (
			!Number.isSafeInteger(passage.ordinal) ||
			passage.ordinal < 0 ||
			!passage.docid ||
			typeof passage.content !== "string" ||
			ordinals.has(passage.ordinal) ||
			docids.has(passage.docid)
		)
			throw new Error("English vector artifact passage identity is invalid");
		ordinals.add(passage.ordinal);
		docids.add(passage.docid);
	}
	const expectedValues = input.passages.length * dimensions;
	for (const name of [
		"perItem",
		"batchOrdered",
		"batchOrderedRepeat",
		"batchShuffledRestored",
	] as const) {
		const values = input.vectors[name];
		if (
			!(values instanceof Float32Array) ||
			values.buffer instanceof SharedArrayBuffer ||
			values.length !== expectedValues ||
			values.some((value) => !Number.isFinite(value))
		)
			throw new Error(`English vector artifact ${name} values are invalid`);
	}
}

function* chunks(input: {
	passages: readonly EnglishPreflightVectorPassage[];
	vectors: EnglishPreflightVectorObservation;
}): Generator<string | Uint8Array> {
	yield `${JSON.stringify({
		artifactClass: "miracl-en-primary-f32-v1",
		dimensions: input.vectors.dimensions,
		documentCount: input.passages.length,
		passagesSha256: sha256(canonicalRows(input.passages)),
	})}\n`;
	for (const name of [
		"perItem",
		"batchOrdered",
		"batchOrderedRepeat",
		"batchShuffledRestored",
	] as const) {
		const values = input.vectors[name];
		yield `${name}\0${values.length}\0`;
		yield new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
	}
}

function hostIsLittleEndian(): boolean {
	return new Uint8Array(new Uint16Array([0x00ff]).buffer)[0] === 0xff;
}

export function englishPreflightVectorArtifactSha256(input: {
	passages: readonly EnglishPreflightVectorPassage[];
	vectors: EnglishPreflightVectorObservation;
}): string {
	if (!hostIsLittleEndian())
		throw new Error("English vector artifacts require little-endian IEEE-754");
	validateInput(input);
	const hash = createHash("sha256");
	for (const chunk of chunks(input)) hash.update(chunk);
	return hash.digest("hex");
}

function writeAllSync(descriptor: number, chunk: string | Uint8Array): void {
	const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
	let offset = 0;
	while (offset < bytes.byteLength) {
		const written = writeSync(
			descriptor,
			bytes,
			offset,
			bytes.byteLength - offset,
		);
		if (written <= 0) throw new Error("vector artifact write made no progress");
		offset += written;
	}
}

export function publishEnglishPreflightVectorArtifact(
	output: string,
	input: {
		passages: readonly EnglishPreflightVectorPassage[];
		vectors: EnglishPreflightVectorObservation;
	},
): string {
	if (!hostIsLittleEndian())
		throw new Error("English vector artifacts require little-endian IEEE-754");
	validateInput(input);
	mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
	const temporary = `${output}.${process.pid}.tmp`;
	let descriptor: number | undefined;
	try {
		descriptor = openSync(temporary, "wx", 0o600);
		for (const chunk of chunks(input)) writeAllSync(descriptor, chunk);
		fsyncSync(descriptor);
		closeSync(descriptor);
		descriptor = undefined;
		linkSync(temporary, output);
		const directory = openSync(dirname(output), "r");
		try {
			fsyncSync(directory);
		} finally {
			closeSync(directory);
		}
	} finally {
		if (descriptor !== undefined) closeSync(descriptor);
		rmSync(temporary, { force: true });
	}
	return englishPreflightVectorArtifactSha256(input);
}

export function rankEnglishPreflightCorpus(input: {
	queryId: string;
	query: readonly number[];
	corpusVectors: Float32Array;
	passages: readonly Pick<EnglishPreflightVectorPassage, "docid" | "ordinal">[];
	dimensions: number;
	limit?: number;
}): RankedQuery {
	const { query, corpusVectors, passages, dimensions } = input;
	if (
		!input.queryId ||
		!Number.isSafeInteger(dimensions) ||
		dimensions <= 0 ||
		query.length !== dimensions ||
		corpusVectors.buffer instanceof SharedArrayBuffer ||
		corpusVectors.length !== passages.length * dimensions ||
		query.some((value) => !Number.isFinite(value)) ||
		corpusVectors.some((value) => !Number.isFinite(value))
	)
		throw new Error("English exact-ranking vectors are invalid");
	const docids = new Set<string>();
	const ordinals = new Set<number>();
	for (const passage of passages) {
		if (
			!passage.docid ||
			!Number.isSafeInteger(passage.ordinal) ||
			passage.ordinal < 0 ||
			docids.has(passage.docid) ||
			ordinals.has(passage.ordinal)
		)
			throw new Error("English exact-ranking passage identity is invalid");
		docids.add(passage.docid);
		ordinals.add(passage.ordinal);
	}
	let queryNorm = 0;
	for (const value of query) queryNorm += value * value;
	if (!Number.isFinite(queryNorm) || !(queryNorm > 0))
		throw new Error("English query vector has invalid norm");
	const scored = passages.map((passage, row) => {
		let dot = 0;
		let norm = 0;
		for (let column = 0; column < dimensions; column += 1) {
			const value = corpusVectors[row * dimensions + column] as number;
			dot += (query[column] as number) * value;
			norm += value * value;
		}
		if (!Number.isFinite(norm) || !(norm > 0) || !Number.isFinite(dot))
			throw new Error("English retrieval vector has invalid norm");
		const score = dot / (Math.sqrt(queryNorm) * Math.sqrt(norm));
		if (!Number.isFinite(score))
			throw new Error("English retrieval score is not finite");
		return { docid: passage.docid, ordinal: passage.ordinal, score };
	});
	scored.sort(
		(left, right) =>
			right.score - left.score ||
			left.ordinal - right.ordinal ||
			(left.docid < right.docid ? -1 : left.docid > right.docid ? 1 : 0),
	);
	const limit = input.limit ?? 100;
	if (!Number.isSafeInteger(limit) || limit <= 0)
		throw new Error("English exact-ranking limit is invalid");
	return {
		queryId: input.queryId,
		ranking: scored.slice(0, limit).map(({ docid }) => docid),
	};
}
