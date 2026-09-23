import { describe, expect, it } from "vitest";
import {
	BASE_DECAY,
	calculatePruneScore,
	calculateStrength,
	compareByRelevanceThenStrength,
	IMPORTANCE_DAMPING,
	MAX_RECALL_MULTIPLIER,
	PRUNE_THRESHOLD,
	shouldPrune,
} from "../decay.js";

/**
 * Phase A.4 — `decay.ts` unit tests.
 * Specs mirror `phase-a-test-plan.md` v3 §3 A.4 (DC-01..DC-18).
 * R8 cross-review (numerical-correctness profile) added DC-14b/15/16/17/18.
 *
 * MIN_STRENGTH is private to decay.ts; we exercise it via observable
 * clamp behaviour at the calculateStrength boundary.
 */

const MIN_STRENGTH_OBSERVED = 0.01; // observable via :63 clamp
const DAY_MS = 86_400_000;

function atDays(days: number): number {
	return days * DAY_MS;
}

// ─── DC-01 / DC-17 (C-GUARDs) constants ────────────────────────────────

describe("decay constants (DC-01 + DC-17 C-GUARDs)", () => {
	it("DC-01 BASE_DECAY === 0.08", () => {
		expect(BASE_DECAY).toBe(0.08);
	});

	it("DC-01b MAX_RECALL_MULTIPLIER === 2.0 (#51, measured)", () => {
		expect(MAX_RECALL_MULTIPLIER).toBe(2.0);
	});

	it("DC-01 IMPORTANCE_DAMPING === 0.85", () => {
		expect(IMPORTANCE_DAMPING).toBe(0.85);
	});

	it("DC-01 PRUNE_THRESHOLD === 0.05", () => {
		expect(PRUNE_THRESHOLD).toBe(0.05);
	});

	it("DC-17 MIN_STRENGTH (observed 0.01) < PRUNE_THRESHOLD (0.05) — floor does not save clamped memories from pruning", () => {
		expect(MIN_STRENGTH_OBSERVED).toBeLessThan(PRUNE_THRESHOLD);
	});
});

// ─── DC-02 — age 0, recall 0 → strength = importance ───────────────────

describe("calculateStrength — age 0 baseline (DC-02)", () => {
	it("importance=0.5, recall=0, now==lastAccessed → strength = 0.5", () => {
		const s = calculateStrength(0.5, 0, 0, 100, 100);
		expect(s).toBeCloseTo(0.5, 10);
	});

	it("importance=1.0, recall=0, age=0 → strength = 1.0", () => {
		const s = calculateStrength(1.0, 0, 0, 100, 100);
		expect(s).toBeCloseTo(1.0, 10);
	});

	it("importance=0, recall=0, age=0 → clamped to MIN_STRENGTH", () => {
		const s = calculateStrength(0, 0, 0, 100, 100);
		expect(s).toBe(MIN_STRENGTH_OBSERVED);
	});
});

// ─── DC-03 — monotonic non-increasing in age (recall fixed) ────────────

describe("calculateStrength — age monotonicity (DC-03)", () => {
	it("with recall=0, strength non-increases as days pass", () => {
		const imp = 0.5;
		const s0 = calculateStrength(imp, 0, 0, 0, atDays(0));
		const s10 = calculateStrength(imp, 0, 0, 0, atDays(10));
		const s30 = calculateStrength(imp, 0, 0, 0, atDays(30));
		const s90 = calculateStrength(imp, 0, 0, 0, atDays(90));
		expect(s0).toBeGreaterThanOrEqual(s10);
		expect(s10).toBeGreaterThanOrEqual(s30);
		expect(s30).toBeGreaterThanOrEqual(s90);
	});
});

// ─── DC-04 — monotonic non-decreasing in importance ────────────────────

describe("calculateStrength — importance monotonicity (DC-04)", () => {
	it("at fixed age/recall, higher importance yields equal-or-greater strength", () => {
		const steps = [0.0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.0];
		const results = steps.map((imp) =>
			calculateStrength(imp, 0, 0, 0, atDays(10)),
		);
		for (let i = 1; i < results.length; i++) {
			expect(results[i]).toBeGreaterThanOrEqual(results[i - 1] as number);
		}
	});
});

// ─── DC-05 — monotonic non-decreasing in recallCount ───────────────────

