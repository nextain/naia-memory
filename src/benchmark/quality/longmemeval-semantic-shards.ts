import { createHash } from "node:crypto";
import type { LongMemEvalBlindCorpus } from "./longmemeval-blind-corpus.js";
import {
	type SemanticPilotCaseResult,
	semanticPolicySha256,
	validateSemanticPilotCaseResult,
} from "./longmemeval-semantic-checkpoint.js";

export const SEMANTIC_SHARD_MANIFEST_SCHEMA =
	"naia-memory-longmemeval-semantic-shards-v1" as const;
export const SEMANTIC_PILOT_RECEIPT_SCHEMA =
	"naia-memory-longmemeval-semantic-pilot-v1" as const;

export interface SemanticShardDefinition {
	shardId: string;
	caseOffset: number;
	caseCount: number;
	outputFile: string;
	questionIdsSha256: string;
}

export interface SemanticShardManifest {
	schemaVersion: typeof SEMANTIC_SHARD_MANIFEST_SCHEMA;
	input: { fileSha256: string; contentSha256: string };
	questionOrderSha256: string;
	policySha256: string;
	totalCaseCount: number;
	shardSize: number;
	maxParallelism: number;
	shards: SemanticShardDefinition[];
}

export interface SemanticPilotReceipt {
	schemaVersion: typeof SEMANTIC_PILOT_RECEIPT_SCHEMA;
	labelAccess: "blind-corpus-only";
	input: { fileSha256: string; contentSha256: string };
	policy: unknown;
	policySha256: string;
	summary: {
		caseOffset: number;
		caseCount: number;
		reusedCheckpointCount: number;
		newCheckpointCount: number;
		turnCount: number;
		ingestElapsedMs: number;
		reindexElapsedMs: number;
		recallElapsedMs: number;
		storeBytes: number;
		elapsedMs: number;
		residentSetBytesAtReceipt: number;
		maxResidentSetBytesThisProcess: number;
	};
	cases: SemanticPilotCaseResult[];
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function assertSha256(value: string, name: string): void {
	if (!SHA256_PATTERN.test(value)) throw new Error(`${name} is invalid`);
}

function assertNonnegativeNumber(value: number, name: string): void {
	if (!Number.isFinite(value) || value < 0)
		throw new Error(`${name} is invalid`);
}

function assertNonnegativeInteger(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value < 0)
		throw new Error(`${name} is invalid`);
}

export function createSemanticShardManifest(options: {
	corpus: LongMemEvalBlindCorpus;
	inputFileSha256: string;
	inputContentSha256: string;
	policySha256: string;
	shardSize: number;
	maxParallelism: number;
}): SemanticShardManifest {
	for (const [name, value] of [
		["shard size", options.shardSize],
		["max parallelism", options.maxParallelism],
	] as const)
		if (!Number.isSafeInteger(value) || value < 1)
			throw new Error(`${name} must be a positive integer`);
	const totalCaseCount = options.corpus.cases.length;
	if (totalCaseCount < 1)
		throw new Error("corpus must contain at least one case");
	const questionIds = options.corpus.cases.map((item) => item.question_id);
	if (new Set(questionIds).size !== questionIds.length)
		throw new Error("corpus contains duplicate question IDs");
	const shardCount = Math.ceil(totalCaseCount / options.shardSize);
	if (options.maxParallelism > shardCount)
		throw new Error("max parallelism cannot exceed shard count");
	const width = Math.max(3, String(shardCount - 1).length);
	const shards = Array.from({ length: shardCount }, (_, index) => {
		const caseOffset = index * options.shardSize;
		const caseCount = Math.min(options.shardSize, totalCaseCount - caseOffset);
		const shardId = `shard-${String(index).padStart(width, "0")}`;
		return {
			shardId,
			caseOffset,
			caseCount,
			outputFile: `${shardId}.json`,
			questionIdsSha256: createHash("sha256")
				.update(
					JSON.stringify(
						options.corpus.cases
							.slice(caseOffset, caseOffset + caseCount)
							.map((item) => item.question_id),
					),
				)
				.digest("hex"),
		};
	});
	return {
		schemaVersion: SEMANTIC_SHARD_MANIFEST_SCHEMA,
		input: {
			fileSha256: options.inputFileSha256,
			contentSha256: options.inputContentSha256,
		},
		questionOrderSha256: createHash("sha256")
			.update(
				JSON.stringify(options.corpus.cases.map((item) => item.question_id)),
			)
			.digest("hex"),
		policySha256: options.policySha256,
		totalCaseCount,
		shardSize: options.shardSize,
		maxParallelism: options.maxParallelism,
		shards,
	};
}

