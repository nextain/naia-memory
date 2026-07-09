// First-class REACTION signal — a caller-supplied `emotion` / `importance` on
// encode input overrides the keyword heuristic and propagates through
// episode.importance (→ fact.maxEmotion → flashbulb recall boost). This suite
// asserts the encode-time override + utility recompute; the recall-ranking
// effect is exercised end-to-end by the naia-agent human-like bench (5b).

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "../adapters/local.js";
import { MemorySystem } from "../index.js";

let rootDir: string;
beforeEach(async () => {
	rootDir = await mkdtemp(join(tmpdir(), "reaction-signal-"));
});
afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true }).catch(() => {});
});

function makeSystem(): MemorySystem {
	return new MemorySystem({ adapter: new LocalAdapter(join(rootDir, `s-${randomUUID()}.json`)), consolidationIntervalMs: 0 });
}

describe("first-class reaction signal (encode emotion/importance override)", () => {
	it("emotion override sets episode.importance.emotion + recomputes utility", async () => {
		const sys = makeSystem();
		const ep = await sys.encode({ content: "나는 그림 그리는 걸 좋아해.", role: "user", emotion: 0.95 }, {});
		expect(ep.importance.emotion).toBeCloseTo(0.95);
		// utility = importance*0.5 + surprise*0.2 + arousal*0.3, arousal=|0.95-0.5|*2=0.9
		const expected = Math.min(1, ep.importance.importance * 0.5 + ep.importance.surprise * 0.2 + 0.9 * 0.3);
		expect(ep.importance.utility).toBeCloseTo(expected);
		expect(ep.strength).toBeCloseTo(ep.importance.utility);
	});

	it("importance override sets episode.importance.importance", async () => {
		const sys = makeSystem();
		const ep = await sys.encode({ content: "사용자 거주지: 서울", role: "user", importance: 0.85 }, {});
		expect(ep.importance.importance).toBeCloseTo(0.85);
	});

	it("clamps out-of-range values to [0,1]", async () => {
		const sys = makeSystem();
		const ep = await sys.encode({ content: "테스트", role: "user", emotion: 1.7, importance: -0.3 }, {});
		expect(ep.importance.emotion).toBe(1);
		expect(ep.importance.importance).toBe(0);
	});

	it("absent reaction signal leaves the keyword heuristic untouched (backward-compatible)", async () => {
		const sys = makeSystem();
		const a = await sys.encode({ content: "나는 등산을 좋아해.", role: "user" }, {});
		const b = await sys.encode({ content: "나는 등산을 좋아해.", role: "user" }, {});
		// deterministic heuristic → same score for same content, and NOT forced to 0.95.
		expect(a.importance.emotion).toBeCloseTo(b.importance.emotion);
		expect(a.importance.emotion).not.toBe(0.95);
	});
});
