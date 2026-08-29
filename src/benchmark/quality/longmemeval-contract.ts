import { createHash } from "node:crypto";

export const LONGMEMEVAL_QUESTION_TYPES = [
	"single-session-user",
	"single-session-assistant",
	"single-session-preference",
	"temporal-reasoning",
	"knowledge-update",
	"multi-session",
] as const;

export type LongMemEvalQuestionType =
	(typeof LONGMEMEVAL_QUESTION_TYPES)[number];

export type LongMemEvalTurn = {
	role: "user" | "assistant";
	content: string;
	/** The cleaned 2025-09 release contains both true and false labels. */
	has_answer?: boolean;
};

export type LongMemEvalCase = {
	question_id: string;
	question_type: LongMemEvalQuestionType;
	question: string;
	answer: string | number;
	question_date: string;
	haystack_session_ids: string[];
	haystack_dates: string[];
	haystack_sessions: LongMemEvalTurn[][];
	answer_session_ids: string[];
};

export type LongMemEvalDataset = readonly LongMemEvalCase[];

export type LongMemEvalProtocolRecord = {
	schemaVersion: "naia-memory-longmemeval-protocol-v1";
	questionId: string;
	questionType: LongMemEvalQuestionType;
	isAbstention: boolean;
	question: string;
	expectedAnswer: string | number;
	questionDate: string;
	answerSessionIds: string[];
	sessions: Array<{
		sessionId: string;
		/** Zero-based occurrence disambiguates duplicate source session IDs. */
		sessionIdOccurrence: number;
		date: string;
		ordinal: number;
		turns: Array<{
			role: "user" | "assistant";
			content: string;
			/** null means the source field was absent; false remains distinct. */
			hasAnswerLabel: boolean | null;
			ordinal: number;
		}>;
	}>;
};

function record(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("LongMemEval item must be an object");
	return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
	if (typeof value !== "string" || value.length === 0)
		throw new Error(`${field} must be a non-empty string`);
	return value;
}

function stringValue(value: unknown, field: string): string {
	if (typeof value !== "string") throw new Error(`${field} must be a string`);
	return value;
}

function stringArray(value: unknown, field: string): string[] {
	if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
	return value.map((entry, index) => text(entry, `${field}[${index}]`));
}

function answer(value: unknown, field: string): string | number {
	if (typeof value === "string" && value.length > 0) return value;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	throw new Error(`${field} must be a non-empty string or finite number`);
}

function parseTurn(value: unknown, field: string): LongMemEvalTurn {
	const source = record(value);
	if (source.role !== "user" && source.role !== "assistant")
		throw new Error(`${field}.role must be user or assistant`);
	if (source.has_answer !== undefined && typeof source.has_answer !== "boolean")
		throw new Error(`${field}.has_answer must be boolean when present`);
	return {
		role: source.role,
		content: stringValue(source.content, `${field}.content`),
		...(typeof source.has_answer === "boolean"
			? { has_answer: source.has_answer }
			: {}),
	};
}

/** Parse the official cleaned LongMemEval JSON without coercing semantic fields. */
export function parseLongMemEvalDataset(value: unknown): LongMemEvalCase[] {
	if (!Array.isArray(value))
		throw new Error("LongMemEval dataset must be an array");
	const ids = new Set<string>();
	return value.map((entry, caseIndex) => {
		const source = record(entry);
		const questionId = text(
			source.question_id,
			`case[${caseIndex}].question_id`,
		);
		if (ids.has(questionId))
			throw new Error(`duplicate question_id: ${questionId}`);
		ids.add(questionId);
		if (
			typeof source.question_type !== "string" ||
			!LONGMEMEVAL_QUESTION_TYPES.includes(
				source.question_type as LongMemEvalQuestionType,
			)
		)
			throw new Error(`${questionId}.question_type is unsupported`);
		const sessionIds = stringArray(
			source.haystack_session_ids,
			`${questionId}.haystack_session_ids`,
		);
		const dates = stringArray(
			source.haystack_dates,
			`${questionId}.haystack_dates`,
		);
		if (!Array.isArray(source.haystack_sessions))
			throw new Error(`${questionId}.haystack_sessions must be an array`);
		if (
			sessionIds.length !== dates.length ||
			sessionIds.length !== source.haystack_sessions.length
		)
			throw new Error(`${questionId} has misaligned haystack arrays`);
		const sessions = source.haystack_sessions.map((session, sessionIndex) => {
			if (!Array.isArray(session))
				throw new Error(
					`${questionId}.haystack_sessions[${sessionIndex}] must be an array`,
				);
			return session.map((turn, turnIndex) =>
				parseTurn(
					turn,
					`${questionId}.haystack_sessions[${sessionIndex}][${turnIndex}]`,
				),
			);
		});
		const answerSessionIds = stringArray(
			source.answer_session_ids,
			`${questionId}.answer_session_ids`,
		);
		if (answerSessionIds.some((id) => !sessionIds.includes(id)))
			throw new Error(
				`${questionId} references an answer session outside its haystack`,
			);
		return {
			question_id: questionId,
			question_type: source.question_type as LongMemEvalQuestionType,
			question: text(source.question, `${questionId}.question`),
			answer: answer(source.answer, `${questionId}.answer`),
			question_date: text(source.question_date, `${questionId}.question_date`),
			haystack_session_ids: sessionIds,
			haystack_dates: dates,
			haystack_sessions: sessions,
			answer_session_ids: answerSessionIds,
		};
	});
}

/** Lossless boundary record used before any Naia-specific indexing or retrieval. */
export function toLongMemEvalProtocolRecord(
	benchmarkCase: LongMemEvalCase,
): LongMemEvalProtocolRecord {
	return {
		schemaVersion: "naia-memory-longmemeval-protocol-v1",
		questionId: benchmarkCase.question_id,
		questionType: benchmarkCase.question_type,
		isAbstention: benchmarkCase.question_id.endsWith("_abs"),
		question: benchmarkCase.question,
		expectedAnswer: benchmarkCase.answer,
		questionDate: benchmarkCase.question_date,
		answerSessionIds: [...benchmarkCase.answer_session_ids],
		sessions: benchmarkCase.haystack_sessions.map((turns, ordinal) => {
			const sessionId = benchmarkCase.haystack_session_ids[ordinal] as string;
			return {
				sessionId,
				sessionIdOccurrence: benchmarkCase.haystack_session_ids
					.slice(0, ordinal)
					.filter((candidate) => candidate === sessionId).length,
				date: benchmarkCase.haystack_dates[ordinal] as string,
				ordinal,
				turns: turns.map((turn, turnOrdinal) => ({
					role: turn.role,
					content: turn.content,
					hasAnswerLabel: turn.has_answer ?? null,
					ordinal: turnOrdinal,
				})),
			};
		}),
	};
}

export function longMemEvalProtocolSha256(
	records: readonly LongMemEvalProtocolRecord[],
): string {
	return createHash("sha256").update(JSON.stringify(records)).digest("hex");
}
