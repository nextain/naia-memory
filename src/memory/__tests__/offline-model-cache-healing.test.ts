import { mkdir, mkdtemp, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

let mockCacheDir = "";
let mockUseFSCache: boolean | undefined = true;
let pipelineCallCount = 0;
let pipelineImpl: (task: string, model: string, opts: any) => Promise<any>;

vi.mock("@huggingface/transformers", () => {
	return {
		get env() {
			return {
				cacheDir: mockCacheDir,
				useFSCache: mockUseFSCache,
			};
		},
		pipeline: (task: string, model: string, opts: any) => {
			pipelineCallCount++;
			return pipelineImpl(task, model, opts);
		},
	};
});

import {
	CORRUPT_MODEL_ERROR_PATTERNS,
	OFFLINE_MODEL_FILE_BYTES,
	OFFLINE_MODEL_REVISIONS,
	OfflineEmbeddingProvider,
	isCorruptModelError,
	purgeTruncatedModelCache,
} from "../embeddings.js";

describe("OfflineEmbeddingProvider self-healing model cache (FR-MEM-EMBED-HEAL-1..3, #681)", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((dir) =>
				rm(dir, { recursive: true, force: true }),
			),
		);
		pipelineCallCount = 0;
		mockCacheDir = "";
		mockUseFSCache = true;
	});

	it("identifies corrupt model error patterns correctly", () => {
		expect(isCorruptModelError(new Error("Protobuf parsing failed"))).toBe(true);
		expect(isCorruptModelError(new Error("invalid model format"))).toBe(true);
		expect(isCorruptModelError(new Error("Invalid model file"))).toBe(true);
		expect(isCorruptModelError(new Error("failed to load model weights"))).toBe(true);
		expect(
			isCorruptModelError(
				new Error("Load model from /path/model.onnx failed: unexpected error"),
			),
		).toBe(true);
		expect(isCorruptModelError(new Error("unexpected end of file"))).toBe(true);
		expect(isCorruptModelError(new Error("Unexpected end of data"))).toBe(true);
		expect(isCorruptModelError(new Error("getaddrinfo ENOTFOUND huggingface.co"))).toBe(false);
		expect(isCorruptModelError(new Error("connection reset by peer"))).toBe(false);
	});

	it("pre-flight deletes when the pinned file exists with the wrong size, then create is called once and succeeds", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "naia-preflight-wrong-size-"));
		tempDirs.push(tempDir);
		mockCacheDir = tempDir;
		mockUseFSCache = true;
		pipelineCallCount = 0;

		const modelName = "all-MiniLM-L6-v2";
		const revision = OFFLINE_MODEL_REVISIONS[modelName];
		const modelDir = join(tempDir, "Xenova", modelName, revision);
		await mkdir(join(modelDir, "onnx"), { recursive: true });
		const truncatedFile = join(modelDir, OFFLINE_MODEL_FILE_BYTES[modelName].file);
		// Write truncated file (wrong size)
		await writeFile(truncatedFile, "truncated-content-wrong-size");

		pipelineImpl = async () => {
			return async () => ({
				data: new Float32Array(384).fill(0.123),
			});
		};

		const provider = new OfflineEmbeddingProvider(modelName);
		const vector = await provider.embed("hello");

		expect(pipelineCallCount).toBe(1);
		expect(vector).toHaveLength(384);
		expect(vector[0]).toBeCloseTo(0.123);
		// The truncated file should have been deleted by pre-flight
		await expect(stat(truncatedFile)).rejects.toThrow();
	});

	it("pre-flight keeps a file whose size equals the pinned size", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "naia-preflight-exact-size-"));
		tempDirs.push(tempDir);
		mockCacheDir = tempDir;
		mockUseFSCache = true;
		pipelineCallCount = 0;

		const modelName = "all-MiniLM-L6-v2";
		const revision = OFFLINE_MODEL_REVISIONS[modelName];
		const modelDir = join(tempDir, "Xenova", modelName, revision);
		await mkdir(join(modelDir, "onnx"), { recursive: true });
		const file = join(modelDir, OFFLINE_MODEL_FILE_BYTES[modelName].file);
		await writeFile(file, "");
		await truncate(file, OFFLINE_MODEL_FILE_BYTES[modelName].bytes);

		const sBefore = await stat(file);
		expect(sBefore.size).toBe(OFFLINE_MODEL_FILE_BYTES[modelName].bytes);

		pipelineImpl = async () => {
			return async () => ({
				data: new Float32Array(384).fill(0.456),
			});
		};

		const provider = new OfflineEmbeddingProvider(modelName);
		const vector = await provider.embed("hello");

		expect(pipelineCallCount).toBe(1);
		expect(vector).toHaveLength(384);
		const sAfter = await stat(file);
		expect(sAfter.size).toBe(OFFLINE_MODEL_FILE_BYTES[modelName].bytes);
	});

	it("pre-flight does nothing when the file is missing", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "naia-preflight-missing-"));
		tempDirs.push(tempDir);
		mockCacheDir = tempDir;
		mockUseFSCache = true;
		pipelineCallCount = 0;

		const modelName = "all-MiniLM-L6-v2";
		const revision = OFFLINE_MODEL_REVISIONS[modelName];

		const purged = await purgeTruncatedModelCache(
			{ cacheDir: tempDir, useFSCache: true },
			modelName,
			revision,
		);
		expect(purged).toBe(false);

		pipelineImpl = async () => {
			return async () => ({
				data: new Float32Array(384).fill(0.789),
			});
		};

		const provider = new OfflineEmbeddingProvider(modelName);
		const vector = await provider.embed("hello");

		expect(pipelineCallCount).toBe(1);
		expect(vector).toHaveLength(384);
	});

	it("pre-flight does nothing for a non-pinned revision even if sizes differ", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "naia-preflight-custom-rev-"));
		tempDirs.push(tempDir);
		mockCacheDir = tempDir;
		mockUseFSCache = true;
		pipelineCallCount = 0;

		const modelName = "all-MiniLM-L6-v2";
		const customRev = "custom-revision-12345";
		const modelDir = join(tempDir, "Xenova", modelName, customRev);
		await mkdir(join(modelDir, "onnx"), { recursive: true });
		const file = join(modelDir, OFFLINE_MODEL_FILE_BYTES[modelName].file);
		await writeFile(file, "some-different-size-bytes");

		const purged = await purgeTruncatedModelCache(
			{ cacheDir: tempDir, useFSCache: true },
			modelName,
			customRev,
		);
		expect(purged).toBe(false);

		pipelineImpl = async () => {
			return async () => ({
				data: new Float32Array(384).fill(0.1),
			});
		};

		const provider = new OfflineEmbeddingProvider(
			modelName,
			undefined,
			customRev,
		);
		await provider.embed("hello");

		expect(pipelineCallCount).toBe(1);
		// File must still exist
		await expect(stat(file)).resolves.toBeDefined();
	});

	it("pre-flight guard: empty cacheDir / useFSCache=false → nothing deleted", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "naia-preflight-guard-"));
		tempDirs.push(tempDir);

		const modelName = "all-MiniLM-L6-v2";
		const revision = OFFLINE_MODEL_REVISIONS[modelName];
		const modelDir = join(tempDir, "Xenova", modelName, revision);
		await mkdir(join(modelDir, "onnx"), { recursive: true });
		const file = join(modelDir, OFFLINE_MODEL_FILE_BYTES[modelName].file);
		await writeFile(file, "different-size");

		// Test empty cacheDir
		const purgedEmpty = await purgeTruncatedModelCache(
			{ cacheDir: "", useFSCache: true },
			modelName,
			revision,
		);
		expect(purgedEmpty).toBe(false);
		await expect(stat(file)).resolves.toBeDefined();

		// Test useFSCache = false
		const purgedNoFS = await purgeTruncatedModelCache(
			{ cacheDir: tempDir, useFSCache: false },
			modelName,
			revision,
		);
		expect(purgedNoFS).toBe(false);
		await expect(stat(file)).resolves.toBeDefined();
	});

	it("post-load corrupt error: pipeline throws Protobuf parsing failed once → embed rejects with restart notice, model dir deleted, 1 call", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "naia-postload-corrupt-"));
		tempDirs.push(tempDir);
		mockCacheDir = tempDir;
		mockUseFSCache = true;
		pipelineCallCount = 0;

		const modelName = "all-MiniLM-L6-v2";
		const revision = OFFLINE_MODEL_REVISIONS[modelName];
		const modelDir = join(tempDir, "Xenova", modelName, revision);
		await mkdir(modelDir, { recursive: true });
		const canary = join(modelDir, "canary.bin");
		await writeFile(canary, "corrupt-state");

		pipelineImpl = async () => {
			throw new Error("Load model from model.onnx failed:Protobuf parsing failed.");
		};

		const provider = new OfflineEmbeddingProvider(modelName);

		let capturedError: any = null;
		try {
			await provider.embed("hello");
		} catch (err) {
			capturedError = err;
		}

		expect(capturedError).toBeInstanceOf(Error);
		expect(capturedError.message).toContain("restart the process");
		expect(capturedError.message).toContain("Protobuf parsing failed");
		expect(capturedError.cause).toBeDefined();
		expect(pipelineCallCount).toBe(1);
		// Model dir must be deleted
		await expect(stat(modelDir)).rejects.toThrow();

		// Clearing initPromise: second embed attempt calls pipeline again (pipelineCallCount becomes 2)
		try {
			await provider.embed("hello again");
		} catch {
			// Expected to fail again
		}
		expect(pipelineCallCount).toBe(2);
	});

	it("non-corrupt error: rethrown unchanged, nothing deleted, 1 call", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "naia-noncorrupt-"));
		tempDirs.push(tempDir);
		mockCacheDir = tempDir;
		mockUseFSCache = true;
		pipelineCallCount = 0;

		const modelName = "all-MiniLM-L6-v2";
		const revision = OFFLINE_MODEL_REVISIONS[modelName];
		const modelDir = join(tempDir, "Xenova", modelName, revision);
		await mkdir(modelDir, { recursive: true });
		const file = join(modelDir, "data.bin");
		await writeFile(file, "important");

		pipelineImpl = async () => {
			throw new Error("getaddrinfo ENOTFOUND huggingface.co");
		};

		const provider = new OfflineEmbeddingProvider(modelName);
		await expect(provider.embed("query")).rejects.toThrow("ENOTFOUND");

		expect(pipelineCallCount).toBe(1);
		await expect(stat(file)).resolves.toBeDefined();
	});

	it("guards deletion on post-load error: does not delete when cacheDir is empty", async () => {
		mockCacheDir = "";
		mockUseFSCache = true;
		pipelineCallCount = 0;

		pipelineImpl = async () => {
			throw new Error("Protobuf parsing failed");
		};

		const provider = new OfflineEmbeddingProvider();
		await expect(provider.embed("query")).rejects.toThrow("Protobuf parsing failed");
		expect(pipelineCallCount).toBe(1);
	});

	it("guards deletion on post-load error: does not delete when useFSCache is false", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "naia-postload-guard-usefs-"));
		tempDirs.push(tempDir);
		mockCacheDir = tempDir;
		mockUseFSCache = false;
		pipelineCallCount = 0;

		const modelName = "all-MiniLM-L6-v2";
		const revision = OFFLINE_MODEL_REVISIONS[modelName];
		const modelDir = join(tempDir, "Xenova", modelName, revision);
		await mkdir(modelDir, { recursive: true });
		const canary = join(modelDir, "canary.bin");
		await writeFile(canary, "preserved");

		pipelineImpl = async () => {
			throw new Error("Protobuf parsing failed");
		};

		const provider = new OfflineEmbeddingProvider(modelName);
		await expect(provider.embed("query")).rejects.toThrow("Protobuf parsing failed");
		expect(pipelineCallCount).toBe(1);
		await expect(stat(canary)).resolves.toBeDefined();
	});
});
