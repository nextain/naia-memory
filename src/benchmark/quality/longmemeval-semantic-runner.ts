import { join } from "node:path";
import type { LongMemEvalBlindCase } from "./longmemeval-blind-corpus.js";
import {
	type SemanticCheckpointContext,
	type SemanticPilotCaseResult,
	loadSemanticCaseCheckpoint,
	semanticCaseFileName,
	writeSemanticCaseCheckpoint,
} from "./longmemeval-semantic-checkpoint.js";

export interface SelectedSemanticCase {
	caseOrdinal: number;
	item: LongMemEvalBlindCase;
}

export function selectSemanticCases(
	cases: LongMemEvalBlindCase[],
	caseOffset: number,
	caseCount: number,
): SelectedSemanticCase[] {
	if (!Number.isSafeInteger(caseOffset) || caseOffset < 0)
		throw new Error("case offset must be a non-negative integer");
	if (!Number.isSafeInteger(caseCount) || caseCount < 1)
		throw new Error("case count must be a positive integer");
	if (caseOffset + caseCount > cases.length)
		throw new Error("selected case range exceeds corpus");
	const selected = cases
		.slice(caseOffset, caseOffset + caseCount)
		.map((item, index) => ({ caseOrdinal: caseOffset + index, item }));
	if (
		new Set(selected.map(({ item }) => item.question_id)).size !==
		selected.length
	)
		throw new Error("selected case range contains duplicate question IDs");
	return selected;
}

export class IntentionalSemanticStop extends Error {
	constructor(public readonly completedNewCaseCount: number) {
		super(`intentional stop after ${completedNewCaseCount} new cases`);
	}
}

export async function runSemanticCases(options: {
	selected: SelectedSemanticCase[];
	checkpointsDirectory: string;
	context: SemanticCheckpointContext;
	executeCase: (
		item: LongMemEvalBlindCase,
		caseOrdinal: number,
	) => Promise<SemanticPilotCaseResult>;
	stopAfterNewCases?: number;
	onProgress?: (event: {
		status: "completed" | "reused";
		caseOrdinal: number;
		questionId: string;
	}) => void;
}): Promise<{
	cases: SemanticPilotCaseResult[];
	reusedCheckpointCount: number;
	newCheckpointCount: number;
}> {
	const results: SemanticPilotCaseResult[] = [];
	let reusedCheckpointCount = 0;
	let newCheckpointCount = 0;
	for (const { caseOrdinal, item } of options.selected) {
		const checkpointPath = join(
			options.checkpointsDirectory,
			semanticCaseFileName(item.question_id),
		);
		const expected = {
			...options.context,
			caseOrdinal,
			questionId: item.question_id,
		};
		const checkpoint = await loadSemanticCaseCheckpoint(
			checkpointPath,
			expected,
		);
		if (checkpoint) {
			results.push(checkpoint);
			reusedCheckpointCount += 1;
			options.onProgress?.({
				status: "reused",
				caseOrdinal,
				questionId: item.question_id,
			});
			continue;
		}
		const result = await options.executeCase(item, caseOrdinal);
		validateExecutedResult(result, caseOrdinal, item.question_id);
		await writeSemanticCaseCheckpoint(checkpointPath, options.context, result);
		results.push(result);
		newCheckpointCount += 1;
		options.onProgress?.({
			status: "completed",
			caseOrdinal,
			questionId: item.question_id,
		});
		if (
			options.stopAfterNewCases !== undefined &&
			newCheckpointCount >= options.stopAfterNewCases
		)
			throw new IntentionalSemanticStop(newCheckpointCount);
	}
	return { cases: results, reusedCheckpointCount, newCheckpointCount };
}

function validateExecutedResult(
	result: SemanticPilotCaseResult,
	caseOrdinal: number,
	questionId: string,
): void {
	if (result.caseOrdinal !== caseOrdinal || result.questionId !== questionId)
		throw new Error("executed semantic result identity mismatch");
}