export function validateSemanticShardManifest(
	manifest: SemanticShardManifest,
	corpus?: LongMemEvalBlindCorpus,
): void {
	if (manifest.schemaVersion !== SEMANTIC_SHARD_MANIFEST_SCHEMA)
		throw new Error("semantic shard manifest schema mismatch");
	assertSha256(manifest.input.fileSha256, "semantic shard input file hash");
	assertSha256(
		manifest.input.contentSha256,
		"semantic shard input content hash",
	);
	assertSha256(
		manifest.questionOrderSha256,
		"semantic shard question order hash",
	);
	assertSha256(manifest.policySha256, "semantic shard policy hash");
	if (
		!Number.isSafeInteger(manifest.totalCaseCount) ||
		manifest.totalCaseCount < 1
	)
		throw new Error("semantic shard manifest total case count is invalid");
	if (!Number.isSafeInteger(manifest.shardSize) || manifest.shardSize < 1)
		throw new Error("semantic shard manifest shard size is invalid");
	const expectedShardCount = Math.ceil(
		manifest.totalCaseCount / manifest.shardSize,
	);
	if (
		!Number.isSafeInteger(manifest.maxParallelism) ||
		manifest.maxParallelism < 1 ||
		manifest.maxParallelism > expectedShardCount
	)
		throw new Error("semantic shard manifest max parallelism is invalid");
	if (
		!Array.isArray(manifest.shards) ||
		manifest.shards.length !== expectedShardCount
	)
		throw new Error("semantic shard manifest shard count mismatch");
	let nextOffset = 0;
	const ids = new Set<string>();
	const outputs = new Set<string>();
	for (const shard of manifest.shards) {
		if (shard.caseOffset !== nextOffset)
			throw new Error("semantic shard manifest coverage is not contiguous");
		const expectedCount = Math.min(
			manifest.shardSize,
			manifest.totalCaseCount - shard.caseOffset,
		);
		if (shard.caseCount !== expectedCount)
			throw new Error("semantic shard manifest case count mismatch");
		if (!/^shard-[0-9]+$/u.test(shard.shardId) || ids.has(shard.shardId))
			throw new Error(
				"semantic shard manifest shard ID is invalid or duplicate",
			);
		if (
			shard.outputFile !== `${shard.shardId}.json` ||
			outputs.has(shard.outputFile)
		)
			throw new Error("semantic shard manifest output is invalid or duplicate");
		ids.add(shard.shardId);
		outputs.add(shard.outputFile);
		assertSha256(
			shard.questionIdsSha256,
			"semantic shard manifest question IDs hash",
		);
		nextOffset += shard.caseCount;
	}
	if (nextOffset !== manifest.totalCaseCount)
		throw new Error("semantic shard manifest does not cover all cases");
	if (corpus) {
		if (corpus.cases.length !== manifest.totalCaseCount)
			throw new Error("semantic shard manifest corpus size mismatch");
		const questionOrderSha256 = createHash("sha256")
			.update(JSON.stringify(corpus.cases.map((item) => item.question_id)))
			.digest("hex");
		if (questionOrderSha256 !== manifest.questionOrderSha256)
			throw new Error("semantic shard manifest question order mismatch");
		for (const shard of manifest.shards) {
			const questionIdsSha256 = createHash("sha256")
				.update(
					JSON.stringify(
						corpus.cases
							.slice(shard.caseOffset, shard.caseOffset + shard.caseCount)
							.map((item) => item.question_id),
					),
				)
				.digest("hex");
			if (questionIdsSha256 !== shard.questionIdsSha256)
				throw new Error("semantic shard manifest shard question IDs mismatch");
		}
	}
}

