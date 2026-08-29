import { createHash } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { LocalAdapter } from "../../memory/adapters/local.js";
import { HeuristicContradictionFilter } from "../../memory/contradiction-filter.js";
import { MemorySystem } from "../../memory/memory-system.js";
import type { LongMemEvalProtocolRecord } from "./longmemeval-contract.js";

export const LONGMEMEVAL_NAIA_E2E_SCHEMA =
	"naia-memory-longmemeval-naia-e2e-v1" as const;
export const LONGMEMEVAL_NAIA_RETRIEVAL_POLICY = {
	engine: "MemorySystem.encode+recall/LocalAdapter",
	embedder: "none:keyword-fallback",
	topK: 10,
	deepRecall: true,
	scopeMode: "strict",
	crossProject: false,
	consolidation: false,
	generation: false,
	judge: false,
} as const;

export type LongMemEvalNaiaCaseResult = {
	questionId: string;
	questionType: string;
	isAbstention: boolean;
	inputSessionCount: number;
	inputTurnCount: number;
	storedEpisodeCount: number;
	inputProjectionSha256: string;
	storedProjectionSha256: string;
	roundTripMatch: boolean;
	storeBytes: number;
	encodeElapsedMs: number;
	recallElapsedMs: number;
	retrieval: Array<{
		rank: number;
		episodeId: string;
		sessionOrdinal: number;
		turnOrdinal: number;
		role: "user" | "assistant" | "tool" | null;
	}>;
	error: string | null;
};

function parseOfficialDate(value: string): number {
	const match =
		/^(\d{4})\/(\d{2})\/(\d{2}) \([A-Za-z]{3}\) (\d{2}):(\d{2})$/u.exec(value);
	if (!match) throw new Error(`unsupported LongMemEval date: ${value}`);
	const [, year, month, day, hour, minute] = match;
	const timestamp = Date.UTC(
		Number(year),
		Number(month) - 1,
		Number(day),
		Number(hour),
		Number(minute),
	);
	if (!Number.isFinite(timestamp)) throw new Error(`invalid date: ${value}`);
	return timestamp;
}

function safeCaseName(questionId: string): string {
	return `${createHash("sha256").update(questionId).digest("hex").slice(0, 16)}.json`;
}

function sha256(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function longMemEvalNaiaRetrievalSha256(
	results: readonly LongMemEvalNaiaCaseResult[],
): string {
	const stable = results.map(
		({
			encodeElapsedMs: _encode,
			recallElapsedMs: _recall,
			storeBytes: _bytes,
			...result
		}) => result,
	);
	return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export async function runLongMemEvalNaiaE2E(
	records: readonly LongMemEvalProtocolRecord[],
	storesDirectory: string,
): Promise<LongMemEvalNaiaCaseResult[]> {
	await mkdir(storesDirectory, { recursive: true });
	const results: LongMemEvalNaiaCaseResult[] = [];
	for (const record of records) {
		const storePath = join(storesDirectory, safeCaseName(record.questionId));
		const adapter = new LocalAdapter({ storePath, disableKGSpreading: true });
		const memory = new MemorySystem({
			adapter,
			disableImportanceGating: true,
			contradictionFilter: new HeuristicContradictionFilter(),
		});
		const coordinates = new Map<
			string,
			{ sessionOrdinal: number; turnOrdinal: number }
		>();
		const inputTurnCount = record.sessions.reduce(
			(sum, session) => sum + session.turns.length,
			0,
		);
		let encodeElapsedMs = 0;
		let recallElapsedMs = 0;
		let storedEpisodeCount = 0;
		let inputProjectionSha256 = "";
		let storedProjectionSha256 = "";
		let roundTripMatch = false;
		let storeBytes = 0;
		let retrieval: LongMemEvalNaiaCaseResult["retrieval"] = [];
		let error: string | null = null;
		const expectedProjection: Array<{
			id: string;
			content: string;
			role: "user" | "assistant";
			timestamp: number;
			project: string;
			sessionId: string;
		}> = [];
		try {
			await memory.init();
			const encodeStarted = process.hrtime.bigint();
			for (const session of record.sessions) {
				const sessionKey = `${session.ordinal}:${session.sessionIdOccurrence}:${session.sessionId}`;
				const sessionTimestamp = parseOfficialDate(session.date);
				for (const turn of session.turns) {
					const episode = await memory.encode(
						{
							content: turn.content,
							role: turn.role,
							timestamp: sessionTimestamp + turn.ordinal,
							idempotencyKey: `${record.questionId}:${session.ordinal}:${turn.ordinal}`,
						},
						{ project: record.questionId, sessionId: sessionKey },
					);
					coordinates.set(episode.id, {
						sessionOrdinal: session.ordinal,
						turnOrdinal: turn.ordinal,
					});
					expectedProjection.push({
						id: episode.id,
						content: turn.content,
						role: turn.role,
						timestamp: sessionTimestamp + turn.ordinal,
						project: record.questionId,
						sessionId: sessionKey,
					});
				}
			}
			encodeElapsedMs =
				Number(process.hrtime.bigint() - encodeStarted) / 1_000_000;
			storedEpisodeCount = adapter.getStore().episodes.length;
			const storedProjection = adapter.getStore().episodes.map((episode) => ({
				id: episode.id,
				content: episode.content,
				role: episode.role,
				timestamp: episode.timestamp,
				project: episode.encodingContext.project,
				sessionId: episode.encodingContext.sessionId,
			}));
			inputProjectionSha256 = sha256(expectedProjection);
			storedProjectionSha256 = sha256(storedProjection);
			roundTripMatch = inputProjectionSha256 === storedProjectionSha256;
			const recallStarted = process.hrtime.bigint();
			const recalled = await memory.recall(record.question, {
				project: record.questionId,
				topK: LONGMEMEVAL_NAIA_RETRIEVAL_POLICY.topK,
				deepRecall: true,
				scopeMode: "strict",
				crossProject: false,
			});
			recallElapsedMs =
				Number(process.hrtime.bigint() - recallStarted) / 1_000_000;
			retrieval = recalled.episodes.map((episode, rank) => {
				const coordinate = coordinates.get(episode.id);
				if (!coordinate)
					throw new Error(`recalled unknown episode ${episode.id}`);
				return {
					rank: rank + 1,
					episodeId: episode.id,
					...coordinate,
					role: episode.role ?? null,
				};
			});
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		} finally {
			try {
				await memory.close();
				storeBytes = (await stat(storePath)).size;
			} catch (caught) {
				error ??= caught instanceof Error ? caught.message : String(caught);
			}
		}
		results.push({
			questionId: record.questionId,
			questionType: record.questionType,
			isAbstention: record.isAbstention,
			inputSessionCount: record.sessions.length,
			inputTurnCount,
			storedEpisodeCount,
			inputProjectionSha256,
			storedProjectionSha256,
			roundTripMatch,
			storeBytes,
			encodeElapsedMs,
			recallElapsedMs,
			retrieval,
			error,
		});
	}
	return results;
}
