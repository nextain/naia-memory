import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalAdapter } from "../adapters/local.js";
import { calculateStrength } from "../decay.js";
import type { EmbeddingProvider } from "../embeddings.js";
import { MemorySystem } from "../index.js";
import type { Episode, Fact } from "../types.js";

const DAY_MS = 86_400_000;

// Stub 2D embedder: query -> [1, 0], exact -> [1, 0], hijacker -> [0.6, 0.8], weak/other -> [0.1, 0.9949874371]
// Real store numbers (#51):
// - hijacker "흠.. 기억을 못하네.": utility 0.225, recallCount 259, recent lastAccessed, strength 11.53
// - unreachable "내 고향은 부산이야": utility 0.15, 85 days old, recallCount 1, strength 0.010
class Stub2DEmbedder implements EmbeddingProvider {
	readonly dims = 2;
	readonly name = "stub-2d";
	readonly embeddingSpaceId = "stub-2d-v1";

	async embed(text: string): Promise<number[]> {
		if (text.includes("hijacker-query")) return [0.6, 0.8];
		if (text.includes("query") || text.includes("exact")) return [1, 0];
		if (text.includes("hijacker")) return [0.6, 0.8];
		return [0.1, 0.9949874371];
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		return Promise.all(texts.map((t) => this.embed(t)));
	}
}

function makeEpisode(overrides: Partial<Episode> = {}): Episode {
	const now = Date.now();
	const content = overrides.content ?? "episode content";
	const utility = overrides.importance?.utility ?? 0.5;
	return {
		id: overrides.id ?? randomUUID(),
		content,
		role: overrides.role ?? "user",
		summary: overrides.summary ?? content.slice(0, 200),
		timestamp: overrides.timestamp ?? now,
		importance: overrides.importance ?? {
			importance: utility,
			surprise: 0,
			emotion: 0.5,
			utility,
		},
		encodingContext: overrides.encodingContext ?? { project: "test-project" },
		consolidated: overrides.consolidated ?? false,
		recallCount: overrides.recallCount ?? 0,
		lastAccessed: overrides.lastAccessed ?? now,
		strength: overrides.strength ?? utility,
		status: overrides.status ?? "active",
		...overrides,
	};
}

function makeFact(overrides: Partial<Fact> = {}): Fact {
	const now = Date.now();
	return {
		id: overrides.id ?? randomUUID(),
		content: overrides.content ?? "fact content",
		entities: overrides.entities ?? [],
		topics: overrides.topics ?? [],
		importance: overrides.importance ?? 0.5,
		strength: overrides.strength ?? 0.5,
		status: overrides.status ?? "active",
		createdAt: overrides.createdAt ?? now,
		updatedAt: overrides.updatedAt ?? now,
		lastAccessed: overrides.lastAccessed ?? now,
		recallCount: overrides.recallCount ?? 0,
		validFrom: overrides.validFrom ?? now,
		validTo: overrides.validTo ?? null,
		sourceEpisodes: overrides.sourceEpisodes ?? [randomUUID()],
		encodingContext: overrides.encodingContext ?? { project: "test-project" },
		...overrides,
	};
}

