import { describe, expect, it } from "vitest";
import {
	explainDeleteGrounding,
	hasGroundedDeleteEvidence,
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
	];

	it("is empty exactly when the delete is grounded", () => {
		for (const input of variants) {
			expect(explainDeleteGrounding(input).length === 0).toBe(
				hasGroundedDeleteEvidence(input),
			);
		}
	});

	it("names the condition that rejects a value-free explicit removal", () => {
		expect(hasGroundedDeleteEvidence(explicitRemoval)).toBe(false);
		expect(explainDeleteGrounding(explicitRemoval)).toEqual([
			"target-lacks-value-and-identity",
		]);
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
						structured: { subject: "창고", property: "출입 암호", value: "달빛상자", polarity: "affirmed", cardinality: "single" },
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