describe("calculateStrength — recall monotonicity (DC-05)", () => {
	it("at fixed age/importance, higher recallCount yields equal-or-greater strength", () => {
		const steps = [0, 1, 3, 5, 10, 20];
		const results = steps.map((r) =>
			calculateStrength(0.5, 0, r, 0, atDays(30)),
		);
		for (let i = 1; i < results.length; i++) {
			expect(results[i]).toBeGreaterThanOrEqual(results[i - 1] as number);
		}
	});
});

// ─── DC-06 — calibrated mid-importance 40-day (R8 tightened) ───────────

describe("calculateStrength — Ebbinghaus calibration at 40 days (DC-06, tightened)", () => {
	it("importance=0.5, days=40, recall=0 → strength ≈ 0.0794 (formula value)", () => {
		const s = calculateStrength(0.5, 0, 0, 0, atDays(40));
		// R8 Q3: loose < 0.2 hides 37% BASE_DECAY drift. Use close bracket.
		expect(s).toBeCloseTo(0.0794, 2);
	});
});

// ─── DC-07 — calculatePruneScore monotonicity ─────────────────────────

describe("calculatePruneScore — monotonicity (DC-07)", () => {
	it("non-decreasing in tokenSize", () => {
		const sizes = [10, 100, 500, 1000, 5000];
		const results = sizes.map((s) => calculatePruneScore(s, 10));
		for (let i = 1; i < results.length; i++) {
			expect(results[i]).toBeGreaterThanOrEqual(results[i - 1] as number);
		}
	});

	it("non-decreasing in hoursSince (with strict increase after hour 1)", () => {
		const hours = [0, 0.5, 1, 1.5, 5, 24, 168];
		const results = hours.map((h) => calculatePruneScore(100, h));
		for (let i = 1; i < results.length; i++) {
			expect(results[i]).toBeGreaterThanOrEqual(results[i - 1] as number);
		}
	});
});

// ─── DC-08 / DC-09 / DC-10 — shouldPrune boundary ─────────────────────

describe("shouldPrune — threshold boundary (DC-08/09/10)", () => {
	it("DC-08 strictly less than PRUNE_THRESHOLD → true", () => {
		expect(shouldPrune(0.04)).toBe(true);
		expect(shouldPrune(0.049)).toBe(true);
	});

	it("DC-09 exactly at threshold → false (exclusive)", () => {
		expect(shouldPrune(PRUNE_THRESHOLD)).toBe(false);
	});

	it("DC-09 just above threshold → false", () => {
		expect(shouldPrune(0.051)).toBe(false);
	});

	it("DC-10 clamped min (0.01) → pruned (0.01 < 0.05)", () => {
		const clamped = calculateStrength(0, 0, 0, 0, atDays(365));
		expect(clamped).toBe(MIN_STRENGTH_OBSERVED);
		expect(shouldPrune(clamped)).toBe(true);
	});
});

// ─── DC-11 / DC-12 / DC-13 ─────────────────────────────────────────────

describe("calculateStrength — clamps and special regimes (DC-11/12/13)", () => {
	it("DC-11 never returns less than MIN_STRENGTH for finite inputs", () => {
		// Explore a range of adverse inputs
		const cases: Array<[number, number, number]> = [
			[0, 0, 0],
			[0.01, 0, 10_000_000],
			[0.1, 0, 365],
			[0, 100, 365],
		];
		for (const [imp, recall, days] of cases) {
			const s = calculateStrength(imp, 0, recall, 0, atDays(days));
			expect(s).toBeGreaterThanOrEqual(MIN_STRENGTH_OBSERVED);
		}
	});

	it("DC-12 now < lastAccessed clamps days to 0 (no negative decay)", () => {
		// now earlier than lastAccessed — days clamped to 0, decayFactor = 1
		const s = calculateStrength(0.5, 1_000_000, 0, 1_000_000, 0);
		// At age=0, recall=0 → strength = importance = 0.5
		expect(s).toBeCloseTo(0.5, 10);
	});

	it("DC-13 strength is bounded by importance x MAX_RECALL_MULTIPLIER (#51)", () => {
		// Before #51 recallCount 10 gave 3.0 and there was no upper bound.
		expect(calculateStrength(1.0, 0, 10, 0, 0)).toBeCloseTo(MAX_RECALL_MULTIPLIER, 10);
		expect(calculateStrength(1.0, 0, 10_000, 0, 0)).toBeCloseTo(MAX_RECALL_MULTIPLIER, 10);
	});

	it("DC-13b the boost is unchanged below the cap (#51)", () => {
		expect(calculateStrength(1.0, 0, 0, 0, 0)).toBeCloseTo(1.0, 10);
		expect(calculateStrength(1.0, 0, 1, 0, 0)).toBeCloseTo(1.2, 10);
		expect(calculateStrength(1.0, 0, 3, 0, 0)).toBeCloseTo(1.6, 10);
		expect(calculateStrength(1.0, 0, 5, 0, 0)).toBeCloseTo(2.0, 10);
		expect(calculateStrength(1.0, 0, 6, 0, 0)).toBeCloseTo(2.0, 10);
	});
});

