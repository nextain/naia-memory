/**
 * Tests for ContradictionFilterProvider implementations.
 * R2.5 hybrid contradiction filter — issue #14.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ContradictionFilterProvider,
	GeminiFlashLiteContradictionFilter,
	HeuristicContradictionFilter,
	VllmReasoningContradictionFilter,
	parseContradictionVerdicts,
	selectFilter,
} from "../contradiction-filter.js";
import type { Fact } from "../types.js";

function makeFact(overrides: Partial<Fact> = {}): Fact {
	const now = Date.now();
	return {
		id: overrides.id ?? "fact-1",
		content: overrides.content ?? "user uses Neovim editor",
		entities: overrides.entities ?? ["Neovim", "user"],
		topics: overrides.topics ?? ["editor"],
		createdAt: overrides.createdAt ?? now,
		updatedAt: overrides.updatedAt ?? now,
		importance: overrides.importance ?? 0.7,
		recallCount: overrides.recallCount ?? 0,
		lastAccessed: overrides.lastAccessed ?? now,
		strength: overrides.strength ?? 0.7,
		status: overrides.status ?? "active",
		sourceEpisodes: overrides.sourceEpisodes ?? [],
	};
}

describe("HeuristicContradictionFilter", () => {
	const filter = new HeuristicContradictionFilter();

	it("returns no verdicts when input is empty", async () => {
		const verdicts = await filter.filter([]);
		expect(verdicts).toEqual([]);
	});

	it("returns 'update' verdict for negation-pattern contradictions", async () => {
		// Heuristic needs shared entity OR content overlap. Use Korean fact with
		// "에디터" as a shared entity so newInfo "에디터 Cursor로 바꿨어" matches.
		const fact = makeFact({
			content: "에디터로 Neovim 쓰고 있어",
			entities: ["Neovim", "에디터"],
		});
		const verdicts = await filter.filter([
			{ existing: fact, newInfo: "에디터 Cursor로 바꿨어" },
		]);
		expect(verdicts).toHaveLength(1);
		expect(verdicts[0]!.result.action).toBe("update");
	});

	it("does NOT detect non-negation value-replacement (heuristic limit)", async () => {
		// "이사" / "이제 X 쓰기로" are not in NEGATION_PATTERNS — heuristic misses these.
		// Documents the gap that the LLM filter is meant to close.
		const factLoc = makeFact({
			content: "성수동에 살아",
			entities: ["성수동"],
		});
		const factGit = makeFact({
			id: "fact-git",
			content: "Git은 CLI만 써. GUI 클라이언트는 안 쓰거든",
			entities: ["Git"],
		});

		const verdicts = await filter.filter([
			{ existing: factLoc, newInfo: "이번 달에 판교로 이사해" },
			{ existing: factGit, newInfo: "Git은 이제 GitKraken 쓰기로 했어" },
		]);

		// Heuristic misses both — that's the expected weakness.
		expect(verdicts).toHaveLength(0);
	});

	it("preserves candidate index", async () => {
		const fact = makeFact({
			content: "I use Neovim editor",
			entities: ["Neovim"],
		});
		const verdicts = await filter.filter([
			{
				existing: makeFact({ id: "u", content: "unrelated", entities: ["foo"] }),
				newInfo: "weather is nice",
			},
			{ existing: fact, newInfo: "I no longer use Neovim, switched to Cursor" },
		]);
		expect(verdicts).toHaveLength(1);
		expect(verdicts[0]!.index).toBe(1);
	});
});

describe("GeminiFlashLiteContradictionFilter", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	function mockFetch(jsonContent: string, ok = true, status = 200) {
		globalThis.fetch = vi.fn(async () =>
			new Response(
				JSON.stringify({
					choices: [{ message: { content: jsonContent } }],
				}),
				{ status: ok ? status : 500 },
			),
		) as unknown as typeof fetch;
	}

	it("parses LLM JSON and emits 'update' verdicts only for high-confidence contradictions", async () => {
		mockFetch(
			JSON.stringify({
				"1": { contradiction: true, confidence: 0.9, reason: "moved residence" },
				"2": { contradiction: false, confidence: 0.95, reason: "different topic" },
			}),
		);

		const filter = new GeminiFlashLiteContradictionFilter({ apiKey: "fake" });
		const verdicts = await filter.filter([
			{ existing: makeFact({ content: "성수동에 살아" }), newInfo: "이번 달에 판교로 이사해" },
			{ existing: makeFact({ content: "user uses Neovim" }), newInfo: "weather is nice" },
		]);

		expect(verdicts).toHaveLength(1);
		expect(verdicts[0]!.index).toBe(0);
		expect(verdicts[0]!.result.action).toBe("update");
		expect(verdicts[0]!.result.reason).toContain("moved");
		expect(verdicts[0]!.result.reason).toContain("conf=0.90");
	});

	it("drops low-confidence contradiction verdicts (below threshold)", async () => {
		// LLM says contradiction=true but confidence below 0.7 default → dropped
		mockFetch(
			JSON.stringify({
				"1": { contradiction: true, confidence: 0.55, reason: "ambiguous" },
				"2": { contradiction: true, confidence: 0.85, reason: "clear replacement" },
			}),
		);

		const filter = new GeminiFlashLiteContradictionFilter({ apiKey: "fake" });
		const verdicts = await filter.filter([
			{ existing: makeFact({ content: "키보드 리얼포스" }), newInfo: "기계식도 써봐" },
			{ existing: makeFact({ content: "Git CLI 써" }), newInfo: "Git GitKraken 으로 바꿨어" },
		]);

		expect(verdicts).toHaveLength(1);
		expect(verdicts[0]!.index).toBe(1);
	});

	it("respects custom confidenceThreshold", async () => {
		mockFetch(
			JSON.stringify({
				"1": { contradiction: true, confidence: 0.6, reason: "borderline" },
			}),
		);
		const lenientFilter = new GeminiFlashLiteContradictionFilter({
			apiKey: "fake",
			confidenceThreshold: 0.5,
		});
		const verdicts = await lenientFilter.filter([
			{ existing: makeFact(), newInfo: "x" },
		]);
		expect(verdicts).toHaveLength(1);
	});

	it("treats missing confidence as 0 (drops)", async () => {
		mockFetch(
			JSON.stringify({
				"1": { contradiction: true, reason: "no confidence given" },
			}),
		);
		const filter = new GeminiFlashLiteContradictionFilter({ apiKey: "fake" });
		const verdicts = await filter.filter([
			{ existing: makeFact(), newInfo: "x" },
		]);
		expect(verdicts).toHaveLength(0);
	});

	it("falls back to heuristic on API failure (graceful degradation)", async () => {
		globalThis.fetch = vi.fn(async () =>
			new Response("server error", { status: 500 }),
		) as unknown as typeof fetch;

		const filter = new GeminiFlashLiteContradictionFilter({ apiKey: "fake" });
		// "바꿨" matches heuristic NEGATION_PATTERNS, shared entity "에디터" provides linkage
		const verdicts = await filter.filter([
			{
				existing: makeFact({
					content: "에디터로 Neovim 쓰고 있어",
					entities: ["Neovim", "에디터"],
				}),
				newInfo: "에디터 Cursor로 바꿨어",
			},
		]);

		expect(verdicts).toHaveLength(1);
		expect(verdicts[0]!.result.action).toBe("update");
	});

	it("respects batch size and offsets indices across batches", async () => {
		// Mock returns "all true with high confidence" for both batches
		globalThis.fetch = vi.fn(async () =>
			new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: JSON.stringify({
									"1": { contradiction: true, confidence: 0.9, reason: "test" },
									"2": { contradiction: true, confidence: 0.9, reason: "test" },
								}),
							},
						},
					],
				}),
				{ status: 200 },
			),
		) as unknown as typeof fetch;

		const filter = new GeminiFlashLiteContradictionFilter({ apiKey: "fake", batchSize: 2 });
		const candidates = [
			{ existing: makeFact({ id: "a" }), newInfo: "new a" },
			{ existing: makeFact({ id: "b" }), newInfo: "new b" },
			{ existing: makeFact({ id: "c" }), newInfo: "new c" },
			{ existing: makeFact({ id: "d" }), newInfo: "new d" },
		];
		const verdicts = await filter.filter(candidates);

		expect(verdicts).toHaveLength(4);
		expect(verdicts.map((v) => v.index).sort()).toEqual([0, 1, 2, 3]);
	});
});

describe("VllmReasoningContradictionFilter", () => {
	const originalFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("returns no verdicts on empty input", async () => {
		const filter = new VllmReasoningContradictionFilter({
			baseURL: "http://localhost:9999/v1",
		});
		const verdicts = await filter.filter([]);
		expect(verdicts).toEqual([]);
	});

	it("falls back to heuristic on transport failure", async () => {
		globalThis.fetch = vi.fn(async () => {
			throw new Error("ECONNREFUSED");
		}) as unknown as typeof fetch;

		const filter = new VllmReasoningContradictionFilter({
			baseURL: "http://localhost:9999/v1",
		});
		const verdicts = await filter.filter([
			{
				existing: makeFact({
					content: "에디터로 Neovim 쓰고 있어",
					entities: ["Neovim", "에디터"],
				}),
				newInfo: "에디터 Cursor로 바꿨어",
			},
		]);
		expect(verdicts).toHaveLength(1);
		expect(verdicts[0]!.result.action).toBe("update");
	});

	it("strips code-fenced JSON output from small models", async () => {
		globalThis.fetch = vi.fn(async () =>
			new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content:
									"```json\n{\"1\": {\"contradiction\": true, \"confidence\": 0.9, \"reason\": \"location change\"}}\n```",
							},
						},
					],
				}),
				{ status: 200 },
			),
		) as unknown as typeof fetch;

		const filter = new VllmReasoningContradictionFilter({
			baseURL: "http://localhost:9999/v1",
		});
		const verdicts = await filter.filter([
			{
				existing: makeFact({ content: "성수동에 살아", entities: ["성수동"] }),
				newInfo: "이번 달에 판교로 이사해",
			},
		]);
		expect(verdicts).toHaveLength(1);
		expect(verdicts[0]!.result.reason).toContain("location");
	});
});

describe("selectFilter env-based selection", () => {
	function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
		return fn.call(null) as T;
		// (the function uses an explicit env arg, so withEnv is just a closure helper)
	}

	it("returns Heuristic when no env vars set", () => {
		const f = selectFilter({} as NodeJS.ProcessEnv);
		expect(f).toBeInstanceOf(HeuristicContradictionFilter);
	});

	it("returns Gemini when GEMINI_API_KEY set", () => {
		const f = selectFilter({ GEMINI_API_KEY: "abc" } as NodeJS.ProcessEnv);
		expect(f).toBeInstanceOf(GeminiFlashLiteContradictionFilter);
	});

	it("prefers Vllm over Gemini when both set", () => {
		const f = selectFilter({
			GEMINI_API_KEY: "abc",
			VLLM_REASONING_BASE: "http://localhost:8000",
		} as NodeJS.ProcessEnv);
		expect(f).toBeInstanceOf(VllmReasoningContradictionFilter);
	});

	it("CONTRADICTION_FILTER=heuristic overrides everything", () => {
		const f = selectFilter({
			GEMINI_API_KEY: "abc",
			VLLM_REASONING_BASE: "http://localhost:8000",
			CONTRADICTION_FILTER: "heuristic",
		} as NodeJS.ProcessEnv);
		expect(f).toBeInstanceOf(HeuristicContradictionFilter);
	});

	it("CONTRADICTION_FILTER=gemini without GEMINI_API_KEY throws", () => {
		expect(() =>
			selectFilter({ CONTRADICTION_FILTER: "gemini" } as NodeJS.ProcessEnv),
		).toThrow(/GEMINI_API_KEY missing/i);
	});

	it("CONTRADICTION_FILTER=vllm returns Vllm placeholder", () => {
		const f = selectFilter({ CONTRADICTION_FILTER: "vllm" } as NodeJS.ProcessEnv);
		expect(f).toBeInstanceOf(VllmReasoningContradictionFilter);
	});
});

describe("parseContradictionVerdicts — balanced JSON extraction", () => {
	const batch1 = [{ existing: makeFact(), newInfo: "new value" }];

	it("parses a clean single-object response", () => {
		const raw = '{"1": {"contradiction": true, "confidence": 0.8, "reason": "r"}}';
		const v = parseContradictionVerdicts(raw, batch1, 0, 0.6, "test");
		expect(v).toHaveLength(1);
		expect(v[0]?.result.action).toBe("update");
	});

	it("ignores broken trailing text after the object (flash-lite corruption)", () => {
		const raw =
			'{"1": {"contradiction": true, "confidence": 0.8, "reason": "r"}}\n색깔\'."}}';
		const v = parseContradictionVerdicts(raw, batch1, 0, 0.6, "test");
		expect(v).toHaveLength(1);
	});

	it("strips code fences", () => {
		const raw =
			'```json\n{"1": {"contradiction": true, "confidence": 0.9, "reason": "r"}}\n```';
		const v = parseContradictionVerdicts(raw, batch1, 0, 0.6, "test");
		expect(v).toHaveLength(1);
	});

	it("ignores leading prose before the object", () => {
		const raw =
			'Result: {"1": {"contradiction": true, "confidence": 0.8, "reason": "r"}}';
		const v = parseContradictionVerdicts(raw, batch1, 0, 0.6, "test");
		expect(v).toHaveLength(1);
	});

	it("handles braces inside string values without truncating", () => {
		const raw =
			'{"1": {"contradiction": false, "confidence": 0.1, "reason": "has } and { braces"}}';
		const v = parseContradictionVerdicts(raw, batch1, 0, 0.6, "test");
		expect(v).toHaveLength(0);
	});

	it("skips a brace-bearing prose object before the real verdict", () => {
		// Leading prose can itself contain braces ("{참고}"); the first balanced
		// span fails to parse, so the scanner moves to the next "{" and finds the
		// real verdict object instead of dropping the whole batch.
		const raw =
			'{참고}: {"1": {"contradiction": true, "confidence": 0.8, "reason": "r"}}';
		const v = parseContradictionVerdicts(raw, batch1, 0, 0.6, "test");
		expect(v).toHaveLength(1);
	});

	it("skips a valid-JSON prose object that lacks verdict keys", () => {
		// {"note":…} is valid JSON but not a verdict map; the scanner must keep
		// going to the real {"1":…} rather than accepting the first parseable span.
		const raw =
			'{"note": "thinking"} {"1": {"contradiction": true, "confidence": 0.8, "reason": "r"}}';
		const v = parseContradictionVerdicts(raw, batch1, 0, 0.6, "test");
		expect(v).toHaveLength(1);
	});
});
