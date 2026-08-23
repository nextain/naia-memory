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
import { parseMiraclSourceLockReceipt } from "./miracl-multilingual-download.js";
import type { NativeCorpusScanReceipt } from "./native-corpus-extract.js";

export interface MiraclCorpusIdentityReceipt {
	schemaVersion: 1;
	artifactClass: "corpus-identity-observation";
	claimBoundary: string;
	language: MiraclEvidenceLanguage;
	sourceLockSha256: string;
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
	shards: string[];
	expectedCompressedShards: { size: number; sha256: string }[];
} {
	const sourceLock = parseMiraclSourceLockReceipt(
		input.language,
		input.sourceReceipt,
	);
	return {
		sourceLockSha256: sourceLock.sourceLockSha256,
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
	sourceLockSha256: string;
	scan: NativeCorpusScanReceipt;
}): MiraclCorpusIdentityReceipt {
	if (!/^[a-f0-9]{64}$/.test(input.sourceLockSha256))
		throw new Error("source lock SHA-256 is invalid");
	if (
		!Number.isSafeInteger(input.scan.documentCount) ||
		input.scan.documentCount < 1
	)
		throw new Error("corpus document count is invalid");
	if (!/^[a-f0-9]{64}$/.test(input.scan.docidsSha256))
		throw new Error("corpus docid SHA-256 is invalid");
	return {
		schemaVersion: 1,
		artifactClass: "corpus-identity-observation",
		claimBoundary:
			"Source identity only; this observation contains no retrieval score, quality result, or multilingual comparison claim.",
		language: input.language,
		sourceLockSha256: input.sourceLockSha256,
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
