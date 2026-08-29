import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type LongMemEvalBlindCorpus,
	blindCorpusSha256,
	validateLongMemEvalBlindCorpus,
} from "./longmemeval-blind-corpus.js";
import {
	semanticPolicySha256,
	writeJsonAtomic,
} from "./longmemeval-semantic-checkpoint.js";
import {
	SEMANTIC_PILOT_RECEIPT_SCHEMA,
	type SemanticPilotReceipt,
	type SemanticShardManifest,
	createSemanticShardManifest,
	mergeSemanticShardReceipts,
	semanticShardById,
	validateSemanticCampaignInput,
	validateSemanticShardManifest,
	validateSemanticShardReceipt,
} from "./longmemeval-semantic-shards.js";

function argument(name: string): string {
	const index = process.argv.indexOf(name);
	const value = index >= 0 ? process.argv[index + 1] : undefined;
	if (!value) throw new Error(`missing ${name}`);
	return value;
}

function positiveInteger(name: string): number {
	const value = Number(argument(name));
	if (!Number.isSafeInteger(value) || value < 1)
		throw new Error(`${name} must be a positive integer`);
	return value;
}

async function readJson(path: string): Promise<unknown> {
	return JSON.parse(await readFile(path, "utf8"));
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

async function runPilot(arguments_: string[]): Promise<void> {
	const pilotCli = join(
		dirname(fileURLToPath(import.meta.url)),
		"longmemeval-semantic-pilot-cli.ts",
	);
	const child = spawn(
		process.execPath,
		["--import", "tsx", pilotCli, ...arguments_],
		{
			stdio: "inherit",
		},
	);
	const exitCode = await new Promise<number | null>((resolveExit, reject) => {
		child.once("error", reject);
		child.once("exit", resolveExit);
	});
	if (exitCode !== 0)
		throw new Error(`semantic shard pilot exited with status ${exitCode}`);
}

const command = process.argv.slice(2).find((value) => value !== "--");
if (command === "create") {
	const inputPath = resolve(argument("--input"));
	const policyReceiptPath = resolve(argument("--policy-receipt"));
	const outputPath = resolve(argument("--output"));
	const inputBytes = await readFile(inputPath);
	const corpus = JSON.parse(
		inputBytes.toString("utf8"),
	) as LongMemEvalBlindCorpus;
	validateLongMemEvalBlindCorpus(corpus);
	const policyReceipt = (await readJson(
		policyReceiptPath,
	)) as SemanticPilotReceipt;
	if (
		policyReceipt.schemaVersion !== SEMANTIC_PILOT_RECEIPT_SCHEMA ||
		semanticPolicySha256(policyReceipt.policy) !== policyReceipt.policySha256
	)
		throw new Error("policy receipt is invalid");
	if (
		policyReceipt.input.fileSha256 !==
			createHash("sha256").update(inputBytes).digest("hex") ||
		policyReceipt.input.contentSha256 !== blindCorpusSha256(corpus)
	)
		throw new Error("policy receipt input mismatch");
	const manifest = createSemanticShardManifest({
		corpus,
		inputFileSha256: policyReceipt.input.fileSha256,
		inputContentSha256: policyReceipt.input.contentSha256,
		policySha256: policyReceipt.policySha256,
		shardSize: positiveInteger("--shard-size"),
		maxParallelism: positiveInteger("--max-parallelism"),
	});
	validateSemanticShardManifest(manifest, corpus);
	await mkdir(dirname(outputPath), { recursive: true });
	await writeJsonAtomic(outputPath, manifest);
	process.stdout.write(
		`${JSON.stringify({ shardCount: manifest.shards.length, totalCaseCount: manifest.totalCaseCount, policySha256: manifest.policySha256 })}\n`,
	);
} else if (command === "run") {
	const manifestPath = resolve(argument("--manifest"));
	const inputPath = resolve(argument("--input"));
	const storesDirectory = resolve(argument("--stores-dir"));
	const checkpointsDirectory = resolve(argument("--checkpoints-dir"));
	const receiptsDirectory = resolve(argument("--receipts-dir"));
	const manifest = (await readJson(manifestPath)) as SemanticShardManifest;
	const inputBytes = await readFile(inputPath);
	const corpus = JSON.parse(
		inputBytes.toString("utf8"),
	) as LongMemEvalBlindCorpus;
	validateLongMemEvalBlindCorpus(corpus);
	validateSemanticCampaignInput(manifest, corpus, inputBytes);
	const shard = semanticShardById(manifest, argument("--shard-id"));
	const receiptPath = join(receiptsDirectory, shard.outputFile);
	if (await exists(receiptPath)) {
		const receipt = (await readJson(receiptPath)) as SemanticPilotReceipt;
		validateSemanticShardReceipt(receipt, manifest, shard);
		process.stdout.write(
			`${JSON.stringify({ status: "reused", shardId: shard.shardId, receiptPath })}\n`,
		);
	} else {
		await mkdir(receiptsDirectory, { recursive: true });
		await runPilot([
			"--input",
			inputPath,
			"--output",
			receiptPath,
			"--stores-dir",
			storesDirectory,
			"--checkpoints-dir",
			checkpointsDirectory,
			"--case-offset",
			String(shard.caseOffset),
			"--case-count",
			String(shard.caseCount),
		]);
		const receipt = (await readJson(receiptPath)) as SemanticPilotReceipt;
		validateSemanticShardReceipt(receipt, manifest, shard);
		process.stdout.write(
			`${JSON.stringify({ status: "completed", shardId: shard.shardId, receiptPath })}\n`,
		);
	}
} else if (command === "merge") {
	const manifestPath = resolve(argument("--manifest"));
	const receiptsDirectory = resolve(argument("--receipts-dir"));
	const outputPath = resolve(argument("--output"));
	const manifest = (await readJson(manifestPath)) as SemanticShardManifest;
	validateSemanticShardManifest(manifest);
	const receipts: SemanticPilotReceipt[] = [];
	for (const shard of manifest.shards)
		receipts.push(
			(await readJson(
				join(receiptsDirectory, shard.outputFile),
			)) as SemanticPilotReceipt,
		);
	const merged = mergeSemanticShardReceipts(manifest, receipts);
	await mkdir(dirname(outputPath), { recursive: true });
	await writeJsonAtomic(outputPath, merged);
	process.stdout.write(`${JSON.stringify(merged.summary)}\n`);
} else {
	throw new Error("command must be create, run, or merge");
}
