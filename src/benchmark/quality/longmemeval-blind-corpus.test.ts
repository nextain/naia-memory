import { describe, expect, it } from "vitest";
import {
	blindCorpusSha256,
	createLongMemEvalBlindCorpus,
	validateLongMemEvalBlindCorpus,
} from "./longmemeval-blind-corpus.js";
import type { LongMemEvalCase } from "./longmemeval-contract.js";

function fixture(index: number): LongMemEvalCase {
	return {
		question_id: `q-${index}`,
		question_type: "single-session-user",
		question: "What did I say?",
		answer: "secret answer",
		question_date: "2024/01/02 (Tue) 00:00",
		haystack_session_ids: ["session-1"],
		haystack_dates: ["2024/01/01 (Mon) 00:00"],
		haystack_sessions: [
			[
				{ role: "user", content: "public memory", has_answer: true },
				{ role: "assistant", content: "acknowledged", has_answer: false },
			],
		],
		answer_session_ids: ["session-1"],
	};
}

describe("LongMemEval blind corpus", () => {
	it("removes every quality label while preserving retrieval inputs", () => {
		const corpus = createLongMemEvalBlindCorpus(
			Array.from({ length: 500 }, (_, index) => fixture(index)),
		);

		expect(() => validateLongMemEvalBlindCorpus(corpus)).not.toThrow();
		expect(JSON.stringify(corpus)).not.toContain("secret answer");
		expect(JSON.stringify(corpus)).not.toContain("answer_session_ids");
		expect(JSON.stringify(corpus)).not.toContain("has_answer");
		expect(corpus.cases[0]?.haystack_sessions[0]?.[0]).toEqual({
			role: "user",
			content: "public memory",
		});
	});

	it("has a deterministic content digest", () => {
		const corpus = createLongMemEvalBlindCorpus(
			Array.from({ length: 500 }, (_, index) => fixture(index)),
		);

		expect(blindCorpusSha256(corpus)).toBe(blindCorpusSha256(corpus));
		expect(blindCorpusSha256(corpus)).toMatch(/^[a-f0-9]{64}$/u);
	});

	it("rejects a corpus with a reintroduced label", () => {
		const corpus = createLongMemEvalBlindCorpus(
			Array.from({ length: 500 }, (_, index) => fixture(index)),
		) as unknown as Record<string, unknown>;
		(corpus.cases as Array<Record<string, unknown>>)[0].answer = "leak";

		expect(() => validateLongMemEvalBlindCorpus(corpus)).toThrow(
			"forbidden field answer",
		);
	});
});
