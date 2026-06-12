/**
 * Agent turn-loop integration — proves @nextain/naia-memory is consumable as
 * the agent's long-term memory through its PUBLIC barrel only (encode + recall).
 *
 * This is the memory-SIDE consumability / handoff PROOF (G2, naia-memory side).
 * It proves the public surface (encode/recall) SUPPORTS the illustrated agent
 * turn-loop handoff — exercised through an in-file illustrative adapter, NOT a
 * real agent loop or prompt injection. It does NOT perform or complete the
 * agent-side wiring — that lives in new-naia-agent under its own governance. The
 * `AgentMemoryAdapter` below is an ILLUSTRATIVE shape a hexagonal consumer
 * (new-naia-agent) lifts behind its own `MemoryPort` —
 *   • pre-turn  → recall(userMessage) → inject formatted context into the prompt
 *   • post-turn → encode(userMessage) + encode(assistantReply)
 *
 * Imports come from the package barrel (`../index.js`, the module the package
 * `.` export maps to) so a broken barrel export fails this test, not just a
 * broken deep path.
 *
 * Uses LocalAdapter (the operational adapter) with NO embeddingProvider and NO
 * factExtractor, so the round-trip is deterministic and dependency-free: recall
 * surfaces prior turns by keyword. A real consumer plugs its own embedding /
 * fact-extraction providers in for semantic recall; the surface contract proven
 * here is unchanged.
 */

import { existsSync, unlinkSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type EncodingContext,
	LocalAdapter,
	MemorySystem,
	type RecallContext,
} from "../index.js";

// ─── Illustrative reference adapter (copy AND adapt into the agent's adapters/) ─
// L03 boundary: EVERYTHING in this class is agent-owned example policy — topK,
// the prompt labels, fact/episode ordering, and the RecalledForPrompt shape. The
// agent copies this and changes all of it freely; naia-memory prescribes NONE of
// it. The only fixed contract is the public surface this calls: encode() +
// recall(). topK and formatLine are surfaced as params merely to show two of the
// knobs — the agent may replace the whole adapter.

interface RecalledForPrompt {
	/** Human-injectable context block, empty string when nothing relevant. */
	promptBlock: string;
	episodeCount: number;
	factCount: number;
}

interface RecallFormat {
	/** Agent-owned: how many memories to pull. Example default = 5. */
	topK?: number;
	/** Agent-owned: how each recalled item is rendered into the prompt. */
	formatLine?: (kind: "fact" | "episode", content: string) => string;
}

class AgentMemoryAdapter {
	constructor(private readonly memory: MemorySystem) {}

	/** Pre-turn: recall relevant memory and format it for prompt injection. */
	async recallForTurn(
		userMessage: string,
		ctx: RecallContext = {},
		fmt: RecallFormat = {},
	): Promise<RecalledForPrompt> {
		const topK = fmt.topK ?? 5; // EXAMPLE default — agent owns this
		const formatLine =
			fmt.formatLine ??
			((kind, content) =>
				kind === "fact" ? `- (기억) ${content}` : `- (이전 대화) ${content}`);

		// Spread ctx first so the adapter's explicit topK wins over any topK the
		// caller happened to put in ctx.
		const { episodes, facts } = await this.memory.recall(userMessage, {
			...ctx,
			topK,
		});
		const lines = [
			...facts.map((f) => formatLine("fact", f.content)),
			...episodes.map((e) => formatLine("episode", e.content)),
		];
		return {
			promptBlock: lines.length ? lines.join("\n") : "",
			episodeCount: episodes.length,
			factCount: facts.length,
		};
	}

	/** Post-turn: persist both sides of the exchange. */
	async saveTurn(
		userMessage: string,
		assistantReply: string,
		ctx: EncodingContext = {},
	): Promise<void> {
		await this.memory.encode({ content: userMessage, role: "user" }, ctx);
		await this.memory.encode(
			{ content: assistantReply, role: "assistant" },
			ctx,
		);
	}
}

