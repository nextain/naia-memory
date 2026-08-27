#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import {
	MIRACL_KO_LOCK,
	fileExists,
	inspectGzipJsonl,
	parseQrelsTsv,
	parseTopicsTsv,
	verifyLockedFile,
} from "./public-miracl-source.js";

const ROOT =
	process.env.MIRACL_SOURCE_DIR ?? ".cache/benchmark-sources/miracl-ko-v1.0";
const datasetBase = `https://huggingface.co/datasets/miracl/miracl/resolve/${MIRACL_KO_LOCK.datasetRevision}`;
const corpusBase = `https://huggingface.co/datasets/miracl/miracl-corpus/resolve/${MIRACL_KO_LOCK.corpusRevision}`;

async function download(url: string, target: string) {
	if (await fileExists(target)) return;
	await mkdir(dirname(target), { recursive: true });
	const response = await fetch(url);
	if (!response.ok || !response.body)
		throw new Error(`${url}: HTTP ${response.status}`);
	const partial = `${target}.partial-${process.pid}`;
	await pipeline(
		Readable.fromWeb(response.body as never),
		createWriteStream(partial, { flags: "wx" }),
	);
	await rename(partial, target);
}

async function main() {
	const receipts = [];
	for (const locked of MIRACL_KO_LOCK.files) {
		const target = join(ROOT, locked.path);
		await download(
			`${locked.path.startsWith("miracl-corpus") ? corpusBase : datasetBase}/${locked.path}`,
			target,
		);
		receipts.push({
			path: locked.path,
			...(await verifyLockedFile(target, locked)),
		});
	}
	const topics = parseTopicsTsv(
		await readFile(join(ROOT, MIRACL_KO_LOCK.files[0].path), "utf8"),
	);
	const qrels = parseQrelsTsv(
		await readFile(join(ROOT, MIRACL_KO_LOCK.files[1].path), "utf8"),
	);
	const corpus = [];
	for (const locked of MIRACL_KO_LOCK.files.slice(2))
		corpus.push({
			path: locked.path,
			...(await inspectGzipJsonl(join(ROOT, locked.path))),
		});
	const receipt = {
		source: "MIRACL v1.0 Korean",
		lock: MIRACL_KO_LOCK,
		topics: topics.size,
		judgedQueries: qrels.size,
		corpus,
		files: receipts,
	};
	await writeFile(
		join(ROOT, `receipt-${MIRACL_KO_LOCK.datasetRevision.slice(0, 12)}.json`),
		`${JSON.stringify(receipt, null, 2)}\n`,
		{ flag: "wx" },
	);
	process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

await main();
