#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	prepareMiraclCorpusIdentityScan,
	readMiraclSourceReceipt,
} from "./miracl-corpus-identity.js";
import { EnglishPreflightSampler } from "./miracl-en-primary-preflight.js";
import {
	buildMiraclEnPrimarySampleReceipt,
	canonicalMiraclEnPrimarySampleReceipt,
	miraclEnSelectedRelevantDocids,
	publishMiraclEnPrimarySampleReceipt,
	selectMiraclEnPreflightQueryIds,
} from "./miracl-en-primary-sample-receipt.js";
import { MIRACL_MULTILINGUAL_CONTRACT } from "./miracl-multilingual-contract.js";
import { miraclSourceRoot } from "./miracl-multilingual-download.js";
import { scanNativeCorpusDocuments } from "./native-corpus-extract.js";
import { buildNativeRuntimeSourceManifest } from "./native-runtime-source-manifest.js";

const root = resolve(import.meta.dirname, "../../..");
const sourceRoot = resolve(
	process.env.MIRACL_SOURCE_DIR ?? miraclSourceRoot("en"),
);
const contract = MIRACL_MULTILINGUAL_CONTRACT.en;
const topicsBytes = readFileSync(join(sourceRoot, contract.topics.path));
const qrelsBytes = readFileSync(join(sourceRoot, contract.qrels.path));
const queryIds = selectMiraclEnPreflightQueryIds(
	topicsBytes.toString("utf8"),
	qrelsBytes.toString("utf8"),
);
const requiredRelevantDocids = new Set(
	miraclEnSelectedRelevantDocids(qrelsBytes.toString("utf8"), queryIds),
);
const retrievalPassages = new Map<
	string,
	{ ordinal: number; docid: string; content: string }
>();
const sourceReceiptPath =
	process.env.MIRACL_SOURCE_RECEIPT ??
	join(sourceRoot, "source-lock-receipt.json");
const output = resolve(
	process.argv[2] ??
		"reports/quality/miracl-en-primary-preflight/source-derived-sample.json",
);
const prepared = prepareMiraclCorpusIdentityScan({
	language: "en",
	sourceRoot,
	sourceReceipt: readMiraclSourceReceipt(sourceReceiptPath),
});
// scanNativeCorpusDocuments performs exact disk-backed duplicate-docid checking;
// this mode keeps sampler memory bounded while requiring contiguous scan ordinals.
const sampler = new EnglishPreflightSampler("verified-corpus-stream");
const scan = await scanNativeCorpusDocuments(
	prepared.shards,
	(document, ordinal) => {
		const passage = {
			ordinal,
			docid: document.docid,
			content: `${document.title}\n${document.text}`,
		};
		sampler.consider(passage);
		if (requiredRelevantDocids.has(document.docid))
			retrievalPassages.set(document.docid, passage);
	},
	{
		duplicateWorkDirectory:
			process.env.MIRACL_DUPLICATE_WORK_DIR ?? dirname(sourceRoot),
		expectedCompressedShards: prepared.expectedCompressedShards,
	},
);
const receipt = buildMiraclEnPrimarySampleReceipt({
	sourceLockSha256: prepared.sourceLockSha256,
	scan,
	topicsBytes,
	qrelsBytes,
	passages: sampler.finish(),
	retrievalPassages: [...retrievalPassages.values()],
	producerSourceManifest: buildNativeRuntimeSourceManifest({
		root,
		entryPoint: "src/benchmark/quality/miracl-en-primary-sample-receipt-cli.ts",
		additionalInputs: ["pnpm-lock.yaml"],
	}),
});
publishMiraclEnPrimarySampleReceipt(output, receipt);
process.stdout.write(canonicalMiraclEnPrimarySampleReceipt(receipt));
