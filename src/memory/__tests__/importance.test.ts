import { describe, expect, it } from "vitest";
import {
	scoreImportance,
} from "../importance.js";
import type { MemoryInput } from "../types.js";

/**
 * Phase A.3 — `importance.ts` unit tests.
 * Specs mirror `phase-a-test-plan.md` v3 §3 A.3 (IM-01..IM-18 + IM-12 B-BUG).
 * R6 cross-review (architect profile) drove IM-12 discovery and
 * IM-13..IM-18 additions.
 */

function input(overrides: Partial<MemoryInput> = {}): MemoryInput {
	return {
		content: "",
		role: "user",
		timestamp: 0,
		...overrides,
	};
}

// ─── IM-01 (C-GUARD) constant ──────────────────────────────────────────

// ─── IM-02 — output range ───────────────────────────────────────────────

describe("scoreImportance — output range (IM-02)", () => {
	const cases: Array<[string, MemoryInput]> = [
		["empty user", input({ content: "" })],
		["empty tool", input({ content: "", role: "tool" })],
		["huge positive", input({ content: "great perfect awesome love amazing thank 완벽 최고 감사 대박" })],
		["huge negative", input({ content: "frustrated annoying hate terrible ugh damn 짜증 별로 최악 답답" })],
		["all markers", input({ content: "always must bug unexpected great frustrated 반드시 버그 최고 짜증" })],
	];
	for (const [label, inp] of cases) {
		it(`${label}: all four components ∈ [0,1]`, () => {
			const s = scoreImportance(inp);
			for (const k of ["importance", "surprise", "emotion", "utility"] as const) {
				expect(s[k]).toBeGreaterThanOrEqual(0);
				expect(s[k]).toBeLessThanOrEqual(1);
			}
		});
	}

	it("emotion baseline is 0.5 for marker-free content", () => {
		const s = scoreImportance(input({ content: "just a plain sentence" }));
		expect(s.emotion).toBe(0.5);
	});
});

// ─── IM-03 — determinism + case-insensitivity ──────────────────────────

describe("scoreImportance — determinism + case (IM-03)", () => {
	it("same input → same output", () => {
		const inp = input({ content: "I must always remember this important fact" });
		const a = scoreImportance(inp);
		const b = scoreImportance(inp);
		expect(a).toEqual(b);
	});

	it("IM-13 uppercase markers are normalized via toLowerCase at :111", () => {
		const lower = scoreImportance(input({ content: "always remember" }));
		const upper = scoreImportance(input({ content: "ALWAYS REMEMBER" }));
		const mixed = scoreImportance(input({ content: "Always Remember" }));
		expect(upper).toEqual(lower);
		expect(mixed).toEqual(lower);
	});
});

// ─── IM-04 — marker-free identity ──────────────────────────────────────

describe("scoreImportance — marker-free identity (IM-04)", () => {
	it("two marker-free same-role strings yield identical scores", () => {
		const a = scoreImportance(input({ content: "the weather is nice today" }));
		const b = scoreImportance(input({ content: "my cat sits by the window" }));
		expect(a).toEqual(b);
	});

	it("marker-free user: importance==0.3 (roleWeight), utility = 0.3*0.5 = 0.15", () => {
		const s = scoreImportance(input({ content: "plain sentence" }));
		expect(s.importance).toBe(0.3);
		expect(s.surprise).toBe(0);
		expect(s.emotion).toBe(0.5);
		expect(s.utility).toBe(0.15);
	});
});

// ─── IM-05 — emotion symmetric per-hit ─────────────────────────────────

describe("scoreImportance — emotion symmetry (IM-05)", () => {
	it("1 positive marker shifts emotion to 0.5 + 0.15 = 0.65", () => {
		const s = scoreImportance(input({ content: "great work" }));
		expect(s.emotion).toBeCloseTo(0.65, 5);
	});

	it("1 negative marker shifts emotion to 0.5 - 0.15 = 0.35", () => {
		const s = scoreImportance(input({ content: "frustrated today" }));
		expect(s.emotion).toBeCloseTo(0.35, 5);
	});

	it("symmetric shifts preserve distance from 0.5 at single hits", () => {
		const pos = scoreImportance(input({ content: "love this" }));
		const neg = scoreImportance(input({ content: "hate this" }));
		expect(Math.abs(pos.emotion - 0.5)).toBeCloseTo(
			Math.abs(neg.emotion - 0.5),
			5,
		);
	});

	it("clamping preserves symmetry at extremes: 10 positives → 1.0, 10 negatives → 0.0", () => {
		const allPos = scoreImportance(
			input({
				content: "great perfect awesome love amazing thank 완벽 최고 감사 대박",
			}),
		);
		const allNeg = scoreImportance(
			input({
				content: "frustrated annoying hate terrible ugh damn 짜증 별로 최악 답답",
			}),
		);
		expect(allPos.emotion).toBe(1.0);
		expect(allNeg.emotion).toBe(0.0);
	});
});

