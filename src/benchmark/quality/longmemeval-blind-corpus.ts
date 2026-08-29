import { createHash } from "node:crypto";
import type {
	LongMemEvalCase,
	LongMemEvalDataset,
} from "./longmemeval-contract.js";

export const LONGMEMEVAL_BLIND_CORPUS_SCHEMA =
	"naia-memory-longmemeval-blind-corpus-v1" as const;

export type LongMemEvalBlindCase = Pick<
	LongMemEvalCase,
	| "question_id"
	| "question_type"
	| "question"
	| "question_date"
	| "haystack_session_ids"
	| "haystack_dates"
> & {
	haystack_sessions: Array<
		Array<{ role: "user" | "assistant"; content: string }>
	>;
};

export type LongMemEvalBlindCorpus = {
	schemaVersion: typeof LONGMEMEVAL_BLIND_CORPUS_SCHEMA;
	cases: LongMemEvalBlindCase[];
};

export function createLongMemEvalBlindCorpus(
	dataset: LongMemEvalDataset,
): LongMemEvalBlindCorpus {
	return {
		schemaVersion: LONGMEMEVAL_BLIND_CORPUS_SCHEMA,
		cases: dataset.map((item) => ({
			question_id: item.question_id,
			question_type: item.question_type,
			question: item.question,
			question_date: item.question_date,
			haystack_session_ids: [...item.haystack_session_ids],
			haystack_dates: [...item.haystack_dates],
			haystack_sessions: item.haystack_sessions.map((session) =>
				session.map(({ role, content }) => ({ role, content })),
			),
		})),
	};
}

export function validateLongMemEvalBlindCorpus(
	value: unknown,
): asserts value is LongMemEvalBlindCorpus {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("blind corpus must be an object");
	const corpus = value as Record<string, unknown>;
	if (corpus.schemaVersion !== LONGMEMEVAL_BLIND_CORPUS_SCHEMA)
		throw new Error("blind corpus schema mismatch");
	if (!Array.isArray(corpus.cases) || corpus.cases.length !== 500)
		throw new Error("blind corpus must contain exactly 500 cases");
	const serialized = JSON.stringify(value);
	for (const forbidden of ["answer", "answer_session_ids", "has_answer"])
		if (serialized.includes(`\"${forbidden}\"`))
			throw new Error(`blind corpus contains forbidden field ${forbidden}`);
}

export function blindCorpusSha256(corpus: LongMemEvalBlindCorpus): string {
	return createHash("sha256").update(JSON.stringify(corpus)).digest("hex");
}