describe("naia-memory public surface — agent turn-loop handoff (consumability proof)", () => {
	let agentMemory: AgentMemoryAdapter;
	const tmpPaths: string[] = [];
	// Every MemorySystem made in a test is tracked here and closed in afterEach —
	// closing first cancels LocalAdapter's 2s debounce timer, so it can't recreate
	// a store file after we unlink it (even when a test throws mid-way).
	const instances: MemorySystem[] = [];
	const ctx: EncodingContext & RecallContext = { project: "personal" };

	const newStorePath = (label: string): string => {
		const p = `/tmp/agent-turn-${label}-${Date.now()}-${Math.random()}.json`;
		tmpPaths.push(p);
		return p;
	};

	const makeMemory = (label: string): MemorySystem => {
		const m = new MemorySystem({
			adapter: new LocalAdapter({ storePath: newStorePath(label) }),
		});
		instances.push(m);
		return m;
	};

	beforeEach(() => {
		agentMemory = new AgentMemoryAdapter(makeMemory("main"));
	});

	afterEach(async () => {
		// Close BEFORE unlink so no pending save timer resurrects a deleted file.
		for (const m of instances) {
			try {
				await m.close();
			} catch {}
		}
		instances.length = 0;
		for (const p of tmpPaths) if (existsSync(p)) try { unlinkSync(p); } catch {}
		tmpPaths.length = 0;
	});

	it("recalls a fact from an OLD turn — beyond the recency window (falsifiable)", async () => {
		const r0 = await agentMemory.recallForTurn("안녕", ctx);
		expect(r0.promptBlock).toBe(""); // cold start — nothing to inject yet

		// The durable fact is stated early; the assistant reply does NOT echo the
		// keywords (so retrieval can't succeed by copying the reply).
		await agentMemory.saveTurn(
			"내 이름은 루크이고 고양이 두 마리를 키워",
			"반가워요, 잘 기록했어요.",
			ctx,
		);

		// Bury it under MANY unrelated turns (16 episodes) so the target is well
		// outside any topK:5 recency window. A recall that just returned the most
		// recent episodes would NOT surface the target — only real keyword
		// retrieval can. None of these mention 고양이 / 두 마리.
		const filler: Array<[string, string]> = [
			["오늘 날씨 어때?", "맑고 따뜻해요."],
			["점심 추천해줘", "비빔밥 어떠세요."],
			["회의가 몇 시였지?", "오후 3시예요."],
			["고마워", "천만에요."],
			["주말 계획 있어?", "푹 쉬는 걸 추천해요."],
			["커피 한 잔 마실까", "좋은 생각이에요."],
			["내일 일정 알려줘", "오전에 약속이 하나 있어요."],
			["음악 틀어줘", "잔잔한 곡으로 골라볼게요."],
		];
		for (const [u, a] of filler) await agentMemory.saveTurn(u, a, ctx);

		// New turn — pulls the buried fact by keyword.
		const recalled = await agentMemory.recallForTurn("내 고양이 몇 마리였지?", ctx);

		expect(recalled.episodeCount + recalled.factCount).toBeGreaterThan(0);
		expect(recalled.promptBlock).toContain("고양이");
		expect(recalled.promptBlock).toContain("두 마리");
		// And the burial worked: the target is not merely the most-recent turn.
		expect(recalled.promptBlock).not.toContain("잔잔한 곡");
	});

	it("returns an empty block on a cold store (nothing to inject)", async () => {
		const recalled = await agentMemory.recallForTurn("아무거나", ctx);
		expect(recalled.promptBlock).toBe("");
		expect(recalled.episodeCount).toBe(0);
		expect(recalled.factCount).toBe(0);
	});

	it("persists across a re-open (durable long-term memory)", async () => {
		const tmpPath = newStorePath("persist");
		// Both instances share the one store path and are tracked, so afterEach
		// closes them even if an assertion throws.
		const m1 = new MemorySystem({
			adapter: new LocalAdapter({ storePath: tmpPath }),
		});
		instances.push(m1);
		await new AgentMemoryAdapter(m1).saveTurn(
			"내 생일은 5월 9일이야",
			"네, 잘 기록했어요.", // does not echo "5월 9일"
			ctx,
		);
		await m1.close(); // flush to disk now (afterEach close is idempotent)

		// Fresh MemorySystem over the same store — models a close/re-open cycle
		// (durability across a restart), not a separate OS process.
		const m2 = new MemorySystem({
			adapter: new LocalAdapter({ storePath: tmpPath }),
		});
		instances.push(m2);
		const recalled = await new AgentMemoryAdapter(m2).recallForTurn(
			"내 생일 언제였지?",
			ctx,
		);
		expect(recalled.promptBlock).toContain("5월 9일");
	});
});