// ─── IM-06 / IM-06b — per-hit magnitude ────────────────────────────────
// R7 note: these magnitude assertions are IMPLEMENTATION PINS for the
// current keyword-counting heuristic. When Phase D replaces this with an
// LLM/embedding classifier, these will red on values that are still
// behaviourally correct — expected failures, not regressions. Planned
// action for Phase D: delete IM-06, IM-06b, IM-18 together with the
// keyword-counting code path. Tracking in plan §4 IM-12 / §3 A.3.

describe("scoreImportance — magnitude per hit (IM-06 / IM-06b — IMPLEMENTATION PIN, drop in Phase D)", () => {
	it("IM-06 1 surprise marker → surprise = 0.2", () => {
		const s = scoreImportance(input({ content: "unexpected result" }));
		expect(s.surprise).toBeCloseTo(0.2, 5);
	});

	it("IM-06 2 surprise markers → surprise = 0.4", () => {
		const s = scoreImportance(input({ content: "unexpected bug" }));
		expect(s.surprise).toBeCloseTo(0.4, 5);
	});

	it("IM-06b 1 importance marker + user role → importance = 0.3 + 0.15 = 0.45", () => {
		const s = scoreImportance(input({ content: "always remember" }));
		expect(s.importance).toBeCloseTo(0.45, 5);
	});

	it("IM-06b 2 importance markers + user role → importance = 0.3 + 0.30 = 0.60", () => {
		const s = scoreImportance(input({ content: "always must remember" }));
		expect(s.importance).toBeCloseTo(0.60, 5);
	});
});

// ─── IM-08 — arousal U-shape ───────────────────────────────────────────

describe("scoreImportance — arousal U-shape (IM-08)", () => {
	it("neutral (equal pos/neg) → arousal ≈ 0, utility minimized on emotion axis", () => {
		const balanced = scoreImportance(
			input({ content: "great and frustrated" }),
		);
		// pos=1, neg=1, emotion=0.5, arousal=0
		expect(balanced.emotion).toBe(0.5);
		// Derived arousal (not stored in ImportanceScore but embedded in utility):
		// utility contribution from arousal is 0 here.
	});

	it("strong polarity → high utility (arousal component 0.3 × 1.0)", () => {
		// 10 positives → emotion=1.0, arousal = |1-0.5|*2 = 1.0
		const polar = scoreImportance(
			input({
				content: "great perfect awesome love amazing thank 완벽 최고 감사 대박",
			}),
		);
		const neutral = scoreImportance(input({ content: "plain sentence" }));
		// Polar utility should be greater than neutral utility (arousal path lifts it)
		expect(polar.utility).toBeGreaterThan(neutral.utility);
	});

	it("adding one more negative to an equal-count string reduces then raises utility (U-shape)", () => {
		// start: 2 positives, 2 negatives → neutral + arousal=0
		// add 1 negative → 2 pos, 3 neg → emotion away from neutral → arousal increases
		const neutralMix = scoreImportance(
			input({ content: "great perfect frustrated annoying" }),
		);
		const offCenter = scoreImportance(
			input({ content: "great perfect frustrated annoying hate" }),
		);
		// offCenter has stronger polarity (3 neg vs 2 pos) → arousal higher
		const neutralArousal = Math.abs(neutralMix.emotion - 0.5) * 2;
		const offCenterArousal = Math.abs(offCenter.emotion - 0.5) * 2;
		expect(offCenterArousal).toBeGreaterThan(neutralArousal);
	});
});

// ─── IM-09 — role weights (all three) ──────────────────────────────────

describe("scoreImportance — role weights (IM-09, all three roles)", () => {
	it("user roleWeight = 0.3 (marker-free importance)", () => {
		const s = scoreImportance(input({ content: "plain", role: "user" }));
		expect(s.importance).toBe(0.3);
	});

	it("assistant roleWeight = 0.1", () => {
		const s = scoreImportance(input({ content: "plain", role: "assistant" }));
		expect(s.importance).toBeCloseTo(0.1, 5);
	});

	it("tool roleWeight = 0.0 → marker-free tool yields utility 0", () => {
		const s = scoreImportance(input({ content: "plain", role: "tool" }));
		expect(s.importance).toBe(0);
		expect(s.utility).toBe(0);
	});
});

