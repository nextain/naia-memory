import { describe, expect, it } from "vitest";
import {
	longMemEvalProtocolSha256,
	parseLongMemEvalDataset,
	toLongMemEvalProtocolRecord,
} from "./longmemeval-contract.js";

const fixture = [
	{
		question_id: "q-update-1",
		question_type: "knowledge-update",
		question: "Where do I live now?",
		answer: 1,
		question_date: "2024/01/03 (Wed) 10:00",
		haystack_session_ids: ["s-old", "s-new"],
		haystack_dates: ["2024/01/01 (Mon) 10:00", "2024/01/02 (Tue) 10:00"],
		haystack_sessions: [
			[
				{ role: "user", content: "I live in Busan." },
				{ role: "assistant", content: "Noted." },
			],
			[
				{ role: "user", content: "I moved to Seoul.", has_answer: true },
				{ role: "assistant", content: "Welcome to Seoul." },
			],
		],
		answer_session_ids: ["s-new"],
	},
	{
		question_id: "q-missing_abs",
		question_type: "single-session-user",
		question: "What is my dog's name?",
		answer: "I don't know.",
		question_date: "2024/01/03 (Wed) 10:00",
		haystack_session_ids: ["s-1"],
		haystack_dates: ["2024/01/01 (Mon) 10:00"],
		haystack_sessions: [[{ role: "user", content: "I like cats." }]],
		answer_session_ids: [],
	},
] as const;

describe("LongMemEval protocol contract", () => {
	it("preserves official semantic fields, order, evidence labels, and abstention", () => {
		const parsed = parseLongMemEvalDataset(fixture);
		const records = parsed.map(toLongMemEvalProtocolRecord);
		expect(records[0]?.sessions.map((session) => session.sessionId)).toEqual([
			"s-old",
			"s-new",
		]);
		expect(records[0]?.expectedAnswer).toBe(1);
		expect(records[0]?.sessions[1]?.turns[0]).toMatchObject({
			role: "user",
			content: "I moved to Seoul.",
			hasAnswerLabel: true,
			ordinal: 0,
		});
		expect(records[1]).toMatchObject({
			isAbstention: true,
			answerSessionIds: [],
		});
	});

	it("produces a deterministic digest", () => {
		const first = parseLongMemEvalDataset(fixture).map(
			toLongMemEvalProtocolRecord,
		);
		const second = parseLongMemEvalDataset(
			JSON.parse(JSON.stringify(fixture)),
		).map(toLongMemEvalProtocolRecord);
		expect(longMemEvalProtocolSha256(first)).toBe(
			longMemEvalProtocolSha256(second),
		);
	});

	it("fails closed on parallel-array drift and invalid evidence references", () => {
		const misaligned = JSON.parse(JSON.stringify(fixture));
		misaligned[0].haystack_dates.pop();
		expect(() => parseLongMemEvalDataset(misaligned)).toThrow(
			"misaligned haystack arrays",
		);
		const missingEvidence = JSON.parse(JSON.stringify(fixture));
		missingEvidence[0].answer_session_ids = ["not-in-haystack"];
		expect(() => parseLongMemEvalDataset(missingEvidence)).toThrow(
			"outside its haystack",
		);
	});
});
