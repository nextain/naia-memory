import { describe, expect, it } from "vitest";
import {
	explainDeleteGrounding,
	hasGroundedDeleteEvidence,
	namesPropertyLabel,
	type DeleteGroundingInput,
} from "../delete-grounding.js";
import {
	type LLMFactExtractionFailure,
	parseLLMFactResponse,
} from "../llm-fact-extractor.js";
import type { Episode } from "../types.js";

// Shapes observed in the 2026-09-05 Gemini run on synthetic fixtures: the model
// emitted a delete for an explicit removal request whose target quote does not
// repeat the value, without subjectId/propertyId.
const explicitRemoval: DeleteGroundingInput = {
	episodeContent: "기억에서 창고 출입 암호를 지워 줘. 암호 값을 다시 알려 주지 마.",
	episodeRole: "user",
	evidenceKind: "explicit_removal_request",
	evidenceQuote: "기억에서 창고 출입 암호를 지워 줘. 암호 값을 다시 알려 주지 마.",
	targetQuote: "창고 출입 암호",
	subject: "창고",
	property: "출입 암호",
	value: "달빛상자",
	polarity: "affirmed",
};

const cancellation: DeleteGroundingInput = {
	episodeContent: "Cancel the Monday language lesson. Keep the Wednesday swimming lesson.",
	episodeRole: "user",
	evidenceKind: "explicit_removal_request",
	evidenceQuote: "Cancel the Monday language lesson. Keep the Wednesday swimming lesson.",
	targetQuote: "Monday language lesson",
	subject: "User",
	property: "booked activity",
	value: "language lesson",
	subjectId: "person:self",
	propertyId: "plan:activity",
	polarity: "affirmed",
};

describe("explainDeleteGrounding", () => {
	const variants: DeleteGroundingInput[] = [
		explicitRemoval,
		cancellation,
		{ ...explicitRemoval, subjectId: "person:self", propertyId: "profile:secret" },
		{ ...explicitRemoval, evidenceQuote: "창고 출입 암호를 지워 줘." },
		{ ...explicitRemoval, targetQuote: "없는 대상" },
		{ ...explicitRemoval, episodeRole: "assistant" },
		{ ...explicitRemoval, polarity: "negated" },
		{ ...explicitRemoval, value: "" },
		{ ...explicitRemoval, evidenceKind: "maybe" },
		{ ...cancellation, subjectId: undefined, propertyId: undefined },
		{ ...cancellation, value: "swimming" },
		{ ...explicitRemoval, property: "비밀 값" },
		{ ...explicitRemoval, evidenceKind: "durable_cessation" },
		{ ...explicitRemoval, evidenceQuote: `[Date: 2026-07-03] ${explicitRemoval.episodeContent}` },
		{ ...explicitRemoval, evidenceQuote: `[Note: 2026-07-03] ${explicitRemoval.episodeContent}` },
		{ ...explicitRemoval, targetQuote: "출입 암호", property: "창고 출입 암호" },
	];

	it("is empty exactly when the delete is grounded", () => {
		for (const input of variants) {
			expect(explainDeleteGrounding(input).length === 0).toBe(
				hasGroundedDeleteEvidence(input),
			);
		}
	});

	it("grounds a value-free explicit removal whose target quote names the property", () => {
		expect(hasGroundedDeleteEvidence(explicitRemoval)).toBe(true);
		expect(explainDeleteGrounding(explicitRemoval)).toEqual([]);
	});

	it("names the condition that rejects a value-free removal that does not name the property", () => {
		const unnamed = { ...explicitRemoval, property: "비밀 값" };
		expect(hasGroundedDeleteEvidence(unnamed)).toBe(false);
		expect(explainDeleteGrounding(unnamed)).toEqual(["target-lacks-value-and-identity"]);
		const cessation = { ...explicitRemoval, evidenceKind: "durable_cessation" };
		expect(hasGroundedDeleteEvidence(cessation)).toBe(false);
	});
	it("accepts an evidence quote that copied the extractor's date tag, and no other prefix", () => {
		// Korean confirmation set ko-111: the prompt shows "[3] [Date: 2026-07-03] ...".
		const tagged = { ...explicitRemoval, evidenceQuote: `[Date: 2026-07-03] ${explicitRemoval.episodeContent}` };
		expect(hasGroundedDeleteEvidence(tagged)).toBe(true);
		const other = { ...explicitRemoval, evidenceQuote: `[Note: 2026-07-03] ${explicitRemoval.episodeContent}` };
		expect(explainDeleteGrounding(other)).toEqual(["evidence-not-whole-episode"]);
		const partial = { ...explicitRemoval, evidenceQuote: "[Date: 2026-07-03] 기억에서 창고 출입 암호를 지워 줘." };
		expect(explainDeleteGrounding(partial)).toEqual(["evidence-not-whole-episode"]);
	});
});