// ─── DC-14 / DC-14b — calculatePruneScore ─────────────────────────────

describe("calculatePruneScore — boundary (DC-14 / DC-14b)", () => {
	it("DC-14 hoursSince=0 → ageWeight=1 → score = tokenSize", () => {
		expect(calculatePruneScore(100, 0)).toBe(100);
	});

	it("DC-14b flat region: hoursSince ∈ {0, 0.5, 1.0} all yield score = tokenSize", () => {
		expect(calculatePruneScore(100, 0)).toBe(100);
		expect(calculatePruneScore(100, 0.5)).toBe(100);
		expect(calculatePruneScore(100, 1.0)).toBe(100);
	});

	it("DC-14b strict increase after hour 1: score(1.5) > score(1.0)", () => {
		const s10 = calculatePruneScore(100, 1.0);
		const s15 = calculatePruneScore(100, 1.5);
		expect(s15).toBeGreaterThan(s10);
	});

	it("DC-14b log base: score(e) ≈ 2 × tokenSize (pins Math.log is natural log)", () => {
		const s = calculatePruneScore(100, Math.E);
		expect(s).toBeCloseTo(200, 5);
	});

	it("DC-14b negative hoursSince (clock skew) → clamped to hour 1 via Math.max", () => {
		// max(1, -5) = 1, log(1)=0, ageWeight=1 → score = tokenSize
		expect(calculatePruneScore(100, -5)).toBe(100);
	});
});

// ─── DC-15 — non-finite inputs ─────────────────────────────────────────

describe("calculateStrength — non-finite inputs (DC-15, R8 add)", () => {
	// R8 Q1: current source uses Math.max(MIN_STRENGTH, strength) — NaN
	// propagates through Math.max. Pin current behaviour so a future wrapper
	// that catches NaN is a deliberate change with a test update.

	it("DC-15a NaN importance → returns MIN_STRENGTH (D.4 safe fallback)", () => {
		const s = calculateStrength(NaN, 0, 0, 0, atDays(10));
		expect(s).toBe(MIN_STRENGTH_OBSERVED);
	});

	it("DC-15a NaN recallCount → returns MIN_STRENGTH", () => {
		const s = calculateStrength(0.5, 0, NaN, 0, atDays(10));
		expect(s).toBe(MIN_STRENGTH_OBSERVED);
	});

	it("DC-15a NaN now → returns MIN_STRENGTH", () => {
		const s = calculateStrength(0.5, 0, 0, 0, NaN);
		expect(s).toBe(MIN_STRENGTH_OBSERVED);
	});

	it("DC-15 Phase-D contract satisfied: NaN input produces finite safe fallback ≥ MIN_STRENGTH", () => {
		const s = calculateStrength(NaN, 0, 0, 0, atDays(10));
		expect(s).toBeGreaterThanOrEqual(MIN_STRENGTH_OBSERVED);
	});

	it("DC-15b +Infinity days → now=Infinity hits finite-guard, returns MIN_STRENGTH", () => {
		const s = calculateStrength(0.5, 0, 0, 0, Number.POSITIVE_INFINITY);
		// D.4 guard short-circuits before exp(-λ*Inf) path; returns MIN_STRENGTH.
		expect(s).toBe(MIN_STRENGTH_OBSERVED);
	});

	it("DC-15c huge recallCount (MAX_SAFE_INTEGER) is bounded (#51)", () => {
		const s = calculateStrength(0.5, 0, Number.MAX_SAFE_INTEGER, 0, atDays(0));
		expect(Number.isFinite(s)).toBe(true);
		expect(s).toBeCloseTo(0.5 * MAX_RECALL_MULTIPLIER, 10);
	});
});

