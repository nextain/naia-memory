import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	loadFullCorpusChunk,
	recoverIncompleteFullCorpusChunk,
	saveFullCorpusChunk,
	verifyFullCorpusCheckpointChain,
} from "./native-full-corpus-checkpoint.js";

const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

describe("native full-corpus checkpoint", () => {
	const identity = {
		sourceLockSha256: "source-a",
		embeddingPolicySha256: "policy-a",
		dimensions: 2,
		startOrdinal: 0,
		documentCount: 2,
	};

	it("round-trips a hash-chained vector chunk", () => {
		const directory = mkdtempSync(join(tmpdir(), "naia-full-corpus-"));
		directories.push(directory);
		const saved = saveFullCorpusChunk({
			directory,
			identity,
			docids: ["a", "b"],
			vectors: new Float32Array([1, 2, 3, 4]),
			previousReceiptSha256: null,
		});
		const loaded = loadFullCorpusChunk({
			directory,
			identity,
			expectedPreviousReceiptSha256: null,
		});
		expect(loaded?.docids).toEqual(["a", "b"]);
		expect(Array.from(loaded?.vectors ?? [])).toEqual([1, 2, 3, 4]);
		expect(loaded?.receiptSha256).toBe(saved.receiptSha256);
	});

	it("rejects a broken chain, corruption, and partial output", () => {
		const directory = mkdtempSync(join(tmpdir(), "naia-full-corpus-"));
		directories.push(directory);
		saveFullCorpusChunk({
			directory,
			identity,
			docids: ["a", "b"],
			vectors: new Float32Array([1, 2, 3, 4]),
			previousReceiptSha256: null,
		});
		expect(() =>
			loadFullCorpusChunk({
				directory,
				identity,
				expectedPreviousReceiptSha256: "wrong",
			}),
		).toThrow("identity mismatch");
		const vectorsPath = join(directory, "chunk-000000000.f32");
		const bytes = readFileSync(vectorsPath);
		bytes[0] ^= 0xff;
		writeFileSync(vectorsPath, bytes);
		expect(() =>
			loadFullCorpusChunk({
				directory,
				identity,
				expectedPreviousReceiptSha256: null,
			}),
		).toThrow("content mismatch");
	});

	it("recovers only uncommitted data files", () => {
		const directory = mkdtempSync(join(tmpdir(), "naia-full-corpus-"));
		directories.push(directory);
		const vectorsPath = join(directory, "chunk-000000000.f32");
		writeFileSync(vectorsPath, "partial");
		expect(
			recoverIncompleteFullCorpusChunk({ directory, startOrdinal: 0 }),
		).toBe(true);
		expect(
			loadFullCorpusChunk({
				directory,
				identity,
				expectedPreviousReceiptSha256: null,
			}),
		).toBeNull();

		saveFullCorpusChunk({
			directory,
			identity,
			docids: ["a", "b"],
			vectors: new Float32Array([1, 2, 3, 4]),
			previousReceiptSha256: null,
		});
		expect(
			recoverIncompleteFullCorpusChunk({ directory, startOrdinal: 0 }),
		).toBe(false);
		expect(readFileSync(vectorsPath).byteLength).toBe(16);
	});

	it("refuses overwrite and malformed vector shapes", () => {
		const directory = mkdtempSync(join(tmpdir(), "naia-full-corpus-"));
		directories.push(directory);
		const input = {
			directory,
			identity,
			docids: ["a", "b"],
			vectors: new Float32Array([1, 2, 3, 4]),
			previousReceiptSha256: null,
		};
		saveFullCorpusChunk(input);
		expect(() => saveFullCorpusChunk(input)).toThrow("already exists");
		const malformedDirectory = mkdtempSync(join(tmpdir(), "naia-full-corpus-"));
		directories.push(malformedDirectory);
		expect(() =>
			saveFullCorpusChunk({
				...input,
				directory: malformedDirectory,
				vectors: new Float32Array([1]),
			}),
		).toThrow("vector shape mismatch");
	});

	it("verifies every byte and terminal of a complete checkpoint chain", () => {
		const directory = mkdtempSync(join(tmpdir(), "naia-full-corpus-"));
		directories.push(directory);
		const first = saveFullCorpusChunk({
			directory,
			identity,
			docids: ["a", "b"],
			vectors: new Float32Array([1, 2, 3, 4]),
			previousReceiptSha256: null,
		});
		const second = saveFullCorpusChunk({
			directory,
			identity: { ...identity, startOrdinal: 2, documentCount: 1 },
			docids: ["c"],
			vectors: new Float32Array([5, 6]),
			previousReceiptSha256: first.receiptSha256,
		});
		const evidence = verifyFullCorpusCheckpointChain({
			directory,
			sourceLockSha256: "source-a",
			embeddingPolicySha256: "policy-a",
			dimensions: 2,
			documentCount: 3,
			chunkSize: 2,
			docidsSha256:
				"880553fca8fcea94e325ee2cfb48e5a985cc797f39a14cc6d3cedecfeb2ae4d2",
			lastChunkReceiptSha256: second.receiptSha256,
		});
		expect(evidence).toMatchObject({ chunkCount: 2, documentCount: 3 });
		expect(() =>
			verifyFullCorpusCheckpointChain({
				...evidence,
				sourceLockSha256: "source-a",
				embeddingPolicySha256: "policy-a",
				dimensions: 2,
				chunkSize: 2,
				docidsSha256: evidence.docidsSha256,
				lastChunkReceiptSha256: "substituted",
			}),
		).toThrow("terminal mismatch");
	});
});