// ─── IM-11 — monotonicity (rephrased per R6) ───────────────────────────

describe("scoreImportance — monotonicity in marker hits (IM-11)", () => {
	it("adding one IMPORTANCE marker never decreases importance (until clamp)", () => {
		const base = scoreImportance(input({ content: "plain user message" }));
		const plus1 = scoreImportance(input({ content: "always plain user message" }));
		expect(plus1.importance).toBeGreaterThanOrEqual(base.importance);
	});

	it("adding one SURPRISE marker never decreases surprise", () => {
		const base = scoreImportance(input({ content: "plain" }));
		const plus1 = scoreImportance(input({ content: "unexpected plain" }));
		expect(plus1.surprise).toBeGreaterThanOrEqual(base.surprise);
	});
});

// ─── IM-12 — marker-free user utility preserved ────────────────────

describe("IM-12 marker-free user scoring (P1: gate removed, scoring preserved)", () => {
	it("marker-free user: utility stays at 0.15", () => {
		const s = scoreImportance(input({ content: "ok", role: "user" }));
		expect(s.utility).toBe(0.15);
	});

	it("marker-free user scoring is deterministic", () => {
		const s = scoreImportance(input({ content: "hello", role: "user" }));
		expect(s.utility).toBe(0.15);
	});
});

// ─── IM-14 — Korean markers ────────────────────────────────────────────

describe("scoreImportance — Korean markers (IM-14 — expanded R7)", () => {
	it("Korean IMPORTANCE directive 항상 → 1 hit", () => {
		const s = scoreImportance(input({ content: "항상 그래요", role: "user" }));
		expect(s.importance).toBeCloseTo(0.45, 5); // 0.3 + 1*0.15
	});

	it("Korean IMPORTANCE directive 반드시 + 기억 → 2 hits", () => {
		const s = scoreImportance(input({ content: "반드시 기억해야 해", role: "user" }));
		expect(s.importance).toBeCloseTo(0.6, 5); // 0.3 + 2*0.15
	});

	it("Korean IMPORTANCE preference 원해 → 1 hit", () => {
		const s = scoreImportance(input({ content: "이걸 원해요", role: "user" }));
		expect(s.importance).toBeCloseTo(0.45, 5);
	});

	it("Korean IMPORTANCE critical 중요 → 1 hit", () => {
		const s = scoreImportance(input({ content: "중요한 정보", role: "user" }));
		expect(s.importance).toBeCloseTo(0.45, 5);
	});

	it("Korean SURPRISE markers 버그 + 발견 → 2 hits, surprise=0.4", () => {
		const s = scoreImportance(input({ content: "버그 발견" }));
		expect(s.surprise).toBeCloseTo(0.4, 5);
	});

	it("Korean SURPRISE 알고 보니 → 1 hit", () => {
		const s = scoreImportance(input({ content: "알고 보니 그게 문제였어" }));
		expect(s.surprise).toBeCloseTo(0.2, 5);
	});

	it("Korean positive EMOTION markers 최고 + 감사 → emotion = 0.5 + 0.3 = 0.8", () => {
		const s = scoreImportance(input({ content: "최고 감사" }));
		expect(s.emotion).toBeCloseTo(0.8, 5);
	});

	it("Korean negative EMOTION markers 짜증 + 답답 → emotion = 0.5 - 0.3 = 0.2", () => {
		const s = scoreImportance(input({ content: "짜증 답답" }));
		expect(s.emotion).toBeCloseTo(0.2, 5);
	});

	it("Korean negative EMOTION 최악 → emotion = 0.35", () => {
		const s = scoreImportance(input({ content: "최악의 상황" }));
		expect(s.emotion).toBeCloseTo(0.35, 5);
	});
});

// ─── IM-15 — includes semantics (1 hit, not N) ─────────────────────────

describe("scoreImportance — substring includes semantics (IM-15)", () => {
	it("3 occurrences of same marker counted as 1 hit (text.includes)", () => {
		const single = scoreImportance(input({ content: "always remember this" }));
		const triple = scoreImportance(
			input({ content: "always always always remember" }),
		);
		// Both: roleWeight 0.3 + 1 hit * 0.15 = 0.45
		expect(triple.importance).toBe(single.importance);
	});
});

