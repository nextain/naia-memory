import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	parseLongMemEvalDataset,
	toLongMemEvalProtocolRecord,
} from "./longmemeval-contract.js";
import {
	longMemEvalNaiaRetrievalSha256,
	runLongMemEvalNaiaE2E,
} from "./longmemeval-naia-e2e.js";

const fixture = [
	{
		question_id: "q-e2e-1",
		question_type: "multi-session",
		question: "Where did I move?",
		answer: "Seoul",
		question_date: "2024/01/03 (Wed) 10:00",
		haystack_session_ids: ["duplicate", "duplicate"],
		haystack_dates: ["2024/01/01 (Mon) 10:00", "2024/01/02 (Tue) 10:00"],
		haystack_sessions: [
			[{ role: "user", content: "I lived in Busan." }],
			[{ role: "user", content: "I moved to Seoul.", has_answer: true }],
		],
		answer_session_ids: ["duplicate"],
	},
] as const;

describe("LongMemEval Naia E2E", () => {
	it("encodes every turn through MemorySystem and produces stable retrieval identities", async () => {
		const records = parseLongMemEvalDataset(fixture).map(
			toLongMemEvalProtocolRecord,
		);
		const firstDir = await mkdtemp(join(tmpdir(), "naia-longmemeval-first-"));
		const secondDir = await mkdtemp(join(tmpdir(), "naia-longmemeval-second-"));
		const first = await runLongMemEvalNaiaE2E(records, firstDir);
		const second = await runLongMemEvalNaiaE2E(records, secondDir);
		expect(first[0]).toMatchObject({
			inputTurnCount: 2,
			storedEpisodeCount: 2,
			roundTripMatch: true,
			error: null,
		});
		expect(first[0]?.retrieval[0]).toMatchObject({
			sessionOrdinal: 1,
			turnOrdinal: 0,
		});
		expect(longMemEvalNaiaRetrievalSha256(first)).toBe(
			longMemEvalNaiaRetrievalSha256(second),
		);
		const files = await readdir(firstDir);
		const persisted = JSON.parse(
			await readFile(join(firstDir, files[0] as string), "utf8"),
		);
		expect(persisted.episodes).toHaveLength(2);
	});
});
