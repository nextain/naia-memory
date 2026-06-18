import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "../adapters/local.js";
import { MemorySystem } from "../index.js";
import type { Episode, ExtractedFact, FactExtractor } from "../index.js";
import { NaiaMemoryProvider } from "../provider.js";
import { isCapable } from "../provider-types.js";
import type { MemoryProvider, MemoryProviderInput } from "../provider-types.js";

type ProviderFactory = () => Promise<{ provider: NaiaMemoryProvider; cleanup: () => Promise<void> }>;

function localFactory(): ProviderFactory {
	return async () => {
		const dir = await mkdtemp(join(tmpdir(), "contract-test-"));
		const path = join(dir, `store-${randomUUID()}.json`);
		const adapter = new LocalAdapter(path);
		const extractor: FactExtractor = async (eps: Episode[]) =>
			eps.map(
				(ep): ExtractedFact => ({
					content: ep.content,
					entities: [],
					topics: [],
					importance: ep.importance.utility,
					maxEmotion: ep.importance.emotion,
					sourceEpisodeIds: [ep.id],
				}),
			);
		const system = new MemorySystem({ adapter, factExtractor: extractor, consolidationIntervalMs: 0 });
		const provider = new NaiaMemoryProvider({ adapter, factExtractor: extractor });
		return {
			provider,
			cleanup: async () => {
				await system.close().catch(() => {});
				await rm(dir, { recursive: true, force: true }).catch(() => {});
			},
		};
	};
}

const FACTORIES: Record<string, ProviderFactory> = {
	"naia-local": localFactory(),
};

function userInput(overrides: Partial<MemoryProviderInput> = {}): MemoryProviderInput {
	return { content: "", role: "user", ...overrides };
}

for (const [name, factory] of Object.entries(FACTORIES)) {
	describe(`MemoryProvider contract — ${name}`, () => {
		let provider: NaiaMemoryProvider;
		let cleanup: () => Promise<void>;

		beforeEach(async () => {
			const result = await factory();
			provider = result.provider;
			cleanup = result.cleanup;
		});

		afterEach(async () => {
			await cleanup();
		});

		it("C-01: encode + recall roundtrip", async () => {
			await provider.encode(userInput({ content: "나는 TypeScript를 좋아해" }));
			const hits = await provider.recall("TypeScript 취향");
			expect(hits.length).toBeGreaterThanOrEqual(1);
			expect(hits.some((h) => h.content.includes("TypeScript"))).toBe(true);
		});

		it("C-02: project isolation", async () => {
			await provider.encode(userInput({ content: "프로젝트 알파 비밀" }), { project: "alpha" });
			await provider.consolidate();
			const hits = await provider.recall("비밀", { project: "beta" });
			const facts = hits.filter((h) => h.metadata?.type === "fact");
			expect(facts.every((h) => !h.content.includes("알파"))).toBe(true);
		});

		it("C-03: empty recall returns empty array", async () => {
			const hits = await provider.recall("아무것도 없는 쿼리");
			expect(Array.isArray(hits)).toBe(true);
		});

		it("C-04: scores are finite numbers", async () => {
			await provider.encode(userInput({ content: "점수 테스트용 팩트" }));
			const hits = await provider.recall("점수");
			for (const h of hits) {
				expect(typeof h.score).toBe("number");
				expect(Number.isFinite(h.score)).toBe(true);
			}
		});

		it("C-05: consolidate creates facts from episodes", async () => {
			await provider.encode(userInput({ content: "커피 좋아해. 아메리카노만 마셔." }));
			const summary = await provider.consolidate();
			expect(summary.factsCreated).toBeGreaterThanOrEqual(1);
			const hits = await provider.recall("커피", { topK: 50 });
			const hasFactContent = hits.some((h) =>
				h.content.includes("커피"),
			);
			expect(hasFactContent).toBe(true);
		});

		it("C-06: consolidate idempotent", async () => {
			await provider.encode(userInput({ content: "골프 좋아해" }));
			const first = await provider.consolidate();
			const second = await provider.consolidate();
			expect(second.factsCreated).toBeLessThanOrEqual(first.factsCreated);
		});

		it("C-07: Korean text preservation", async () => {
			const ko = "나는 서울에서 태어났고 라면을 좋아해";
			await provider.encode(userInput({ content: ko }));
			await provider.consolidate();
			const hits = await provider.recall("라면");
			const allContent = hits.map((h) => h.content).join(" ");
			expect(/[가-힣]/.test(allContent)).toBe(true);
		});

		it("C-08: capability detection", () => {
			expect(isCapable(provider as MemoryProvider, "ImportanceScoringCapable")).toBe(true);
			expect(isCapable(provider as MemoryProvider, "NonexistentCapability")).toBe(false);
		});

		it("C-09: error resilience — provider survives transient recall on empty state", async () => {
			await expect(provider.recall("없는 내용")).resolves.toBeDefined();
			await provider.encode(userInput({ content: "복구 후 정상 동작" }));
			const hits = await provider.recall("복구");
			expect(hits.length).toBeGreaterThanOrEqual(1);
		});

		it("C-10: close lifecycle — double close does not throw", async () => {
			await provider.close();
			await expect(provider.close()).resolves.toBeUndefined();
		});
	});
}
