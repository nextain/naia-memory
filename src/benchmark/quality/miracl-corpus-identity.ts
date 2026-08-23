import { createHash } from "node:crypto";
import {
	linkSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { MiraclEvidenceLanguage } from "./miracl-multilingual-contract.js";
import {
	MIRACL_CORPUS_REVISION,
	MIRACL_DATASET_REVISION,
	MIRACL_MULTILINGUAL_CONTRACT,
} from "./miracl-multilingual-contract.js";
import {
	type miraclSourceLockReceipt,
	parseMiraclSourceLockReceipt,
} from "./miracl-multilingual-download.js";
import type { NativeCorpusScanReceipt } from "./native-corpus-extract.js";
import {
	type NativeRuntimeSourceManifest,
	validateNativeRuntimeSourceManifest,
} from "./native-runtime-source-manifest.js";

export interface MiraclCorpusIdentityReceipt {
	schemaVersion: 1;
	artifactClass: "corpus-identity-observation";
	claimBoundary: string;
	language: MiraclEvidenceLanguage;
	datasetRevision: typeof MIRACL_DATASET_REVISION;
	corpusRevision: typeof MIRACL_CORPUS_REVISION;
	corpusManifestSha256: string;
	corpusShardCount: number;
	compressedBytes: number;
	duplicateDocidCount: 0;
	docidHashCanonicalization: "utf8-docid-lf-v1";
	sourceLockSha256: string;
	sourceLock: ReturnType<typeof miraclSourceLockReceipt>;
	producerSourceManifest: NativeRuntimeSourceManifest;
	documentCount: number;
	docidsSha256: string;
}

export function canonicalMiraclCorpusIdentity(
	value: MiraclCorpusIdentityReceipt,
): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

export function prepareMiraclCorpusIdentityScan(input: {
	language: MiraclEvidenceLanguage;
	sourceRoot: string;
	sourceReceipt: unknown;
}): {
	sourceLockSha256: string;
	sourceLock: ReturnType<typeof miraclSourceLockReceipt>;
	shards: string[];
	expectedCompressedShards: { size: number; sha256: string }[];
} {
	const sourceLock = parseMiraclSourceLockReceipt(
		input.language,
		input.sourceReceipt,
	);
	return {
		sourceLockSha256: sourceLock.sourceLockSha256,
		sourceLock,
		shards: miraclCorpusShardPaths(input.sourceRoot, sourceLock.files),
		expectedCompressedShards: sourceLock.files
			.slice(2)
			.map(({ size, sha256 }) => ({ size, sha256 })),
	};
}

export function miraclCorpusShardPaths(
	sourceRoot: string,
	files: readonly { path: string }[],
): string[] {
	return files.slice(2).map((file) => join(sourceRoot, file.path));
}

export function buildMiraclCorpusIdentityReceipt(input: {
	language: MiraclEvidenceLanguage;
	sourceLock: ReturnType<typeof miraclSourceLockReceipt>;
	producerSourceManifest: NativeRuntimeSourceManifest;
	scan: NativeCorpusScanReceipt;
}): MiraclCorpusIdentityReceipt {
	const sourceLock = parseMiraclSourceLockReceipt(
		input.language,
		input.sourceLock,
	);
	validateNativeRuntimeSourceManifest(input.producerSourceManifest);
	if (
		!Number.isSafeInteger(input.scan.documentCount) ||
		input.scan.documentCount < 1
	)
		throw new Error("corpus document count is invalid");
	if (!/^[a-f0-9]{64}$/.test(input.scan.docidsSha256))
		throw new Error("corpus docid SHA-256 is invalid");
	const contract = MIRACL_MULTILINGUAL_CONTRACT[input.language];
	if (
		sourceLock.sourceLockSha256 !==
			contract.corpus.expectedSourceReceiptSha256 ||
		input.scan.documentCount !== contract.corpus.expectedDocumentCount ||
		input.scan.docidsSha256 !== contract.corpus.expectedDocidsSha256
	)
		throw new Error("corpus identity does not match the locked contract");
	if (
		input.scan.compressedShardCount !== contract.corpus.shardCount ||
		input.scan.duplicateDocidCount !== 0
	)
		throw new Error("corpus scan verification is incomplete");
	const expectedCompressedBytes = sourceLock.files
		.slice(2)
		.reduce((total, file) => total + file.size, 0);
	if (input.scan.compressedBytes !== expectedCompressedBytes)
		throw new Error("corpus compressed byte count mismatch");
	return {
		schemaVersion: 1,
		artifactClass: "corpus-identity-observation",
		claimBoundary:
			"Source identity only; this observation contains no retrieval score, quality result, or multilingual comparison claim.",
		language: input.language,
		datasetRevision: MIRACL_DATASET_REVISION,
		corpusRevision: MIRACL_CORPUS_REVISION,
		corpusManifestSha256: contract.corpus.manifestSha256,
		corpusShardCount: input.scan.compressedShardCount,
		compressedBytes: input.scan.compressedBytes,
		duplicateDocidCount: input.scan.duplicateDocidCount,
		docidHashCanonicalization: "utf8-docid-lf-v1",
		sourceLockSha256: sourceLock.sourceLockSha256,
		sourceLock,
		producerSourceManifest: input.producerSourceManifest,
		documentCount: input.scan.documentCount,
		docidsSha256: input.scan.docidsSha256,
	};
}

export function sha256MiraclCorpusIdentity(
	receipt: MiraclCorpusIdentityReceipt,
): string {
	return createHash("sha256")
		.update(canonicalMiraclCorpusIdentity(receipt))
		.digest("hex");
}

export function readMiraclSourceReceipt(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as unknown;
	} catch {
		throw new Error("MIRACL source receipt is missing or invalid JSON");
	}
}

export function publishMiraclCorpusIdentity(
	output: string,
	receipt: MiraclCorpusIdentityReceipt,
	processId = process.pid,
): void {
	mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
	const temporary = `${output}.${processId}.tmp`;
	try {
		writeFileSync(temporary, canonicalMiraclCorpusIdentity(receipt), {
			flag: "wx",
			mode: 0o600,
		});
		linkSync(temporary, output);
	} finally {
		rmSync(temporary, { force: true });
	}
}
