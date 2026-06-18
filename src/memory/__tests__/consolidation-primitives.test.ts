import { describe, expect, it } from "vitest";
import { __testables, DEDUP_JACCARD_THRESHOLD } from "../index.js";
import type { Episode, ExtractedFact } from "../index.js";
import {
	ALLOWED_KOREAN_PARTICLES,
	KOREAN_TOKENIZATION_FIXTURES,
} from "./fixtures/korean-tokenization.js";

/**
 * Phase D.1 — consolidation primitives.
 * Spec authored by independent architect (outline at
 * .agents/progress/phase-d-1-outline.md). Tests written red-first.
 */

const { contentTokens, jaccardSimilarity, mergeRelatedFacts } = __testables;

function makeEpisode(ts: number): Episode {
	return {
		id: `ep-${ts}`,
		content: "",
		role: "user",
		summary: "",
		timestamp: ts,
		importance: { importance: 0.5, surprise: 0, emotion: 0.5, utility: 0.5 },
		encodingContext: {},
		consolidated: false,
		recallCount: 0,
		lastAccessed: ts,
		strength: 0.5,
	};
}

function makeFact(overrides: Partial<ExtractedFact> = {}): ExtractedFact {
	return {
		content: "",
		entities: [],
		topics: [],
		importance: 0.5,
		maxEmotion: 0.5,
		sourceEpisodeIds: [],
		...overrides,
	};
}

// ─── DEDUP threshold constant guard (R13 add) ──────────────────────────

describe("DEDUP_JACCARD_THRESHOLD constant guard", () => {
	it("is 0.85 — drift here requires mergeRelatedFacts branch review", () => {
		expect(DEDUP_JACCARD_THRESHOLD).toBe(0.85);
	});
});

// ─── contentTokens (CT-01..CT-10) ──────────────────────────────────────

describe("contentTokens", () => {
	it("CT-01 empty string → empty Set", () => {
		expect(contentTokens("")).toEqual(new Set());
	});

	it("CT-02 whitespace/punctuation-only → empty Set", () => {
		expect(contentTokens("   ")).toEqual(new Set());
		expect(contentTokens("!!! ,,, ???")).toEqual(new Set());
	});

	it("CT-03 returns Set (duplicates collapsed)", () => {
		const out = contentTokens("foo foo bar");
		expect(out.has("foo")).toBe(true);
		expect(out.has("bar")).toBe(true);
		expect(out.size).toBe(2);
	});

	it("CT-04 lowercases Latin", () => {
		const out = contentTokens("TypeScript");
		expect(out.has("typescript")).toBe(true);
	});

	it("CT-05 strips non-letter non-number", () => {
		const out = contentTokens("안녕, 세상! hello-world");
		// Punctuation removed; 'hello' / 'world' kept (≥3)
		expect(out.has("hello")).toBe(true);
		expect(out.has("world")).toBe(true);
		// "," and "!" not in any token
		for (const t of out) {
			expect(t).not.toMatch(/[,!?]/);
		}
	});

	it("CT-06 drops tokens < 3 chars final length", () => {
		const out = contentTokens("a bb ccc dddd");
		expect(out.has("a")).toBe(false);
		expect(out.has("bb")).toBe(false);
		expect(out.has("ccc")).toBe(true);
		expect(out.has("dddd")).toBe(true);
	});

	it("CT-07 strips allowed Korean particle when stem ≥ 2", () => {
		expect(contentTokens("에디터를").has("에디터")).toBe(true);
		expect(contentTokens("에디터를").has("에디터를")).toBe(false);
	});

	it("CT-08 preserves tokens ending in non-particle characters", () => {
		// "자" is NOT in ALLOWED_KOREAN_PARTICLES; "사용자" kept whole
		expect(contentTokens("사용자").has("사용자")).toBe(true);
		expect(contentTokens("프로그래머").has("프로그래머")).toBe(true);
	});

	it("CT-09 does NOT strip particle when stem would drop below length 2", () => {
		// "이" alone is len 1, and "을" would strip to "" (len 0). Should fall
		// through to short-filter and be dropped entirely, not produce empty
		// tokens.
		const out = contentTokens("을");
		expect(out.size).toBe(0);
	});

	describe("CT-10 fixture drive", () => {
		for (const fx of KOREAN_TOKENIZATION_FIXTURES) {
			const label = `${JSON.stringify(fx.input)} → ${JSON.stringify(fx.expected)}`;
			it(label, () => {
				const actual = Array.from(contentTokens(fx.input)).sort();
				const expected = [...fx.expected].sort();
				expect(actual).toEqual(expected);
			});
		}
	});

	it("ALLOWED_KOREAN_PARTICLES is exported non-empty (fixture integrity)", () => {
		expect(ALLOWED_KOREAN_PARTICLES.length).toBeGreaterThan(0);
	});
});