describe("recall-strength: (1) bounded strength / ranking", () => {
	it("a high-recallCount episode no longer outranks a semantically exact match", async () => {
		// Pre-#51: hijacker (strength 11.53, score inflated by strength*0.05) won every query ahead of exact match.
		const storePath = join(tmpdir(), `naia-recall-str-1-${randomUUID()}.json`);
		const adapter = new LocalAdapter({
			storePath,
			embeddingProvider: new Stub2DEmbedder(),
		});
		try {
			const now = Date.now();
			const exact = makeEpisode({
				id: "exact-ep",
				content: "exact match memory",
				importance: { importance: 0.15, surprise: 0, emotion: 0.5, utility: 0.15 },
				timestamp: now - 85 * DAY_MS,
				lastAccessed: now - 85 * DAY_MS,
				recallCount: 0,
			});
			const hijacker = makeEpisode({
				id: "hijacker-ep",
				content: "hijacker frequently recalled memory",
				importance: { importance: 0.225, surprise: 0, emotion: 0.5, utility: 0.225 },
				timestamp: now,
				lastAccessed: now,
				recallCount: 259,
			});

			await adapter.episode.store(exact);
			await adapter.episode.store(hijacker);

			const recalled = await adapter.episode.recall("query", {
				project: "test-project",
				scopeMode: "strict",
				topK: 5,
			});

			expect(recalled[0]?.id).toBe(exact.id);
		} finally {
			await adapter.close();
			await rm(storePath, { force: true });
		}
	});

	it("episodes stay stable across repeated recalls", async () => {
		// Pre-#51: repeated recalls caused the recalled item to climb and hijack ranking.
		const storePath = join(tmpdir(), `naia-recall-str-2-${randomUUID()}.json`);
		const adapter = new LocalAdapter({
			storePath,
			embeddingProvider: new Stub2DEmbedder(),
		});
		try {
			const exact = makeEpisode({ id: "exact-item", content: "exact content" });
			const hijacker = makeEpisode({ id: "hijacker-item", content: "hijacker content" });
			const weak = makeEpisode({ id: "weak-item", content: "weak content" });

			await adapter.episode.store(exact);
			await adapter.episode.store(hijacker);
			await adapter.episode.store(weak);

			const run1 = await adapter.episode.recall("query", {
				project: "test-project",
				scopeMode: "strict",
				topK: 5,
			});
			const run1Ids = run1.map((e) => e.id);

			for (let i = 0; i < 19; i++) {
				await adapter.episode.recall("query", {
					project: "test-project",
					scopeMode: "strict",
					topK: 5,
				});
			}

			const run20 = await adapter.episode.recall("query", {
				project: "test-project",
				scopeMode: "strict",
				topK: 5,
			});
			expect(run20.map((e) => e.id)).toEqual(run1Ids);

			// Reinforce only the hijacker 60 times. Pre-#51 its
			// strength grew to 0.5 × (1 + 0.2 × 80) = 8.5 (unbounded) and the 0.05 × strength term
			// overtook the 0.247 text-score gap after ~50 recalls, putting it first for "query".
			for (let i = 0; i < 60; i++) {
				await adapter.episode.recall("hijacker-query", {
					project: "test-project",
					scopeMode: "strict",
					topK: 1,
				});
			}

			// Original query still yields exact item first
			const runAfterCross = await adapter.episode.recall("query", {
				project: "test-project",
				scopeMode: "strict",
				topK: 5,
			});
			expect(runAfterCross[0]?.id).toBe(exact.id);
		} finally {
			await adapter.close();
			await rm(storePath, { force: true });
		}
	});

	it("a strongly reinforced fact does not outrank a better fact match", async () => {
		// Pre-#51: Stage 2 relevanceScore*0.7 + strength*0.3 sorted candidates by strength, putting the strong one first.
		const storePath = join(tmpdir(), `naia-recall-str-3-${randomUUID()}.json`);
		const adapter = new LocalAdapter({
			storePath,
			embeddingProvider: new Stub2DEmbedder(),
		});
		try {
			const now = Date.now();
			const betterMatch = makeFact({
				id: "better-fact",
				content: "exact fact statement",
				importance: 0.2,
				createdAt: now - 90 * DAY_MS,
				lastAccessed: now - 90 * DAY_MS,
				recallCount: 0,
			});
			const worseMatch = makeFact({
				id: "worse-fact",
				content: "hijacker fact statement",
				importance: 0.9,
				createdAt: now,
				lastAccessed: now,
				recallCount: 50,
			});

			await adapter.semantic.upsert(betterMatch);
			await adapter.semantic.upsert(worseMatch);

			const hits = await adapter.semantic.search("query", 5, false, {
				project: "test-project",
			});
			expect(hits[0]?.id).toBe(betterMatch.id);
		} finally {
			await adapter.close();
			await rm(storePath, { force: true });
		}
	});
});