// ─── DC-16 — half-life calibration (JSDoc fidelity) ────────────────────

describe("calculateStrength — Ebbinghaus half-life calibration (DC-16, R8 add)", () => {
	// JSDoc line 14: "high-importance (0.7+) memories survive 60+ days without recall"

	it("DC-16a high-importance 60-day: strength ∈ [0.08, 0.12] — just survives PRUNE_THRESHOLD", () => {
		const s = calculateStrength(0.7, 0, 0, 0, atDays(60));
		expect(s).toBeGreaterThanOrEqual(0.08);
		expect(s).toBeLessThanOrEqual(0.12);
	});

	it("DC-16b high-importance 90-day: strength < PRUNE_THRESHOLD (starts pruning)", () => {
		const s = calculateStrength(0.7, 0, 0, 0, atDays(90));
		expect(s).toBeLessThan(PRUNE_THRESHOLD);
	});

	it("DC-16c mid-importance 1-day: strength ≈ 0.48 (near full, fresh memory)", () => {
		const s = calculateStrength(0.5, 0, 0, 0, atDays(1));
		// λ = 0.08 * (1 - 0.425) = 0.046; exp(-0.046) ≈ 0.955
		// strength = 0.5 * 0.955 * 1 ≈ 0.4775
		expect(s).toBeCloseTo(0.478, 2);
	});

	it("DC-16d low-importance 7-day: decays rapidly but not below MIN_STRENGTH immediately", () => {
		const s = calculateStrength(0.1, 0, 0, 0, atDays(7));
		// λ = 0.08 * (1 - 0.085) = 0.0732; exp(-0.5124) ≈ 0.599
		// strength = 0.1 * 0.599 * 1 ≈ 0.0599
		expect(s).toBeCloseTo(0.0599, 2);
		expect(s).toBeGreaterThan(MIN_STRENGTH_OBSERVED);
	});
});

// ─── DC-19 — decay-clock refresh (R9 add) ──────────────────────────────

describe("calculateStrength — recall refreshes decay clock (DC-19, R9 add)", () => {
	it("with lastAccessed advanced, strength recovers — equivalent to reduced effective age", () => {
		// s1: not refreshed, age=30 days
		const s1 = calculateStrength(0.5, 0, 0, 0, atDays(30));
		// s2: "refreshed" at day 20, now = day 30 → effective age 10 days
		const s2 = calculateStrength(0.5, 0, 0, atDays(20), atDays(30));
		// Reference: age=10 days
		const sRef = calculateStrength(0.5, 0, 0, 0, atDays(10));
		expect(s2).toBeGreaterThan(s1);
		expect(s2).toBeCloseTo(sRef, 10);
	});
});

// ─── DC-18 — importance=0 degenerate regime ────────────────────────────

describe("calculateStrength — importance=0 regime (DC-18, R8 add)", () => {
	it("importance=0 at any age/recall yields clamped MIN_STRENGTH", () => {
		const cases: Array<[number, number]> = [
			[0, 0],
			[1, atDays(0)],
			[0, atDays(100)],
			[5, atDays(1000)],
		];
		for (const [recall, nowMs] of cases) {
			const s = calculateStrength(0, 0, recall, 0, nowMs);
			expect(s).toBe(MIN_STRENGTH_OBSERVED);
		}
	});
});

describe("compareByRelevanceThenStrength (#51)", () => {
	it("orders by score first, however large the strength gap", () => {
		const rows = [
			{ id: "weak-match-strong-memory", score: 0.5, strength: 2.0 },
			{ id: "strong-match-weak-memory", score: 0.9, strength: 0.01 },
		];
		expect(rows.sort(compareByRelevanceThenStrength).map((r) => r.id)).toEqual([
			"strong-match-weak-memory",
			"weak-match-strong-memory",
		]);
	});

	it("uses strength only to break an exact score tie", () => {
		const rows = [
			{ id: "weaker", score: 0.7, strength: 0.2 },
			{ id: "stronger", score: 0.7, strength: 0.9 },
		];
		expect(rows.sort(compareByRelevanceThenStrength).map((r) => r.id)).toEqual([
			"stronger",
			"weaker",
		]);
	});
});