describe("namesPropertyLabel", () => {
	it("matches a shortened label and a reordered qualifier with attached particles", () => {
		// ko-043: the user shortened the label.
		expect(namesPropertyLabel("이메일 비밀번호", "테스트용 가상 이메일 비밀번호")).toBe(true);
		// ko-84: the qualifier moved into parentheses, the target carries "의".
		expect(namesPropertyLabel("서리 프로젝트의 테스트 계정 비밀번호", "테스트 계정 비밀번호(서리 프로젝트)")).toBe(true);
		expect(namesPropertyLabel("Monday lesson", "lesson")).toBe(true);
	});

	it("does not match a different secret or a label sharing only some words", () => {
		expect(namesPropertyLabel("금고 비밀번호", "이메일 비밀번호")).toBe(false);
		expect(namesPropertyLabel("서리 프로젝트의 비밀번호", "테스트 계정 비밀번호(달빛 프로젝트)")).toBe(false);
		// ko-046 stays unmatched: the demonstrative is a word the label lacks.
		expect(namesPropertyLabel("그 클라우드 접속 암호", "가상 클라우드 접속 암호")).toBe(false);
		expect(namesPropertyLabel("  ", "암호")).toBe(false);
	});
});

function episode(id: string, content: string): Episode {
	return {
		id,
		content,
		role: "user",
		summary: content,
		timestamp: 1,
		importance: { importance: 0.5, surprise: 0, emotion: 0.5, utility: 0.5 },
		encodingContext: { project: "p" },
		consolidated: false,
		recallCount: 0,
		lastAccessed: 1,
		strength: 1,
	} as Episode;
}

function envelope(content: unknown) {
	return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] };
}

describe("parseLLMFactResponse delete rejection", () => {
	it("reports a rejected delete instead of dropping it silently and keeps other facts", () => {
		const episodes = [
			episode("e1", "창고 출입 암호는 달빛상자야. 테스트용 가상 암호야."),
			episode("e2", explicitRemoval.episodeContent),
		];
		const rejected: LLMFactExtractionFailure[] = [];
		const facts = parseLLMFactResponse(
			envelope({
				"1": ["창고 출입 암호: 달빛상자"],
				"2": [
					{
						content: "창고 출입 암호: 달빛상자",
						operation: "delete",
						deleteEvidenceKind: "explicit_removal_request",
						deleteEvidenceQuote: explicitRemoval.evidenceQuote,
						deleteTargetQuote: explicitRemoval.targetQuote,
						structured: { subject: "창고", property: "비밀 값", value: "달빛상자", polarity: "affirmed", cardinality: "single" },
					},
					"사용자는 창고 암호 삭제를 요청함",
				],
			}),
			episodes,
			{ onDeleteRejected: (failure) => rejected.push(failure) },
		);
		expect(facts.map((f) => f.content)).toEqual([
			"창고 출입 암호: 달빛상자",
			"사용자는 창고 암호 삭제를 요청함",
		]);
		expect(facts.some((f) => f.operation === "delete")).toBe(false);
		expect(rejected).toHaveLength(1);
		expect(rejected[0].code).toBe("delete-ungrounded");
		expect(rejected[0].message).toContain("target-lacks-value-and-identity");
	});

	it("keeps a grounded delete and reports nothing", () => {
		const rejected: LLMFactExtractionFailure[] = [];
		const facts = parseLLMFactResponse(
			envelope({
				"1": [
					{
						content: "User has a Monday language lesson scheduled.",
						operation: "delete",
						deleteEvidenceKind: "explicit_removal_request",
						deleteEvidenceQuote: cancellation.evidenceQuote,
						deleteTargetQuote: cancellation.targetQuote,
						structured: { subject: "User", subjectId: "person:self", property: "booked activity", propertyId: "plan:activity", value: "language lesson", polarity: "affirmed", cardinality: "multi" },
					},
				],
			}),
			[episode("e1", cancellation.episodeContent)],
			{ onDeleteRejected: (failure) => rejected.push(failure) },
		);
		expect(facts).toHaveLength(1);
		expect(facts[0].operation).toBe("delete");
		expect(rejected).toEqual([]);
	});
});