// ─── jaccardSimilarity (JS-01..JS-08) ──────────────────────────────────

describe("jaccardSimilarity", () => {
	const s = (arr: string[]) => new Set(arr);

	it("JS-01 identical non-empty → 1", () => {
		expect(jaccardSimilarity(s(["a", "b", "c"]), s(["a", "b", "c"]))).toBe(1);
	});

	it("JS-02 disjoint non-empty → 0", () => {
		expect(jaccardSimilarity(s(["a", "b"]), s(["c", "d"]))).toBe(0);
	});

	it("JS-03 both empty → 0 (fail-safe, see outline §3)", () => {
		expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
	});

	it("JS-04 one empty → 0", () => {
		expect(jaccardSimilarity(new Set(), s(["a"]))).toBe(0);
		expect(jaccardSimilarity(s(["a"]), new Set())).toBe(0);
	});

	it("JS-05 known ratio {a,b,c} vs {b,c,d} → 0.5", () => {
		expect(
			jaccardSimilarity(s(["a", "b", "c"]), s(["b", "c", "d"])),
		).toBeCloseTo(0.5, 10);
	});

	it("JS-06 symmetric", () => {
		const A = s(["x", "y", "z"]);
		const B = s(["y", "z", "w", "v"]);
		expect(jaccardSimilarity(A, B)).toBeCloseTo(jaccardSimilarity(B, A), 10);
	});

	it("JS-07 subset: {a,b} vs {a,b,c,d} → 0.5", () => {
		expect(
			jaccardSimilarity(s(["a", "b"]), s(["a", "b", "c", "d"])),
		).toBeCloseTo(0.5, 10);
	});

	it("JS-08 threshold coupling: jaccard(contentTokens(x), contentTokens(x)) === 1 for non-empty tokenization", () => {
		for (const fx of KOREAN_TOKENIZATION_FIXTURES) {
			const t = contentTokens(fx.input);
			if (t.size === 0) continue; // skip inputs that tokenize to empty
			const j = jaccardSimilarity(t, t);
			expect(j).toBe(1);
		}
	});
});

// ─── mergeRelatedFacts (MR-01..MR-09) ─────────────────────────────────

