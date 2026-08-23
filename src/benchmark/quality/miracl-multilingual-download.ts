import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
	MIRACL_CORPUS_REVISION,
	MIRACL_DATASET_REVISION,
	MIRACL_MULTILINGUAL_CONTRACT,
	type MiraclCorpusManifestEntry,
	type MiraclEvidenceLanguage,
	verifyMiraclCorpusManifest,
} from "./miracl-multilingual-contract.js";
import { fileExists, verifyLockedFile } from "./public-miracl-source.js";

export interface MiraclDownloadFile {
	path: string;
	size: number;
	sha256: string;
	provider: "dataset" | "corpus";
}

export function miraclDownloadFiles(
	language: MiraclEvidenceLanguage,
	corpus: readonly MiraclCorpusManifestEntry[],
): MiraclDownloadFile[] {
	const contract = MIRACL_MULTILINGUAL_CONTRACT[language];
	return [
		{ ...contract.topics, provider: "dataset" },
		{ ...contract.qrels, provider: "dataset" },
		...corpus.map((file) => ({ ...file, provider: "corpus" as const })),
	];
}

export function miraclProviderUrl(file: MiraclDownloadFile): string {
	const repository =
		file.provider === "dataset" ? "miracl/miracl" : "miracl/miracl-corpus";
	const revision =
		file.provider === "dataset"
			? MIRACL_DATASET_REVISION
			: MIRACL_CORPUS_REVISION;
	return `https://huggingface.co/datasets/${repository}/resolve/${revision}/${file.path}`;
}

export function miraclSourceRoot(
	language: MiraclEvidenceLanguage,
	cacheRoot = ".cache/benchmark-sources",
): string {
	return join(cacheRoot, `miracl-${language}-v1.0`);
}

export async function downloadMiraclFile(
	root: string,
	file: MiraclDownloadFile,
	fetchFile: typeof fetch = fetch,
): Promise<"cached" | "downloaded"> {
	const destination = join(root, file.path);
	if (await fileExists(destination)) {
		await verifyLockedFile(destination, file);
		return "cached";
	}
	await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
	const temporary = `${destination}.${process.pid}.partial`;
	await rm(temporary, { force: true });
	try {
		const response = await fetchFile(miraclProviderUrl(file), {
			signal: AbortSignal.timeout(30 * 60_000),
		});
		if (!response.ok || !response.body)
			throw new Error(`${file.path}: HTTP ${response.status}`);
		await pipeline(
			Readable.fromWeb(response.body as never),
			createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
		);
		await verifyLockedFile(temporary, file);
		await rename(temporary, destination);
		return "downloaded";
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}

export function miraclSourceLockReceipt(
	language: MiraclEvidenceLanguage,
	files: readonly MiraclDownloadFile[],
) {
	const sourceLock = {
		schemaVersion: 1,
		language,
		datasetRevision: MIRACL_DATASET_REVISION,
		corpusRevision: MIRACL_CORPUS_REVISION,
		files: files.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
	};
	const canonical = `${JSON.stringify(sourceLock, null, 2)}\n`;
	return {
		...sourceLock,
		sourceLockSha256: createHash("sha256").update(canonical).digest("hex"),
	};
}

export function parseMiraclSourceLockReceipt(
	language: MiraclEvidenceLanguage,
	value: unknown,
) {
	if (typeof value !== "object" || value === null)
		throw new Error("MIRACL source receipt is not an object");
	const row = value as {
		schemaVersion?: unknown;
		language?: unknown;
		datasetRevision?: unknown;
		corpusRevision?: unknown;
		files?: unknown;
		sourceLockSha256?: unknown;
	};
	if (
		row.schemaVersion !== 1 ||
		row.language !== language ||
		row.datasetRevision !== MIRACL_DATASET_REVISION ||
		row.corpusRevision !== MIRACL_CORPUS_REVISION ||
		!Array.isArray(row.files) ||
		typeof row.sourceLockSha256 !== "string"
	)
		throw new Error(`MIRACL-${language} source receipt header mismatch`);
	const files = row.files.map((file, index) => {
		if (typeof file !== "object" || file === null)
			throw new Error(
				`MIRACL-${language} source receipt file ${index} invalid`,
			);
		const item = file as { path?: unknown; size?: unknown; sha256?: unknown };
		if (
			typeof item.path !== "string" ||
			!Number.isSafeInteger(item.size) ||
			(item.size as number) < 1 ||
			typeof item.sha256 !== "string" ||
			!/^[a-f0-9]{64}$/.test(item.sha256)
		)
			throw new Error(
				`MIRACL-${language} source receipt file ${index} invalid`,
			);
		return {
			path: item.path,
			size: item.size as number,
			sha256: item.sha256,
		};
	});
	const contract = MIRACL_MULTILINGUAL_CONTRACT[language];
	const [topics, qrels, ...corpus] = files;
	if (
		JSON.stringify(topics) !==
			JSON.stringify(contract.topics, ["path", "size", "sha256"]) ||
		JSON.stringify(qrels) !==
			JSON.stringify(contract.qrels, ["path", "size", "sha256"])
	)
		throw new Error(`MIRACL-${language} topics/qrels receipt mismatch`);
	verifyMiraclCorpusManifest(language, corpus);
	const withProvider = files.map((file, index) => ({
		...file,
		provider: index < 2 ? ("dataset" as const) : ("corpus" as const),
	}));
	const expected = miraclSourceLockReceipt(language, withProvider);
	if (row.sourceLockSha256 !== expected.sourceLockSha256)
		throw new Error(`MIRACL-${language} source receipt digest mismatch`);
	return expected;
}