export function validateSemanticShardReceipt(
	receipt: SemanticPilotReceipt,
	manifest: SemanticShardManifest,
	shard: SemanticShardDefinition,
): void {
	if (receipt.schemaVersion !== SEMANTIC_PILOT_RECEIPT_SCHEMA)
		throw new Error("semantic shard receipt schema mismatch");
	if (receipt.labelAccess !== "blind-corpus-only")
		throw new Error("semantic shard receipt label access mismatch");
	if (
		receipt.input.fileSha256 !== manifest.input.fileSha256 ||
		receipt.input.contentSha256 !== manifest.input.contentSha256
	)
		throw new Error("semantic shard receipt input mismatch");
	if (
		receipt.policySha256 !== manifest.policySha256 ||
		semanticPolicySha256(receipt.policy) !== manifest.policySha256
	)
		throw new Error("semantic shard receipt policy mismatch");
	if (
		receipt.summary.caseOffset !== shard.caseOffset ||
		receipt.summary.caseCount !== shard.caseCount ||
		receipt.cases.length !== shard.caseCount
	)
		throw new Error("semantic shard receipt range mismatch");
	for (const [name, value] of [
		["case offset", receipt.summary.caseOffset],
		["case count", receipt.summary.caseCount],
		["reused checkpoint count", receipt.summary.reusedCheckpointCount],
		["new checkpoint count", receipt.summary.newCheckpointCount],
		["turn count", receipt.summary.turnCount],
		["store bytes", receipt.summary.storeBytes],
		["resident set bytes", receipt.summary.residentSetBytesAtReceipt],
		[
			"maximum resident set bytes",
			receipt.summary.maxResidentSetBytesThisProcess,
		],
	] as const)
		assertNonnegativeInteger(value, `semantic shard receipt ${name}`);
	for (const [name, value] of [
		["ingest elapsed time", receipt.summary.ingestElapsedMs],
		["reindex elapsed time", receipt.summary.reindexElapsedMs],
		["recall elapsed time", receipt.summary.recallElapsedMs],
		["elapsed time", receipt.summary.elapsedMs],
	] as const)
		assertNonnegativeNumber(value, `semantic shard receipt ${name}`);
	if (
		receipt.summary.reusedCheckpointCount +
			receipt.summary.newCheckpointCount !==
		shard.caseCount
	)
		throw new Error("semantic shard receipt completion count mismatch");
	for (const [index, result] of receipt.cases.entries()) {
		validateSemanticPilotCaseResult(result);
		if (result.caseOrdinal !== shard.caseOffset + index)
			throw new Error("semantic shard receipt case order mismatch");
	}
	const questionIdsSha256 = createHash("sha256")
		.update(JSON.stringify(receipt.cases.map((item) => item.questionId)))
		.digest("hex");
	if (questionIdsSha256 !== shard.questionIdsSha256)
		throw new Error("semantic shard receipt question IDs mismatch");
	if (
		receipt.summary.turnCount !==
			receipt.cases.reduce((sum, item) => sum + item.turnCount, 0) ||
		receipt.summary.storeBytes !==
			receipt.cases.reduce((sum, item) => sum + item.storeBytes, 0)
	)
		throw new Error("semantic shard receipt aggregate mismatch");
}

export function mergeSemanticShardReceipts(
	manifest: SemanticShardManifest,
	receipts: SemanticPilotReceipt[],
): {
	schemaVersion: "naia-memory-longmemeval-semantic-merged-v1";
	manifestSha256: string;
	input: SemanticShardManifest["input"];
	policySha256: string;
	summary: {
		shardCount: number;
		caseCount: number;
		turnCount: number;
		storeBytes: number;
	};
	cases: SemanticPilotCaseResult[];
} {
	validateSemanticShardManifest(manifest);
	if (receipts.length !== manifest.shards.length)
		throw new Error("semantic shard receipt set is incomplete");
	for (const [index, receipt] of receipts.entries())
		validateSemanticShardReceipt(
			receipt,
			manifest,
			manifest.shards[index] as SemanticShardDefinition,
		);
	const cases = receipts.flatMap((receipt) => receipt.cases);
	if (new Set(cases.map((item) => item.questionId)).size !== cases.length)
		throw new Error("semantic merged receipts contain duplicate question IDs");
	return {
		schemaVersion: "naia-memory-longmemeval-semantic-merged-v1",
		manifestSha256: createHash("sha256")
			.update(JSON.stringify(manifest))
			.digest("hex"),
		input: manifest.input,
		policySha256: manifest.policySha256,
		summary: {
			shardCount: receipts.length,
			caseCount: cases.length,
			turnCount: cases.reduce((sum, item) => sum + item.turnCount, 0),
			storeBytes: cases.reduce((sum, item) => sum + item.storeBytes, 0),
		},
		cases,
	};
}
