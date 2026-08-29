import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
	LongMemEvalBlindCase,
	LongMemEvalBlindCorpus,
} from "./longmemeval-blind-corpus.js";
import { semanticPolicySha256 } from "./longmemeval-semantic-checkpoint.js";
import {
	type SemanticPilotReceipt,
	type SemanticShardDefinition,
	createSemanticShardManifest,
	mergeSemanticShardReceipts,
	semanticShardById,
	validateSemanticCampaignInput,
	validateSemanticShardManifest,
	validateSemanticShardReceipt,
} from "./longmemeval-semantic-shards.js";

function blindCase(index: number): LongMemEvalBlindCase {
	return {
		question_id: `q-${index}`,
		question_type: "single-session-user",
		question: `question ${index}`,
		question_date: "2024/01/01 (Mon) 00:00",
		haystack_session_ids: [`s-${index}`],
		haystack_dates: ["2024/01/01 (Mon) 00:00"],
		haystack_sessions: [[{ role: "user", content: `memory ${index}` }]],
	};
}

function corpus(size: number): LongMemEvalBlindCorpus {
	return {
		schemaVersion: "naia-memory-longmemeval-blind-corpus-v1",
		cases: Array.from({ length: size }, (_, index) => blindCase(index)),
	};
}

const policy = { searchMode: "rrf", topK: 50 };
const policySha256 = semanticPolicySha256(policy);

function manifest(size: number, shardSize: number) {
	return createSemanticShardManifest({
		corpus: corpus(size),
		inputFileSha256: "a".repeat(64),
		inputContentSha256: "b".repeat(64),
		policySha256,
		shardSize,
		maxParallelism: 1,
	});
}

function receipt(shard: SemanticShardDefinition): SemanticPilotReceipt {
	const cases = Array.from({ length: shard.caseCount }, (_, index) => ({
		caseOrdinal: shard.caseOffset + index,
		questionId: `q-${shard.caseOffset + index}`,
		turnCount: 1,
		ingestElapsedMs: 1,
		reindexElapsedMs: 2,
		recallElapsedMs: 3,
		retrievedCount: 1,
		retrievalSha256: "d".repeat(64),
		storeBytes: 4,
	}));
	return {
		schemaVersion: "naia-memory-longmemeval-semantic-pilot-v1",
		labelAccess: "blind-corpus-only",
		input: { fileSha256: "a".repeat(64), contentSha256: "b".repeat(64) },
		policy,
		policySha256,
		summary: {
			caseOffset: shard.caseOffset,
			caseCount: shard.caseCount,
			reusedCheckpointCount: 0,
			newCheckpointCount: shard.caseCount,
			turnCount: shard.caseCount,
			ingestElapsedMs: shard.caseCount,
			reindexElapsedMs: shard.caseCount * 2,
			recallElapsedMs: shard.caseCount * 3,
			storeBytes: shard.caseCount * 4,
			elapsedMs: 10,
			residentSetBytesAtReceipt: 100,
			maxResidentSetBytesThisProcess: 200,
		},
		cases,
	};
}

describe("LongMemEval semantic shards", () => {
	it("partitions all 500 cases into deterministic bounded shards", () => {
		const value = manifest(500, 5);
		expect(value.shards).toHaveLength(100);
		expect(value.shards[0]).toMatchObject({
			shardId: "shard-000",
			caseOffset: 0,
			caseCount: 5,
			outputFile: "shard-000.json",
		});
		expect(value.shards[99]).toMatchObject({
			shardId: "shard-099",
			caseOffset: 495,
			caseCount: 5,
		});
		expect(() =>
			validateSemanticShardManifest(value, corpus(500)),
		).not.toThrow();
	});

	it("selects only declared shards and binds the exact input bytes", () => {
		const valueCorpus = corpus(500);
		const inputBytes = Buffer.from(JSON.stringify(valueCorpus));
		const value = createSemanticShardManifest({
			corpus: valueCorpus,
			inputFileSha256: createHash("sha256").update(inputBytes).digest("hex"),
			inputContentSha256: "b".repeat(64),
			policySha256,
			shardSize: 5,
			maxParallelism: 1,
		});
		expect(semanticShardById(value, "shard-042")).toMatchObject({
			caseOffset: 210,
			caseCount: 5,
		});
		expect(() => semanticShardById(value, "shard-100")).toThrow(
			/not declared/u,
		);
		expect(() =>
			validateSemanticCampaignInput(value, valueCorpus, inputBytes),
		).not.toThrow();
		expect(() =>
			validateSemanticCampaignInput(
				value,
				valueCorpus,
				Buffer.concat([inputBytes, Buffer.from("\n")]),
			),
		).toThrow(/input file/u);
	});

	it("rejects gaps and changed question order", () => {
		const value = manifest(6, 2);
		const secondShard = value.shards[1];
		if (!secondShard) throw new Error("missing test shard");
		value.shards[1] = { ...secondShard, caseOffset: 3 };
		expect(() => validateSemanticShardManifest(value)).toThrow(/contiguous/u);
		const clean = manifest(6, 2);
		const reordered = corpus(6);
		const firstCase = reordered.cases[0];
		const secondCase = reordered.cases[1];
		if (!firstCase || !secondCase) throw new Error("missing test cases");
		[reordered.cases[0], reordered.cases[1]] = [secondCase, firstCase];
		expect(() => validateSemanticShardManifest(clean, reordered)).toThrow(
			/question order/u,
		);
	});

	it("rejects receipt policy and question identity drift", () => {
		const value = manifest(2, 2);
		const shard = value.shards[0];
		if (!shard) throw new Error("missing test shard");
		const changedPolicy = { ...receipt(shard), policy: { topK: 49 } };
		expect(() =>
			validateSemanticShardReceipt(changedPolicy, value, shard),
		).toThrow(/policy/u);
		const changedQuestion = receipt(shard);
		const changedCase = changedQuestion.cases[1];
		if (!changedCase) throw new Error("missing test case");
		changedCase.questionId = "substituted";
		expect(() =>
			validateSemanticShardReceipt(changedQuestion, value, shard),
		).toThrow(/question IDs/u);
	});

	it("merges only a complete ordered receipt set", () => {
		const value = manifest(6, 2);
		const receipts = value.shards.map(receipt);
		const merged = mergeSemanticShardReceipts(value, receipts);
		expect(merged.summary).toEqual({
			shardCount: 3,
			caseCount: 6,
			turnCount: 6,
			storeBytes: 24,
		});
		expect(merged.cases.map((item) => item.caseOrdinal)).toEqual([
			0, 1, 2, 3, 4, 5,
		]);
		expect(() =>
			mergeSemanticShardReceipts(value, receipts.slice(0, 2)),
		).toThrow(/incomplete/u);
	});
});