describe("recall-strength: (2) low strength does not exclude a strong match", () => {
	it("an episode far below the old minStrength default is still recalled", async () => {
		// Pre-#51: default minStrength 0.05 excluded this 85-day decayed episode because its strength was < 0.05.
		const storePath = join(tmpdir(), `naia-recall-str-4-${randomUUID()}.json`);
		const adapter = new LocalAdapter({
			storePath,
			embeddingProvider: new Stub2DEmbedder(),
		});
		try {
			const now = Date.now();
			const ep = makeEpisode({
				id: "decayed-ep",
				content: "exact decayed memory",
				importance: { importance: 0.15, surprise: 0, emotion: 0.5, utility: 0.15 },
				timestamp: now - 85 * DAY_MS,
				lastAccessed: now - 85 * DAY_MS,
				recallCount: 1,
			});
			const calculated = calculateStrength(
				ep.importance.utility,
				ep.timestamp,
				ep.recallCount,
				ep.lastAccessed,
				now,
			);
			expect(calculated).toBeLessThan(0.05);

			await adapter.episode.store(ep);

			const recalled = await adapter.episode.recall("query", {
				project: "test-project",
			});
			expect(recalled.map((e) => e.id)).toContain(ep.id);
		} finally {
			await adapter.close();
			await rm(storePath, { force: true });
		}
	});

	it("an explicit minStrength still filters", async () => {
		// Pre-#51: minStrength default was 0.05; explicit caller-provided minStrength > 0 still filters out weak items.
		const storePath = join(tmpdir(), `naia-recall-str-5-${randomUUID()}.json`);
		const adapter = new LocalAdapter({
			storePath,
			embeddingProvider: new Stub2DEmbedder(),
		});
		try {
			const now = Date.now();
			const ep = makeEpisode({
				id: "decayed-ep",
				content: "exact decayed memory",
				importance: { importance: 0.15, surprise: 0, emotion: 0.5, utility: 0.15 },
				timestamp: now - 85 * DAY_MS,
				lastAccessed: now - 85 * DAY_MS,
				recallCount: 1,
			});
			await adapter.episode.store(ep);

			const recalled = await adapter.episode.recall("query", {
				project: "test-project",
				minStrength: 0.05,
			});
			expect(recalled.map((e) => e.id)).not.toContain(ep.id);
		} finally {
			await adapter.close();
			await rm(storePath, { force: true });
		}
	});

	it("archived episodes still need deepRecall", async () => {
		// Pre-#51: archived episodes were excluded from normal recall and required deepRecall: true.
		const storePath = join(tmpdir(), `naia-recall-str-6-${randomUUID()}.json`);
		const adapter = new LocalAdapter({
			storePath,
			embeddingProvider: new Stub2DEmbedder(),
		});
		try {
			const archivedEp = makeEpisode({
				id: "archived-ep",
				content: "exact archived memory",
				status: "archived",
			});
			await adapter.episode.store(archivedEp);

			const normalRecall = await adapter.episode.recall("query", {
				project: "test-project",
			});
			expect(normalRecall.map((e) => e.id)).not.toContain(archivedEp.id);

			const deepRecallResult = await adapter.episode.recall("query", {
				project: "test-project",
				deepRecall: true,
			});
			expect(deepRecallResult.map((e) => e.id)).toContain(archivedEp.id);
		} finally {
			await adapter.close();
			await rm(storePath, { force: true });
		}
	});
});

