#!/usr/bin/env node
import { dirname, join, resolve } from "node:path";
import {
	buildMiraclCorpusIdentityReceipt,
	canonicalMiraclCorpusIdentity,
	prepareMiraclCorpusIdentityScan,
	publishMiraclCorpusIdentity,
	readMiraclSourceReceipt,
	sha256MiraclCorpusIdentity,
} from "./miracl-corpus-identity.js";
import {
	MIRACL_MULTILINGUAL_CONTRACT,
	type MiraclEvidenceLanguage,
} from "./miracl-multilingual-contract.js";
import { miraclSourceRoot } from "./miracl-multilingual-download.js";
import { scanNativeCorpusDocuments } from "./native-corpus-extract.js";

const language = process.argv[2] as MiraclEvidenceLanguage | undefined;
if (!language || !(language in MIRACL_MULTILINGUAL_CONTRACT))
	throw new Error("usage: miracl-corpus-identity-cli.ts <ko|en|ar> [output]");
const sourceRoot = resolve(
	process.env.MIRACL_SOURCE_DIR ?? miraclSourceRoot(language),
);
const sourceReceiptPath =
	process.env.MIRACL_SOURCE_RECEIPT ??
	join(sourceRoot, "source-lock-receipt.json");
const output = resolve(
	process.argv[3] ??
		`reports/quality/miracl-${language}-corpus-identity-observation.json`,
);
const prepared = prepareMiraclCorpusIdentityScan({
	language,
	sourceRoot,
	sourceReceipt: readMiraclSourceReceipt(sourceReceiptPath),
});
const scan = await scanNativeCorpusDocuments(prepared.shards, () => undefined, {
	duplicateWorkDirectory:
		process.env.MIRACL_DUPLICATE_WORK_DIR ?? dirname(sourceRoot),
	expectedCompressedShards: prepared.expectedCompressedShards,
});
const receipt = buildMiraclCorpusIdentityReceipt({
	language,
	sourceLockSha256: prepared.sourceLockSha256,
	scan,
});
publishMiraclCorpusIdentity(output, receipt);
process.stdout.write(
	`${JSON.stringify({ output, receiptSha256: sha256MiraclCorpusIdentity(receipt), ...receipt }, null, 2)}\n`,
);
