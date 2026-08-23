import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildMiraclCorpusIdentityReceipt,
	canonicalMiraclCorpusIdentity,
	miraclCorpusShardPaths,
	prepareMiraclCorpusIdentityScan,
	publishMiraclCorpusIdentity,
	sha256MiraclCorpusIdentity,
} from "./miracl-corpus-identity.js";
import { MIRACL_MULTILINGUAL_CONTRACT } from "./miracl-multilingual-contract.js";
import { miraclSourceLockReceipt } from "./miracl-multilingual-download.js";
import { MIRACL_KO_LOCK } from "./public-miracl-source.js";

const koSourceLock = () => {
	return miraclSourceLockReceipt(
		"ko",
		MIRACL_KO_LOCK.files.map((file, index) => ({
			...file,
			provider: index < 2 ? ("dataset" as const) : ("corpus" as const),
		})),
	);
};

const producerSourceManifest = () => {
	const payload = {
		schemaVersion: "naia-native-runtime-source-manifest-v1" as const,
		entryPoint: "src/benchmark/quality/miracl-corpus-identity-cli.ts",
		additionalInputs: ["pnpm-lock.yaml"],
		files: [{ path: "pnpm-lock.yaml", sha256: "c".repeat(64) }],
	};
	return {
		...payload,
		manifestSha256: createHash("sha256")
			.update(`${JSON.stringify(payload)}\n`)
			.digest("hex"),
	};
};

const lockedKoScan = () => ({
	documentCount: MIRACL_MULTILINGUAL_CONTRACT.ko.corpus.expectedDocumentCount,
	docidsSha256: MIRACL_MULTILINGUAL_CONTRACT.ko.corpus.expectedDocidsSha256,
	compressedShardCount: MIRACL_MULTILINGUAL_CONTRACT.ko.corpus.shardCount,
	compressedBytes: MIRACL_KO_LOCK.files
		.slice(2)
		.reduce((total, file) => total + file.size, 0),
	duplicateDocidCount: 0 as const,
});

describe("MIRACL corpus identity qualification", () => {
	it("preserves the lexical order used by the 66-shard English receipt", () => {
		const contract = MIRACL_MULTILINGUAL_CONTRACT.en;
		const corpus = Array.from({ length: 66 }, (_, index) => ({
			path: `${contract.corpus.directory}/docs-${index}.jsonl.gz`,
		})).sort((left, right) =>
			left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
		);
		const shards = miraclCorpusShardPaths("/source", [
			contract.topics,
			contract.qrels,
			...corpus,
		]);
		expect(shards).toHaveLength(66);
		expect(shards.slice(0, 4)).toEqual([
			"/source/miracl-corpus-v1.0-en/docs-0.jsonl.gz",
			"/source/miracl-corpus-v1.0-en/docs-1.jsonl.gz",
			"/source/miracl-corpus-v1.0-en/docs-10.jsonl.gz",
			"/source/miracl-corpus-v1.0-en/docs-11.jsonl.gz",
		]);
		expect(shards.at(-1)).toBe("/source/miracl-corpus-v1.0-en/docs-9.jsonl.gz");
	});

	it("rejects cross-language source substitution", () => {
		expect(() =>
			prepareMiraclCorpusIdentityScan({
				language: "en",
				sourceRoot: "/source",
				sourceReceipt: { schemaVersion: 1, language: "ar" },
			}),
		).toThrow("MIRACL-en source receipt header mismatch");
	});

	it("pairs every parsed shard path with its compressed source lock", () => {
		const files = MIRACL_KO_LOCK.files.map((file, index) => ({
			...file,
			provider: index < 2 ? ("dataset" as const) : ("corpus" as const),
		}));
		const prepared = prepareMiraclCorpusIdentityScan({
			language: "ko",
			sourceRoot: "/source",
			sourceReceipt: miraclSourceLockReceipt("ko", files),
		});
		expect(prepared.shards).toEqual(
			MIRACL_KO_LOCK.files.slice(2).map((file) => join("/source", file.path)),
		);
		expect(prepared.expectedCompressedShards).toEqual(
			MIRACL_KO_LOCK.files
				.slice(2)
				.map(({ size, sha256 }) => ({ size, sha256 })),
		);
	});

	it("publishes a deterministic non-quality observation", () => {
		const receipt = buildMiraclCorpusIdentityReceipt({
			language: "ko",
			sourceLock: koSourceLock(),
			producerSourceManifest: producerSourceManifest(),
			scan: lockedKoScan(),
		});
		expect(receipt.claimBoundary).toContain("no retrieval score");
		expect(canonicalMiraclCorpusIdentity(receipt)).toMatch(/\n$/);
		expect(sha256MiraclCorpusIdentity(receipt)).toMatch(/^[a-f0-9]{64}$/);
	});

	it("rejects malformed scan identities", () => {
		expect(() =>
			buildMiraclCorpusIdentityReceipt({
				language: "ko",
				sourceLock: koSourceLock(),
				producerSourceManifest: producerSourceManifest(),
				scan: { ...lockedKoScan(), documentCount: 0 },
			}),
		).toThrow("document count");
	});

	it("rejects an internally inconsistent source receipt", () => {
		expect(() =>
			buildMiraclCorpusIdentityReceipt({
				language: "ko",
				sourceLock: { ...koSourceLock(), sourceLockSha256: "0".repeat(64) },
				producerSourceManifest: producerSourceManifest(),
				scan: lockedKoScan(),
			}),
		).toThrow("source receipt digest mismatch");
	});

	it("rejects an internally inconsistent producer manifest", () => {
		expect(() =>
			buildMiraclCorpusIdentityReceipt({
				language: "ko",
				sourceLock: koSourceLock(),
				producerSourceManifest: {
					...producerSourceManifest(),
					manifestSha256: "0".repeat(64),
				},
				scan: lockedKoScan(),
			}),
		).toThrow("internally inconsistent");
	});

	it("rejects a scan identity that differs from the locked contract", () => {
		expect(() =>
			buildMiraclCorpusIdentityReceipt({
				language: "ko",
				sourceLock: koSourceLock(),
				producerSourceManifest: producerSourceManifest(),
				scan: { ...lockedKoScan(), docidsSha256: "b".repeat(64) },
			}),
		).toThrow("locked contract");
	});

	it("publishes once without clobbering evidence and removes its temporary", () => {
		const directory = mkdtempSync(join(tmpdir(), "naia-corpus-identity-"));
		const output = join(directory, "identity.json");
		const receipt = buildMiraclCorpusIdentityReceipt({
			language: "ko",
			sourceLock: koSourceLock(),
			producerSourceManifest: producerSourceManifest(),
			scan: lockedKoScan(),
		});
		publishMiraclCorpusIdentity(output, receipt, 42);
		const published = readFileSync(output, "utf8");
		expect(() => publishMiraclCorpusIdentity(output, receipt, 43)).toThrow(
			"EEXIST",
		);
		expect(readFileSync(output, "utf8")).toBe(published);
		expect(existsSync(`${output}.42.tmp`)).toBe(false);
		expect(existsSync(`${output}.43.tmp`)).toBe(false);
	});
});