describe("recall-strength: (3) vectorScore / relevanceScore", () => {
	it("recalled episodes carry the raw cosine and the ranking score", async () => {
		// Pre-#51: Episode had no vectorScore property and relevanceScore was contaminated by strength.
		const storePath = join(tmpdir(), `naia-recall-str-7-${randomUUID()}.json`);
		const adapter = new LocalAdapter({
			storePath,
			embeddingProvider: new Stub2DEmbedder(),
		});
		try {
			const exact = makeEpisode({ id: "exact-ep", content: "exact content" });
			const hijacker = makeEpisode({ id: "hijacker-ep", content: "hijacker content" });
			await adapter.episode.store(exact);
			await adapter.episode.store(hijacker);

			const recalled = await adapter.episode.recall("query", {
				project: "test-project",
				topK: 5,
			});
			const exactResult = recalled.find((e) => e.id === exact.id);
			const hijackerResult = recalled.find((e) => e.id === hijacker.id);

			expect(exactResult?.vectorScore).toBeDefined();
			expect(exactResult!.vectorScore!).toBeCloseTo(1.0, 6);
			expect(hijackerResult?.vectorScore).toBeDefined();
			expect(hijackerResult!.vectorScore!).toBeCloseTo(0.6, 6);

			expect(typeof exactResult?.relevanceScore).toBe("number");
			expect(typeof hijackerResult?.relevanceScore).toBe("number");
			expect(recalled[0]?.relevanceScore).toBeGreaterThanOrEqual(recalled[1]?.relevanceScore ?? 0);
		} finally {
			await adapter.close();
			await rm(storePath, { force: true });
		}
	});

	it("vectorScore is omitted, not 0, without an embedding provider", async () => {
		// Pre-#51: vectorScore was undefined because it did not exist; now it is omitted (not 0) so callers can fail closed.
		const storePath = join(tmpdir(), `naia-recall-str-8-${randomUUID()}.json`);
		const adapter = new LocalAdapter({ storePath });
		try {
			const ep = makeEpisode({ id: "no-embed-ep", content: "hello world" });
			await adapter.episode.store(ep);

			const recalled = await adapter.episode.recall("hello", {
				project: "test-project",
			});
			expect(recalled.length).toBeGreaterThan(0);
			for (const r of recalled) {
				expect("vectorScore" in r).toBe(false);
			}
		} finally {
			await adapter.close();
			await rm(storePath, { force: true });
		}
	});

	it("recalled facts carry the raw cosine", async () => {
		// Pre-#51: Fact vectorScore was not exposed and relevanceScore was an RRF fusion score.
		const storePath = join(tmpdir(), `naia-recall-str-9-${randomUUID()}.json`);
		const adapter = new LocalAdapter({
			storePath,
			embeddingProvider: new Stub2DEmbedder(),
		});
		try {
			const exact = makeFact({ id: "exact-f", content: "exact fact" });
			const hijacker = makeFact({ id: "hijacker-f", content: "hijacker fact" });
			await adapter.semantic.upsert(exact);
			await adapter.semantic.upsert(hijacker);

			const hits = await adapter.semantic.search("query", 5, false, {
				project: "test-project",
			});
			const exactHit = hits.find((h) => h.id === exact.id);
			const hijackerHit = hits.find((h) => h.id === hijacker.id);

			expect(exactHit?.vectorScore).toBeDefined();
			expect(exactHit!.vectorScore!).toBeCloseTo(1.0, 6);
			expect(hijackerHit?.vectorScore).toBeDefined();
			expect(hijackerHit!.vectorScore!).toBeCloseTo(0.6, 6);
		} finally {
			await adapter.close();
			await rm(storePath, { force: true });
		}
	});

	it("scores are never written to the store", async () => {
		// Pre-#51: semantic.search directly assigned s.fact.relevanceScore = s.score on the stored object.
		const storePath = join(tmpdir(), `naia-recall-str-10-${randomUUID()}.json`);
		const adapter = new LocalAdapter({
			storePath,
			embeddingProvider: new Stub2DEmbedder(),
		});
		try {
			const ep = makeEpisode({ id: "ep-score-check", content: "exact episode" });
			const fact = makeFact({ id: "fact-score-check", content: "exact fact" });
			await adapter.episode.store(ep);
			await adapter.semantic.upsert(fact);

			await adapter.episode.recall("query", { project: "test-project" });
			await adapter.semantic.search("query", 5, false, { project: "test-project" });

			await adapter.flush();

			const storeRaw = readFileSync(storePath, "utf-8");
			const storeJson = JSON.parse(storeRaw) as { episodes: Episode[]; facts: Fact[] };

			const storedEp = storeJson.episodes.find((e) => e.id === ep.id);
			const storedFact = storeJson.facts.find((f) => f.id === fact.id);

			expect(storedEp).toBeDefined();
			expect(storedFact).toBeDefined();
			expect("vectorScore" in storedEp!).toBe(false);
			expect("relevanceScore" in storedEp!).toBe(false);
			expect("vectorScore" in storedFact!).toBe(false);
			expect("relevanceScore" in storedFact!).toBe(false);
		} finally {
			await adapter.close();
			await rm(storePath, { force: true });
		}
	});

	it("a recalled fact written back under a new id does not persist its scores", async () => {
		// Pre-fix, the spread copy carried both into store.facts.push.
		const storePath = join(tmpdir(), `naia-recall-str-10b-${randomUUID()}.json`);
		const adapter = new LocalAdapter({
			storePath,
			embeddingProvider: new Stub2DEmbedder(),
		});
		try {
			const fact = makeFact({ id: "initial-fact", content: "exact fact" });
			await adapter.semantic.upsert(fact);

			const hits = await adapter.semantic.search("query", 5, false, { project: "test-project" });
			const hit = hits.find((h) => h.id === fact.id);
			expect(hit).toBeDefined();

			await adapter.semantic.upsert({
				...hit!,
				id: "successor-fact",
				content: "exact successor fact",
			});

			await adapter.flush();

			const storeRaw = readFileSync(storePath, "utf-8");
			const storeJson = JSON.parse(storeRaw) as { facts: Fact[] };
			const stored = storeJson.facts.find((f) => f.id === "successor-fact");

			expect(stored).toBeDefined();
			expect("vectorScore" in stored!).toBe(false);
			expect("relevanceScore" in stored!).toBe(false);
		} finally {
			await adapter.close();
			await rm(storePath, { force: true });
		}
	});

	it("a recalled episode stored again does not persist its scores", async () => {
		// Pre-fix, storing a recalled episode copy persisted relevanceScore and vectorScore.
		const storePath = join(tmpdir(), `naia-recall-str-10c-${randomUUID()}.json`);
		const adapter = new LocalAdapter({
			storePath,
			embeddingProvider: new Stub2DEmbedder(),
		});
		try {
			const ep = makeEpisode({ id: "re-stored-ep", content: "exact episode" });
			await adapter.episode.store(ep);

			const recalled = await adapter.episode.recall("query", { project: "test-project" });
			expect(recalled.length).toBeGreaterThan(0);

			await adapter.episode.store(recalled[0]!);

			await adapter.flush();

			const storeRaw = readFileSync(storePath, "utf-8");
			const storeJson = JSON.parse(storeRaw) as { episodes: Episode[] };
			const stored = storeJson.episodes.find((e) => e.id === ep.id);

			expect(stored).toBeDefined();
			expect("vectorScore" in stored!).toBe(false);
			expect("relevanceScore" in stored!).toBe(false);
		} finally {
			await adapter.close();
			await rm(storePath, { force: true });
		}
	});
});