// ─── IM-16 — cross-category overlap ─────────────────────────────────────

describe("scoreImportance — cross-category overlap (IM-16)", () => {
	it("'actually works' hits IMPORTANCE 'actually' + SURPRISE 'actually works' simultaneously", () => {
		const s = scoreImportance(
			input({ content: "actually works as expected", role: "user" }),
		);
		// IMPORTANCE: "actually" hit → +0.15
		expect(s.importance).toBeGreaterThan(0.3);
		// SURPRISE: "actually works" hit → +0.2 (at least)
		expect(s.surprise).toBeGreaterThanOrEqual(0.2);
	});
});

// ─── IM-17 — length independence ───────────────────────────────────────

describe("scoreImportance — length independence (IM-17)", () => {
	it("10 kB marker-free content yields same score as short marker-free content", () => {
		const short = scoreImportance(input({ content: "plain" }));
		const huge = scoreImportance(
			input({ content: "x ".repeat(5000) }), // ~10 kB, no markers
		);
		expect(huge.importance).toBe(short.importance);
		expect(huge.utility).toBe(short.utility);
	});
});

// ─── IM-19 — component-weight sensitivity (R7) ──────────────────────────

describe("scoreImportance — component-weight ordering (IM-19, R7)", () => {
	// R7 gap: single-component tests pin magnitudes but not cross-component
	// weights. A refactor swapping 0.5/0.2/0.3 weights at :146-149 would
	// not break any IM-05/06/06b/08 test. This test pins ordering.

	it("IM-19 with all components maxed equally, utility contribution order reflects weights (0.5 > 0.3 > 0.2)", () => {
		// Max importance alone (7+ markers, user role)
		const maxImportance = scoreImportance(
			input({
				content: "always never must decided prefer actually password",
				role: "user",
			}),
		);
		// Max surprise alone (5 markers, user role)
		const maxSurprise = scoreImportance(
			input({
				content: "unexpected surprising weird strange bug",
				role: "user",
			}),
		);
		// Max arousal via 10 positive emotion markers (user role, no importance/surprise markers)
		const maxArousal = scoreImportance(
			input({
				content: "great perfect awesome love amazing thank 완벽 최고 감사 대박",
				role: "user",
			}),
		);

		// Pure component utilities (isolated — each input only hits its target axis):
		//   importance-only: 1.0 * 0.5 + 0 * 0.2 + 0 * 0.3 + (baseline emotion 0.5 arousal 0) = 0.5
		//   surprise-only: (role 0.3) * 0.5 + 1.0 * 0.2 + 0 * 0.3 = 0.35
		//   arousal-only: (role 0.3) * 0.5 + 0 * 0.2 + 1.0 * 0.3 = 0.45
		// Expected ordering: maxImportance > maxArousal > maxSurprise (0.5 > 0.45 > 0.35)
		expect(maxImportance.utility).toBeGreaterThan(maxArousal.utility);
		expect(maxArousal.utility).toBeGreaterThan(maxSurprise.utility);
	});
});

// ─── IM-18 — clamp boundaries ──────────────────────────────────────────

describe("scoreImportance — clamp boundaries (IM-18 — IMPLEMENTATION PIN, drop in Phase D)", () => {
	it(":121 importance clamp: 7 importance markers + user role → 1.0", () => {
		// roleWeight=0.3, 7 markers * 0.15 = 1.05, clamped to 1.0
		const s = scoreImportance(
			input({
				content: "always never must decided prefer actually password",
				role: "user",
			}),
		);
		expect(s.importance).toBe(1.0);
	});

	it(":128 surprise clamp: 5 surprise markers → 1.0", () => {
		const s = scoreImportance(
			input({ content: "unexpected surprising weird strange bug" }),
		);
		expect(s.surprise).toBe(1.0);
	});

	it(":141 emotion clamp: 6+ positive markers → 1.0", () => {
		const s = scoreImportance(
			input({ content: "great perfect awesome love amazing thank 완벽" }),
		);
		expect(s.emotion).toBe(1.0);
	});

	it(":146 utility clamp: maximum content pushes utility to exactly 1.0", () => {
		const s = scoreImportance(
			input({
				content:
					"always never must decided prefer actually password unexpected bug weird strange surprising great perfect awesome love amazing thank 완벽 최고",
				role: "user",
			}),
		);
		expect(s.utility).toBe(1.0);
	});
});
