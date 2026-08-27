#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { access, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildNativeCandidatePool } from "./native-candidate-pool.js";
import {
	MIRACL_KO_LOCK,
	parseQrelsTsv,
	parseTrecRun,
	readGzipJsonlDocumentIds,
	sha256File,
	validateTrecRunCoverage,
} from "./public-miracl-source.js";

const sourceRoot =
	process.env.MIRACL_SOURCE_DIR ?? ".cache/benchmark-sources/miracl-ko-v1.0";
const lexicalPath = requiredEnvironment("MIRACL_LEXICAL_RUN");
const densePath = requiredEnvironment("MIRACL_DENSE_RUN");
const outputPrefix = requiredEnvironment("MIRACL_CANDIDATE_OUTPUT_PREFIX");

function requiredEnvironment(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required`);
	return value;
}

async function main() {
	const qrels = parseQrelsTsv(
		await readFile(join(sourceRoot, MIRACL_KO_LOCK.files[1].path), "utf8"),
	);
	const [lexicalText, denseText] = await Promise.all([
		readFile(lexicalPath, "utf8"),
		readFile(densePath, "utf8"),
	]);
	const corpusDocumentIds: string[] = [];
	for (const locked of MIRACL_KO_LOCK.files.slice(2)) {
		const shardIds = await readGzipJsonlDocumentIds(
			join(sourceRoot, locked.path),
		);
		for (const id of shardIds) corpusDocumentIds.push(id);
	}
	const lexicalSha256 = await sha256File(lexicalPath);
	const denseSha256 = await sha256File(densePath);
	const lexicalRun = parseTrecRun(lexicalText);
	const denseRun = parseTrecRun(denseText);
	const expectedQueryIds = new Set(qrels.keys());
	validateTrecRunCoverage(lexicalRun, expectedQueryIds, 100);
	validateTrecRunCoverage(denseRun, expectedQueryIds, 100);
	const pool = buildNativeCandidatePool({
		corpusDocumentIds,
		relevantByQuery: qrels,
		hardNegativeRuns: {
			lexical: {
				source: `pyserini:miracl-v1.0-ko:${lexicalSha256}`,
				byQuery: lexicalRun,
			},
			dense: {
				source: `pyserini:miracl-v1.0-ko-mcontriever-pft-msmarco:${denseSha256}`,
				byQuery: denseRun,
			},
		},
		targetSize: "required-only",
		minimumHardNegativesPerQuery: 50,
		minimumUniqueHardNegativeRatio: 0.5,
		maximumRandomFillerFraction: 0,
		seed: "miracl-ko-native-diagnostic-v1",
	});
	const documentPath = `${outputPrefix}.document-ids.txt`;
	const receiptPath = `${outputPrefix}.receipt.json`;
	await writeArtifactPair(
		documentPath,
		`${pool.documentIds.join("\n")}\n`,
		receiptPath,
		`${JSON.stringify(
			{
				...pool.receipt,
				rawRuns: { lexical: lexicalSha256, dense: denseSha256 },
				datasetRevision: MIRACL_KO_LOCK.datasetRevision,
				corpusRevision: MIRACL_KO_LOCK.corpusRevision,
				denseModelProvenance: {
					model: "facebook/mcontriever-msmarco",
					index: "miracl-v1.0-ko-mcontriever-pft-msmarco",
					indexArchiveMd5: "fa00afb61fa4332c408069cb6eb2e8f2",
					pyseriniCatalogCommit: "367560b4de7d9c3486f666dcc2df7783ca7758f2",
					trainingIndependence:
						"upstream-asserted-msmarco-only-not-code-verifiable",
				},
			},
			null,
			2,
		)}\n`,
	);
	process.stdout.write(`${JSON.stringify(pool.receipt, null, 2)}\n`);
}

async function writeArtifactPair(
	documentPath: string,
	documentContent: string,
	receiptPath: string,
	receiptContent: string,
): Promise<void> {
	for (const path of [documentPath, receiptPath]) {
		try {
			await access(path);
			throw new Error(`refusing to overwrite existing artifact: ${path}`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	const nonce = randomUUID();
	const documentTemp = `${documentPath}.tmp-${nonce}`;
	const receiptTemp = `${receiptPath}.tmp-${nonce}`;
	try {
		await Promise.all([
			writeFile(documentTemp, documentContent, { flag: "wx" }),
			writeFile(receiptTemp, receiptContent, { flag: "wx" }),
		]);
		await rename(documentTemp, documentPath);
		await rename(receiptTemp, receiptPath);
	} catch (error) {
		await Promise.allSettled([unlink(documentTemp), unlink(receiptTemp)]);
		throw error;
	}
}

await main();
