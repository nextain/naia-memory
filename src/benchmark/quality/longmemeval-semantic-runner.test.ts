import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LongMemEvalBlindCase } from "./longmemeval-blind-corpus.js";
import type { SemanticPilotCaseResult } from "./longmemeval-semantic-checkpoint.js";
import {
	IntentionalSemanticStop,
	runSemanticCases,
	selectSemanticCases,
} from "./longmemeval-semantic-runner.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })),
	);
});

function blindCase(questionId: string): LongMemEvalBlindCase {
	return {
		question_id: questionId,
		question_type: "single-session-user",
		question: `question ${questionId}`,
		question_date: "2024/01/01 (Mon) 00:00",
		haystack_session_ids: [`session-${questionId}`],
		haystack_dates: ["2024/01/01 (Mon) 00:00"],
		haystack_sessions: [[{ role: "user", content: `memory ${questionId}` }]],
	};
}

function result(
	item: LongMemEvalBlindCase,
	caseOrdinal: number,
): SemanticPilotCaseResult {
	return {
		caseOrdinal,
		questionId: item.question_id,
		turnCount: 1,
		ingestElapsedMs: 1,
		reindexElapsedMs: 2,
		recallElapsedMs: 3,
		retrievedCount: 1,
		retrievalSha256: "d".repeat(64),
		storeBytes: 4,
	};
}

describe("LongMemEval semantic runner", () => {
	it("selects an absolute, contiguous case range", () => {
		const selected = selectSemanticCases(
			[blindCase("q0"), blindCase("q1"), blindCase("q2")],
			1,
			2,
		);
		expect(
			selected.map(({ caseOrdinal, item }) => [caseOrdinal, item.question_id]),
		).toEqual([
			[1, "q1"],
			[2, "q2"],
		]);
	});

	it("recovers after a forced stop without executing completed cases twice", async () => {
		const directory = await mkdtemp(join(tmpdir(), "longmemeval-checkpoints-"));
		temporaryDirectories.push(directory);
		const selected = selectSemanticCases(
			[blindCase("q0"), blindCase("q1"), blindCase("q2")],
			0,
			3,
		);
		const context = {
			inputFileSha256: "a".repeat(64),
			inputContentSha256: "b".repeat(64),
			policySha256: "c".repeat(64),
		};
		const firstExecutions: number[] = [];
		await expect(
			runSemanticCases({
				selected,
				checkpointsDirectory: directory,
				context,
				stopAfterNewCases: 2,
				executeCase: async (item, ordinal) => {
					firstExecutions.push(ordinal);
					return result(item, ordinal);
				},
			}),
		).rejects.toBeInstanceOf(IntentionalSemanticStop);
		expect(firstExecutions).toEqual([0, 1]);

		const resumedExecutions: number[] = [];
		const resumed = await runSemanticCases({
			selected,
			checkpointsDirectory: directory,
			context,
			executeCase: async (item, ordinal) => {
				resumedExecutions.push(ordinal);
				return result(item, ordinal);
			},
		});
		expect(resumedExecutions).toEqual([2]);
		expect(resumed.reusedCheckpointCount).toBe(2);
		expect(resumed.newCheckpointCount).toBe(1);
		expect(resumed.cases.map(({ caseOrdinal }) => caseOrdinal)).toEqual([
			0, 1, 2,
		]);
	});
});