describe("recall-strength: (4) touch: false", () => {
	it("touch:false does not reinforce episodes", async () => {
		// Pre-#51: recall ignored touch and did recallCount++ (3 -> 4). getRecent returns live store objects, so compare against a value snapshot, not the object.
		const storePath = join(tmpdir(), `naia-recall-str-11-${randomUUID()}.json`);
		const adapter = new LocalAdapter({
			storePath,
			embeddingProvider: new Stub2DEmbedder(),
		});
		try {
			const ep = makeEpisode({
				id: "touch-ep",
				content: "exact episode",
				recallCount: 3,
				lastAccessed: Date.now() - DAY_MS,
				strength: 0.8,
			});
			await adapter.episode.store(ep);

			const before = await adapter.episode.getRecent(100);
			const beforeEp = before.find((e) => e.id === ep.id)!;
			const snapshot = { recallCount: beforeEp.recallCount, lastAccessed: beforeEp.lastAccessed, strength: beforeEp.strength };

			const peekResult = await adapter.episode.recall("query", {
				project: "test-project",
				touch: false,
			});
			expect(peekResult.map((e) => e.id)).toContain(ep.id);

			const afterPeek = await adapter.episode.getRecent(100);
			const afterPeekEp = afterPeek.find((e) => e.id === ep.id)!;

			expect(snapshot.recallCount).toBe(3);
			expect(afterPeekEp.recallCount).toBe(snapshot.recallCount);
			expect(afterPeekEp.lastAccessed).toBe(snapshot.lastAccessed);
			expect(afterPeekEp.strength).toBe(snapshot.strength);

			const touchResult = await adapter.episode.recall("query", {
				project: "test-project",
				touch: true,
			});
			expect(peekResult.map((e) => e.id)).toEqual(touchResult.map((e) => e.id));
		} finally {
			await adapter.close();
			await rm(storePath, { force: true });
		}
	});

	it("touch:false does not rewrite the store file", async () => {
		// Pre-#51: recall always called markDirty() and save(), rewriting the store JSON file.
		const storePath = join(tmpdir(), `naia-recall-str-12-${randomUUID()}.json`);
		const adapter = new LocalAdapter({
			storePath,
			embeddingProvider: new Stub2DEmbedder(),
		});
		try {
			const ep = makeEpisode({ id: "peek-ep", content: "exact episode" });
			const fact = makeFact({ id: "peek-fact", content: "exact fact" });
			await adapter.episode.store(ep);
			await adapter.semantic.upsert(fact);
			await adapter.flush();

			const beforeBytes = readFileSync(storePath);

			await adapter.episode.recall("query", { project: "test-project", touch: false });
			await adapter.semantic.search("query", 5, false, { project: "test-project", touch: false });
			await adapter.flush();

			const afterBytes = readFileSync(storePath);
			expect(afterBytes.equals(beforeBytes)).toBe(true);
		} finally {
			await adapter.close();
			await rm(storePath, { force: true });
		}
	});

	it("the default still reinforces", async () => {
		// Pre-#51 and default: recall without touch increments recallCount by 1.
		const storePath = join(tmpdir(), `naia-recall-str-13-${randomUUID()}.json`);
		const adapter = new LocalAdapter({
			storePath,
			embeddingProvider: new Stub2DEmbedder(),
		});
		try {
			const ep = makeEpisode({ id: "default-touch-ep", content: "exact episode", recallCount: 2 });
			await adapter.episode.store(ep);

			await adapter.episode.recall("query", { project: "test-project" });

			const stored = await adapter.episode.getRecent(10);
			const found = stored.find((e) => e.id === ep.id);
			expect(found?.recallCount).toBe(3);
		} finally {
			await adapter.close();
			await rm(storePath, { force: true });
		}
	});

	it("touch:false reaches facts through MemorySystem.recall", async () => {
		// Pre-#51: MemorySystem.recall had no touch parameter and facts were always reinforced.
		const storePath = join(tmpdir(), `naia-recall-str-14-${randomUUID()}.json`);
		const adapter = new LocalAdapter({
			storePath,
			embeddingProvider: new Stub2DEmbedder(),
		});
		const memory = new MemorySystem({ adapter });
		await memory.init();
		try {
			const fact = makeFact({ id: "ms-fact", content: "exact fact", recallCount: 5 });
			await adapter.semantic.upsert(fact);

			await memory.recall("query", { project: "test-project", touch: false });

			const allFacts1 = await adapter.semantic.getAll();
			const fact1 = allFacts1.find((f) => f.id === fact.id);
			expect(fact1?.recallCount).toBe(5);

			await memory.recall("query", { project: "test-project" });

			const allFacts2 = await adapter.semantic.getAll();
			const fact2 = allFacts2.find((f) => f.id === fact.id);
			expect(fact2?.recallCount).toBe(6);
		} finally {
			await adapter.close();
			await rm(storePath, { force: true });
		}
	});
});
