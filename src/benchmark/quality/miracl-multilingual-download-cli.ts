#!/usr/bin/env node
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	MIRACL_CORPUS_REVISION,
	MIRACL_MULTILINGUAL_CONTRACT,
	type MiraclEvidenceLanguage,
	collectHuggingFaceTreePages,
	parseHuggingFaceCorpusTree,
} from "./miracl-multilingual-contract.js";
import {
	downloadMiraclFile,
	miraclDownloadFiles,
	miraclSourceLockReceipt,
	miraclSourceRoot,
} from "./miracl-multilingual-download.js";

const language = process.argv[2] as MiraclEvidenceLanguage | undefined;
if (!language || !(language in MIRACL_MULTILINGUAL_CONTRACT))
	throw new Error("usage: miracl-multilingual-download-cli.ts <ko|en|ar>");
const contract = MIRACL_MULTILINGUAL_CONTRACT[language];
const treeUrl = `https://huggingface.co/api/datasets/miracl/miracl-corpus/tree/${MIRACL_CORPUS_REVISION}/${contract.corpus.directory}?recursive=true&expand=true`;
const tree = await collectHuggingFaceTreePages(treeUrl);
const files = miraclDownloadFiles(
	language,
	parseHuggingFaceCorpusTree(language, tree),
);
const root = process.env.MIRACL_SOURCE_DIR ?? miraclSourceRoot(language);
const statuses: Array<{ path: string; status: "cached" | "downloaded" }> = [];
for (const [index, file] of files.entries()) {
	const status = await downloadMiraclFile(root, file);
	statuses.push({ path: file.path, status });
	console.error(
		`${language}: ${index + 1}/${files.length} ${status} ${file.path}`,
	);
}
const receipt = {
	...miraclSourceLockReceipt(language, files),
	claimBoundary:
		"Downloaded source identity only; this receipt contains no retrieval score or quality claim.",
	root,
	statuses,
};
const output = join(root, "source-lock-receipt.json");
await mkdir(dirname(output), { recursive: true, mode: 0o700 });
const temporary = `${output}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, {
	flag: "wx",
	mode: 0o600,
});
await rename(temporary, output);
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