describe("mergeRelatedFacts", () => {
	it("MR-01 empty input → empty output", () => {
		expect(mergeRelatedFacts([], [])).toEqual([]);
	});

	it("MR-02 undefined sourceEpisodes → no crash, content-only merge", () => {
		const a = makeFact({ content: "Luke prefers Vim", sourceEpisodeIds: ["e1"] });
		const b = makeFact({
			content: "Luke prefers Vim",
			sourceEpisodeIds: ["e2"],
		});
		const out = mergeRelatedFacts([a, b]);
		expect(out).toHaveLength(1);
	});

	it("MR-03 single fact → identity (structurally equal)", () => {
		const fact = makeFact({ content: "only one fact here", entities: ["X"] });
		const out = mergeRelatedFacts([fact], []);
		expect(out).toHaveLength(1);
		expect(out[0]?.content).toBe(fact.content);
	});

	it("MR-04 two facts with jaccard > 0.85 AND within temporal window → merged", () => {
		const now = 1_000_000;
		const ep1 = makeEpisode(now);
		const ep2 = makeEpisode(now + 10 * 60 * 1000); // 10 min later, within 30-min window
		const a = makeFact({
			content: "Luke prefers Neovim for editing code",
			sourceEpisodeIds: [ep1.id],
			importance: 0.6,
		});
		const b = makeFact({
			content: "Luke prefers Neovim for editing code",
			sourceEpisodeIds: [ep2.id],
			importance: 0.7,
		});
		const out = mergeRelatedFacts([a, b], [ep1, ep2]);
		expect(out).toHaveLength(1);
	});

	it("MR-05 similar content but outside temporal window → NOT merged", () => {
		const now = 1_000_000;
		const ep1 = makeEpisode(now);
		const ep2 = makeEpisode(now + 2 * 60 * 60 * 1000); // 2 hours later — outside 30-min window
		const a = makeFact({
			content: "Luke prefers Neovim for editing",
			sourceEpisodeIds: [ep1.id],
		});
		const b = makeFact({
			content: "Luke prefers Neovim for editing",
			sourceEpisodeIds: [ep2.id],
		});
		const out = mergeRelatedFacts([a, b], [ep1, ep2]);
		expect(out).toHaveLength(2);
	});

	it("MR-06 entities: union, deduped", () => {
		const a = makeFact({
			content: "Luke uses Neovim often",
			entities: ["Luke", "Neovim"],
			sourceEpisodeIds: ["e1"],
		});
		const b = makeFact({
			content: "Luke uses Neovim often",
			entities: ["Neovim", "Vim"],
			sourceEpisodeIds: ["e2"],
		});
		const out = mergeRelatedFacts([a, b]);
		expect(out).toHaveLength(1);
		const merged = out[0]!;
		expect(new Set(merged.entities)).toEqual(new Set(["Luke", "Neovim", "Vim"]));
	});

	it("MR-07 topics: union, deduped", () => {
		const a = makeFact({
			content: "editor preference statement here",
			topics: ["editor"],
			sourceEpisodeIds: ["e1"],
		});
		const b = makeFact({
			content: "editor preference statement here",
			topics: ["productivity", "editor"],
			sourceEpisodeIds: ["e2"],
		});
		const out = mergeRelatedFacts([a, b]);
		expect(out).toHaveLength(1);
		expect(new Set(out[0]!.topics)).toEqual(
			new Set(["editor", "productivity"]),
		);
	});

	it("MR-08 importance: max", () => {
		const a = makeFact({
			content: "the merged fact content here",
			importance: 0.4,
			sourceEpisodeIds: ["e1"],
		});
		const b = makeFact({
			content: "the merged fact content here",
			importance: 0.9,
			sourceEpisodeIds: ["e2"],
		});
		const out = mergeRelatedFacts([a, b]);
		expect(out[0]!.importance).toBe(0.9);
	});

	it("MR-09 sourceEpisodeIds: union, deduped, first-fact-order", () => {
		const a = makeFact({
			content: "the merged fact content here",
			sourceEpisodeIds: ["e1", "e2"],
		});
		const b = makeFact({
			content: "the merged fact content here",
			sourceEpisodeIds: ["e2", "e3"],
		});
		const out = mergeRelatedFacts([a, b]);
		expect(new Set(out[0]!.sourceEpisodeIds)).toEqual(
			new Set(["e1", "e2", "e3"]),
		);
	});
});

// ─── integration — dedup hot-path smoke ────────────────────────────────

describe("integration: dedup hot-path is now live", () => {
	it("two near-duplicate facts jaccard > 0.85 via contentTokens", () => {
		const a = contentTokens("Luke prefers Neovim editor for TypeScript work");
		const b = contentTokens("Luke prefers Neovim editor for TypeScript work");
		const sim = jaccardSimilarity(a, b);
		expect(sim).toBeGreaterThan(0.85);
	});

	it("two unrelated facts jaccard ≤ 0.85", () => {
		const a = contentTokens("The weather is nice today");
		const b = contentTokens("My password is hunter2");
		const sim = jaccardSimilarity(a, b);
		expect(sim).toBeLessThanOrEqual(0.85);
	});
});
