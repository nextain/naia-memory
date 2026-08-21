import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	loadVectorCache,
	saveVectorCache,
	vectorCacheKey,
} from "./hnsw-vector-cache.js";

const directories: string[] = [];

afterEach(() => {
	for (const directory of directories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("HNSW vector cache", () => {
	it("round-trips vectors only for an exact corpus and embedding identity", () => {
		const directory = mkdtempSync(join(tmpdir(), "naia-hnsw-cache-"));
		directories.push(directory);
		const identity = {
			directory,
			language: "ko",
			corpusSha256: "corpus-a",
			embeddingSpaceId: "space-a",
			dims: 2,
			vectorCount: 2,
		};
		saveVectorCache({ ...identity, vectors: new Float32Array([1, 2, 3, 4]) });
		expect(Array.from(loadVectorCache(identity) ?? [])).toEqual([1, 2, 3, 4]);
		expect(
			loadVectorCache({ ...identity, corpusSha256: "corpus-b" }),
		).toBeNull();
	});

	it("derives stable keys from the full identity", () => {
		const identity = {
			corpusSha256: "a",
			embeddingSpaceId: "b",
			dims: 1024,
		};
		expect(vectorCacheKey(identity)).toBe(vectorCacheKey(identity));
		expect(vectorCacheKey({ ...identity, dims: 384 })).not.toBe(
			vectorCacheKey(identity),
		);
	});
});
