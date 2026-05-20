// Slice 3-XR-Compact (#47) P3 — anchored iterative summarization +
// structured 5-section markdown recap.
//
// New tests for the v3 enhancements:
// - priorRecap merged verbatim as `## Prior recap (anchored)` section.
// - `## Goal` from first user message.
// - `## Instructions` from system-role messages.
// - `## Tool calls made` from tool-role messages, deduped.
// - `## Discoveries` from fact-shaped assistant lines.
// - `## Relevant files / URLs` strict-preserved.

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "../adapters/local.js";
import { MemorySystem } from "../index.js";
import type { MemorySystemOptions } from "../index.js";

let rootDir: string;

beforeEach(async () => {
	rootDir = await mkdtemp(join(tmpdir(), "compact-anchored-"));
});

afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true }).catch(() => {});
});

function makeSystem(opts: Partial<MemorySystemOptions> = {}): MemorySystem {
	const path = join(rootDir, `store-${randomUUID()}.json`);
	return new MemorySystem({
		adapter: new LocalAdapter(path),
		consolidationIntervalMs: 0,
		...opts,
	});
}

describe("compact() v3 — anchored iterative summarization (#47 P3)", () => {
	it("ANCH-01 prepends `## Prior recap (anchored)` when priorRecap supplied", async () => {
		const sys = makeSystem();
		const r = await sys.compact({
			messages: [
				{ role: "user", content: "What was the deployment plan?" },
				{ role: "assistant", content: "We agreed to use rolling deploys with health checks." },
			],
			keepTail: 2,
			targetTokens: 500,
			priorRecap: {
				role: "assistant",
				content:
					"[Recap of turns 1-20] User asked about migration strategy. Decided on Postgres → MySQL.",
			},
		});
		expect(r.summary.content).toContain("## Prior recap (anchored)");
		expect(r.summary.content).toContain("Postgres → MySQL");
		// Anchored section must come BEFORE the new Goal — the prior recap is
		// the seed that the next compaction merges into.
		const priorIdx = r.summary.content.indexOf("## Prior recap (anchored)");
		const goalIdx = r.summary.content.indexOf("## Goal");
		expect(priorIdx).toBeGreaterThanOrEqual(0);
		expect(goalIdx).toBeGreaterThan(priorIdx);
		await sys.close();
	});

	it("ANCH-02 omits anchored section when priorRecap is absent (first compaction)", async () => {
		const sys = makeSystem();
		const r = await sys.compact({
			messages: [{ role: "user", content: "first" }, { role: "assistant", content: "ok" }],
			keepTail: 2,
			targetTokens: 500,
		});
		expect(r.summary.content).not.toContain("## Prior recap");
		await sys.close();
	});

	it("ANCH-03 omits anchored section when priorRecap.content is empty", async () => {
		const sys = makeSystem();
		const r = await sys.compact({
			messages: [{ role: "user", content: "hi" }],
			keepTail: 1,
			targetTokens: 500,
			priorRecap: { role: "assistant", content: "   " },
		});
		expect(r.summary.content).not.toContain("## Prior recap");
		await sys.close();
	});

	it("ANCH-04 `## Goal` carries first user message (truncated)", async () => {
		const sys = makeSystem();
		const r = await sys.compact({
			messages: [
				{
					role: "user",
					content: "Help me design a real-time avatar voice pipeline using LiveKit and VoxCPM2",
				},
				{ role: "assistant", content: "Sure — here is the cascade ..." },
				{ role: "user", content: "follow-up question that should not be the Goal" },
			],
			keepTail: 1,
			targetTokens: 500,
		});
		expect(r.summary.content).toContain("## Goal");
		expect(r.summary.content).toContain("avatar voice pipeline");
		// The Goal section itself must carry the FIRST user message, not the
		// follow-up. (Legacy "Most recent before recap" line is separate.)
		const goalSectionStart = r.summary.content.indexOf("## Goal");
		const nextSectionStart = r.summary.content.indexOf("\n## ", goalSectionStart + 1);
		const goalSection = nextSectionStart >= 0
			? r.summary.content.slice(goalSectionStart, nextSectionStart)
			: r.summary.content.slice(goalSectionStart);
		expect(goalSection).toContain("avatar voice pipeline");
		expect(goalSection).not.toContain("follow-up question");
		await sys.close();
	});

	it("ANCH-05 `## Tool calls made` lists distinct tool messages, dedupes, caps at 10", async () => {
		const sys = makeSystem();
		const toolMsgs = Array.from({ length: 14 }, (_, i) => ({
			role: "tool" as const,
			content: `read_file(src/file-${i}.ts) -> ok`,
		}));
		// add a dup
		toolMsgs.push({ role: "tool", content: "read_file(src/file-0.ts) -> ok" });
		const r = await sys.compact({
			messages: [
				{ role: "user", content: "audit the codebase" },
				...toolMsgs,
				{ role: "assistant", content: "audit complete" },
			],
			keepTail: 2,
			targetTokens: 500,
		});
		expect(r.summary.content).toContain("## Tool calls made");
		expect(r.summary.content).toContain("read_file(src/file-0.ts)");
		// 14 distinct + 1 dup = 14 unique; cap=10 → "more tool messages"
		expect(r.summary.content).toMatch(/more tool messages/);
		await sys.close();
	});

	it("ANCH-06 `## Relevant files / URLs` extracts paths and URLs", async () => {
		const sys = makeSystem();
		const r = await sys.compact({
			messages: [
				{
					role: "assistant",
					content:
						"Edited packages/core/src/agent.ts and packages/types/src/memory.ts; reference https://example.com/docs",
				},
			],
			keepTail: 0,
			targetTokens: 500,
		});
		expect(r.summary.content).toContain("## Relevant files / URLs");
		expect(r.summary.content).toContain("packages/core/src/agent.ts");
		expect(r.summary.content).toContain("packages/types/src/memory.ts");
		expect(r.summary.content).toContain("https://example.com/docs");
		await sys.close();
	});

	it("ANCH-07 strategy hint is accepted (no error) and structural recap unchanged", async () => {
		const sys = makeSystem();
		for (const s of ["reactive", "realtime", "anthropic-native", "off"] as const) {
			const r = await sys.compact({
				messages: [{ role: "user", content: "test" }, { role: "assistant", content: "ok" }],
				keepTail: 0,
				targetTokens: 500,
				strategy: s,
			});
			expect(r.summary.content).toContain("## Goal");
		}
		await sys.close();
	});

	it("ANCH-08 legacy assertion still holds — `earlier messages compacted` preserved", async () => {
		const sys = makeSystem();
		const r = await sys.compact({
			messages: [
				{ role: "user", content: "a" },
				{ role: "assistant", content: "b" },
				{ role: "user", content: "c" },
			],
			keepTail: 1,
			targetTokens: 500,
		});
		// Backward-compat: the deterministic header line MUST survive so
		// existing host tests (e.g. naia-os agent) continue to pass.
		expect(r.summary.content).toContain("earlier messages compacted");
		await sys.close();
	});

	it("ANCH-09 large priorRecap merges into a second compaction round (iterative anchoring)", async () => {
		const sys = makeSystem();
		// Round 1: build the first recap.
		const r1 = await sys.compact({
			messages: [
				{
					role: "user",
					content:
						"Round 1: explore the auth refactor in packages/core/src/agent.ts and propose a plan",
				},
				{
					role: "assistant",
					content:
						"Proposed splitting the auth into a separate middleware module, validated by integration test pass",
				},
			],
			keepTail: 0,
			targetTokens: 500,
		});
		// Round 2: feed r1.summary back as priorRecap.
		const r2 = await sys.compact({
			messages: [
				{ role: "user", content: "Round 2: now wire up the OAuth provider" },
				{
					role: "assistant",
					content: "Added Google OAuth in packages/auth/src/google.ts with PKCE flow",
				},
			],
			keepTail: 0,
			targetTokens: 500,
			priorRecap: r1.summary,
		});
		expect(r2.summary.content).toContain("## Prior recap (anchored)");
		// The Round-1 recap content (auth refactor) must be merged in.
		expect(r2.summary.content).toContain("auth");
		// Round 2's own Goal is OAuth.
		expect(r2.summary.content).toContain("OAuth");
		await sys.close();
	});
});
