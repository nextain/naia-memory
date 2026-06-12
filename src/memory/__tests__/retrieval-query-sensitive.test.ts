/**
 * Retrieval is query-sensitive — top-1 selection tracks the query (memory side).
 *
 * Scope (deliberately narrow). This proves ONE retrieval-quality property: over
 * a SINGLE store, two different queries return two different topically-matching
 * top-1 results. So retrieval SELECTS by the query's topic — it does not return
 * one fixed item regardless of query. This is distinct from the G2 single-query
 * round-trip. It is a selection/filtering property; it does NOT claim to rank a
 * relevant-but-older item above a co-matching newer one.
 *
 * It does NOT prove G3's value claim — that memory measurably improves an
 * agent's *responses*, causally separated from the model's own knowledge. That
 * is a behavioral comparison requiring a real agent loop + LLM and is the
 * new-naia-agent session's responsibility (handoff). No model participates here,
 * so no claim is made about model priors; the fixture is simply the only source
 * of the facts it stores.
 *
 * Deterministic: LocalAdapter (operational), no embedder, and consolidation is
 * never invoked (the default heuristic fact extractor is present but unused), so
 * recall returns episodes by keyword. Timestamps are explicit and recent, so the
 * AGE-based decay factor is near-uniform across items (heuristic importance still
 * varies by content — e.g. "비밀" raises utility — which is fine: the assertions
 * test which query returns which item, not absolute strengths).
 */

import { existsSync, unlinkSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { type EncodingContext, LocalAdapter, MemorySystem } from "../index.js";
import type { Episode, Fact } from "../types.js";

describe("Retrieval is query-sensitive: top-1 selection tracks the query", () => {
	const tmpPaths: string[] = [];
	const instances: MemorySystem[] = [];
	const ctx: EncodingContext = { project: "personal" };

	const makeMemory = (label: string): MemorySystem => {
		const p = `/tmp/retr-qs-${label}-${Date.now()}-${Math.random()}.json`;
		tmpPaths.push(p);
		const m = new MemorySystem({ adapter: new LocalAdapter({ storePath: p }) });
		instances.push(m);
		return m;
	};

	const availableContext = (r: { episodes: Episode[]; facts: Fact[] }): string =>
		[...r.facts.map((f) => f.content), ...r.episodes.map((e) => e.content)].join(
			"\n",
		);

	afterEach(async () => {
		for (const m of instances) {
			try {
				await m.close();
			} catch {}
		}
		instances.length = 0;
		for (const p of tmpPaths) if (existsSync(p)) try { unlinkSync(p); } catch {}
		tmpPaths.length = 0;
	});

	const SECRET = "내 비밀 프로젝트 코드명은 '크밤부리알파7'이고 목표 출시는 2031년이야";
	const SECRET_TOKEN = "크밤부리알파7";
	const LUNCH = "오늘 점심은 김치찌개로 정했어";

	const TURNS = [
		SECRET,
		LUNCH,
		"내일 비 온다던데",
		"회의는 오후 3시야",
		"음악 좀 추천해줘",
		"주말에 등산 갈까 해",
	];

	// Explicit, strictly-increasing, RECENT timestamps: recent so the age-based
	// decay factor is near-uniform and items stay above the recall floor; spaced
	// 100ms so no two tie. (encode() would otherwise stamp wall-clock millis, which
	// can tie in a fast loop.)
	const seed = async (m: MemorySystem): Promise<void> => {
		let t = Date.now() - 10_000;
		for (const content of TURNS) {
			await m.encode({ content, role: "user", timestamp: t }, ctx);
			t += 100;
		}
	};

	it("two queries over ONE store return two different topical top-1 hits", async () => {
		const m = makeMemory("one-store");
		await seed(m);

		// Query A — the project secret.
		const a = availableContext(
			await m.recall("내 비밀 프로젝트 코드명이 뭐였지?", {
				project: "personal",
				topK: 1,
			}),
		);
		expect(a).toContain(SECRET_TOKEN);

		// Query B — a food topic, over the SAME store.
		const b = availableContext(
			await m.recall("점심 뭐 먹었지?", { project: "personal", topK: 1 }),
		);
		expect(b).toContain("점심"); // returns the food turn…
		expect(b).not.toContain(SECRET_TOKEN); // …not the secret

		// One store, two queries, two different top-1 results → selection tracks
		// the query (a fixed recency/insertion-only return would give the same
		// item for both, failing one of the assertions above).
	});
});
