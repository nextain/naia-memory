import { describe, expect, it } from "vitest";
import {
	createSemanticCaseCheckpoint,
	semanticPolicySha256,
	validateSemanticCaseCheckpoint,
} from "./longmemeval-semantic-checkpoint.js";

const context = {
	inputFileSha256: "a".repeat(64),
	inputContentSha256: "b".repeat(64),
	policySha256: "c".repeat(64),
};
const result = {
	caseOrdinal: 7,
	questionId: "question-7",
	turnCount: 550,
	ingestElapsedMs: 10,
	reindexElapsedMs: 20,
	recallElapsedMs: 30,
	retrievedCount: 50,
	retrievalSha256: "d".repeat(64),
	storeBytes: 1234,
};

describe("LongMemEval semantic checkpoints", () => {
	it("binds a case result to input and policy custody", () => {
		const checkpoint = createSemanticCaseCheckpoint(context, result);
		expect(() =>
			validateSemanticCaseCheckpoint(checkpoint, {
				...context,
				caseOrdinal: 7,
				questionId: "question-7",
			}),
		).not.toThrow();
	});

	it.each([
		["input", { inputFileSha256: "e".repeat(64) }],
		["policy", { policySha256: "e".repeat(64) }],
		["case", { result: { ...result, questionId: "other" } }],
	])("rejects %s drift", (_label, override) => {
		const checkpoint = {
			...createSemanticCaseCheckpoint(context, result),
			...override,
		};
		expect(() =>
			validateSemanticCaseCheckpoint(checkpoint, {
				...context,
				caseOrdinal: 7,
				questionId: "question-7",
			}),
		).toThrow(/mismatch/u);
	});

	it("hashes a stable policy representation", () => {
		expect(semanticPolicySha256({ topK: 50 })).toBe(
			semanticPolicySha256({ topK: 50 }),
		);
	});

	it.each([
		["fractional ordinal", { caseOrdinal: 7.5 }],
		["zero turns", { turnCount: 0 }],
		["too many results", { retrievedCount: 51 }],
		["fractional store size", { storeBytes: 1.5 }],
	])("rejects %s", (_label, resultOverride) => {
		const checkpoint = createSemanticCaseCheckpoint(context, {
			...result,
			...resultOverride,
		});
		expect(() =>
			validateSemanticCaseCheckpoint(checkpoint, {
				...context,
				caseOrdinal: 7,
				questionId: "question-7",
			}),
		).toThrow(/invalid|mismatch/u);
	});
});
