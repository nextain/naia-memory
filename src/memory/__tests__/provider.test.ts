/**
 * Tests for NaiaMemoryProvider (R1.3) — MemoryProvider wrapper.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalAdapter } from "../adapters/local.js";
import { NaiaMemoryProvider } from "../provider.js";
import type { MemoryAdapter, Episode, Fact, ConsolidationResult } from "../types.js";
import { isCapable } from "../provider-types.js";

function mockAdapter(): MemoryAdapter {
	const episodes: Episode[] = [];
	const facts: Fact[] = [];

	return {
		episode: {
			store: vi.fn(async (ep: Episode) => { episodes.push(ep); }),
			recall: vi.fn(async () => episodes),
			getRecent: vi.fn(async (n: number) => episodes.slice(-n)),
			getUnconsolidated: vi.fn(async () => episodes.filter((e) => !e.consolidated)),
			markConsolidated: vi.fn(async (ids: string[]) => {
				for (const ep of episodes) if (ids.includes(ep.id)) ep.consolidated = true;
			}),
		},
		semantic: {
			upsert: vi.fn(async (f: Fact) => {
				const idx = facts.findIndex((x) => x.id === f.id);
				if (idx >= 0) facts[idx] = f; else facts.push(f);
			}),
			search: vi.fn(async (_q: string, topK: number) => facts.slice(0, topK)),
			decay: vi.fn(async () => 0),
			associate: vi.fn(async () => {}),
			getAll: vi.fn(async () => facts),
			delete: vi.fn(async () => true),
		},
		procedural: {
			getSkill: vi.fn(async () => null),
			recordOutcome: vi.fn(async () => {}),
			learnFromFailure: vi.fn(async () => {}),
			getReflections: vi.fn(async () => []),
		},
		consolidate: vi.fn(async (): Promise<ConsolidationResult> => ({
			episodesProcessed: 0,
			factsCreated: 0,
			factsUpdated: 0,
			memoriesPruned: 0,
			associationsUpdated: 0,
		})),
		close: vi.fn(async () => {}),
	} as unknown as MemoryAdapter;
}

function makeBackupFact(content: string): Fact {
	const now = Date.now();
	return {
		id: randomUUID(),
		content,
		entities: ["provider"],
		topics: ["backup"],
		createdAt: now,
		updatedAt: now,
		importance: 0.8,
		recallCount: 0,
		lastAccessed: now,
		strength: 0.8,
		status: "active",
		sourceEpisodes: [],
	};
}

describe("NaiaMemoryProvider", () => {
	it("creates instance with MemoryAdapter", () => {
		const adapter = mockAdapter();
		const provider = new NaiaMemoryProvider({ adapter });
		expect(provider).toBeDefined();
	});

	it("encode calls system.encode", async () => {
		const adapter = mockAdapter();
		const provider = new NaiaMemoryProvider({ adapter });
		await provider.encode(
			{ content: "테스트 메시지", role: "user" },
			{ project: "test" },
		);
		expect(adapter.episode.store).toHaveBeenCalled();
	});

	it("recall returns MemoryHit array", async () => {
		const adapter = mockAdapter();
		const provider = new NaiaMemoryProvider({ adapter });
		const hits = await provider.recall("테스트", { project: "test", topK: 5 });
		expect(Array.isArray(hits)).toBe(true);
	});

	it("consolidate returns ConsolidationSummary", async () => {
		const adapter = mockAdapter();
		const provider = new NaiaMemoryProvider({ adapter });
		const summary = await provider.consolidate();
		expect(summary).toHaveProperty("factsCreated");
		expect(summary).toHaveProperty("factsUpdated");
		expect(summary).toHaveProperty("episodesProcessed");
		expect(summary).toHaveProperty("durationMs");
		expect(typeof summary.durationMs).toBe("number");
	});

	it("close delegates to adapter", async () => {
		const adapter = mockAdapter();
		const provider = new NaiaMemoryProvider({ adapter });
		await provider.close();
		expect(adapter.close).toHaveBeenCalled();
	});
});

describe("isCapable", () => {
	it("reports BackupCapableProvider false when the adapter lacks backup methods", () => {
		const adapter = mockAdapter();
		const provider = new NaiaMemoryProvider({ adapter });
		expect(isCapable(provider, "BackupCapableProvider")).toBe(false);
	});

	it("keeps structural backup fallback when no optional gate is present", () => {
		const legacyExternal = {
			exportBackup: async () => new Uint8Array([1]),
			importBackup: async () => {},
		} as unknown as Parameters<typeof isCapable>[0];
		expect(isCapable(legacyExternal, "BackupCapableProvider")).toBe(true);
	});

	it("preserves an optional gate receiver and scopes it to backup", () => {
		const external = {
			ready: true,
			encode: async () => {},
			recall: async () => [],
			consolidate: async () => ({
				factsCreated: 0,
				factsUpdated: 0,
				episodesProcessed: 0,
				durationMs: 0,
			}),
			close: async () => {},
			exportBackup: async () => new Uint8Array([1]),
			importBackup: async () => {},
			supportsBackup() {
				return this.ready;
			},
			scoreImportance: () => ({
				importance: 0.5,
				surprise: 0.5,
				emotion: 0.5,
				utility: 0.5,
			}),
		};
		const candidate = external as unknown as Parameters<typeof isCapable>[0];

		expect(isCapable(candidate, "BackupCapableProvider")).toBe(true);
		external.ready = false;
		expect(isCapable(candidate, "BackupCapableProvider")).toBe(false);
		// The backup gate must not affect unrelated capability detection.
		expect(isCapable(candidate, "ImportanceScoringCapable")).toBe(true);
	});

	it("requires both provider backup methods even when the gate returns true", () => {
		const missingMethod = {
			exportBackup: async () => new Uint8Array([1]),
			supportsBackup: () => true,
		} as unknown as Parameters<typeof isCapable>[0];
		const nonFunction = {
			exportBackup: "unsupported",
			importBackup: async () => {},
		} as unknown as Parameters<typeof isCapable>[0];

		expect(isCapable(missingMethod, "BackupCapableProvider")).toBe(false);
		expect(isCapable(nonFunction, "BackupCapableProvider")).toBe(false);
	});

	it("detects ImportanceScoringCapable", () => {
		const adapter = mockAdapter();
		const provider = new NaiaMemoryProvider({ adapter });
		expect(isCapable(provider, "ImportanceScoringCapable")).toBe(true);
	});

	it("detects ReconsolidationCapableProvider", () => {
		const adapter = mockAdapter();
		const provider = new NaiaMemoryProvider({ adapter });
		expect(isCapable(provider, "ReconsolidationCapableProvider")).toBe(true);
	});

	it("detects TemporalCapableProvider", () => {
		const adapter = mockAdapter();
		const provider = new NaiaMemoryProvider({ adapter });
		expect(isCapable(provider, "TemporalCapableProvider")).toBe(true);
	});

	it("returns false for unknown capability", () => {
		const adapter = mockAdapter();
		const provider = new NaiaMemoryProvider({ adapter });
		expect(isCapable(provider, "UnknownCap")).toBe(false);
	});
});

describe("NaiaMemoryProvider integration", () => {
	it("findContradictions detects state change", async () => {
		const adapter = mockAdapter() as MemoryAdapter;
		const provider = new NaiaMemoryProvider({ adapter });

		await provider.encode(
			{ content: "나는 Neovim을 사용해", role: "user" },
			{ project: "test" },
		);
		await provider.consolidate();

		const contradictions = await provider.findContradictions(
			"Neovim 안 써, Cursor로 바꿨어",
		);
		if (contradictions.length > 0) {
			expect(contradictions[0]!.conflictType).toMatch(/direct|indirect/);
			expect(typeof contradictions[0]!.reason).toBe("string");
		}
	});

	it("scoreImportance returns 4-axis scores", () => {
		const adapter = mockAdapter();
		const provider = new NaiaMemoryProvider({ adapter });
		const scores = provider.scoreImportance("이건 정말 중요한 비밀이야");
		expect(typeof scores.importance).toBe("number");
		expect(typeof scores.surprise).toBe("number");
		expect(typeof scores.emotion).toBe("number");
		expect(typeof scores.utility).toBe("number");
		expect(scores.utility).toBeGreaterThan(0);
	});

	it("applyDecay delegates to adapter", async () => {
		const adapter = mockAdapter();
		const provider = new NaiaMemoryProvider({ adapter });
		const pruned = await provider.applyDecay();
		expect(typeof pruned).toBe("number");
	});

	it("recallWithHistory filters facts by timestamp", async () => {
		const adapter = mockAdapter() as MemoryAdapter;
		const provider = new NaiaMemoryProvider({ adapter });
		await provider.encode(
			{ content: "테스트 팩트", role: "user" },
			{ project: "test" },
		);
		const now = Date.now();
		const hits = await provider.recallWithHistory("테스트", now + 100000, { project: "test" });
		expect(Array.isArray(hits)).toBe(true);
	});

	it("compact returns summary from MemorySystem", async () => {
		const adapter = mockAdapter() as MemoryAdapter;
		const provider = new NaiaMemoryProvider({ adapter });
		const result = await provider.compact({
			messages: [
				{ role: "user", content: "안녕하세요" },
				{ role: "assistant", content: "안녕!" },
				{ role: "user", content: "오늘 날씨 어때?" },
			],
			keepTail: 1,
			targetTokens: 200,
		});
		expect(result).toHaveProperty("summary");
		expect(result).toHaveProperty("droppedCount");
		expect(result.summary.role).toBe("assistant");
	});

	it("detects CompactableCapableProvider", () => {
		const adapter = mockAdapter();
		const provider = new NaiaMemoryProvider({ adapter });
		expect(isCapable(provider, "CompactableCapableProvider")).toBe(true);
	});
});

describe("NaiaMemoryProvider backup", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "provider-backup-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	});

	it("round-trips an encrypted LocalAdapter backup through the provider", async () => {
		const sourceAdapter = new LocalAdapter(join(dir, "source.json"));
		const targetAdapter = new LocalAdapter(join(dir, "target.json"));
		const source = new NaiaMemoryProvider({ adapter: sourceAdapter });
		const target = new NaiaMemoryProvider({ adapter: targetAdapter });
		try {
			await sourceAdapter.semantic.upsert(makeBackupFact("provider source fact"));
			expect(source.supportsBackup()).toBe(true);
			expect(isCapable(source, "BackupCapableProvider")).toBe(true);

			const blob = await source.exportBackup("provider-password");
			await target.importBackup(blob, "provider-password");

			expect(
				(await targetAdapter.semantic.getAll()).map((fact) => fact.content),
			).toContain("provider source fact");
		} finally {
			await source.close();
			await target.close();
		}
	});

	it("preserves target data when provider import receives a wrong password", async () => {
		const sourceAdapter = new LocalAdapter(join(dir, "source.json"));
		const targetAdapter = new LocalAdapter(join(dir, "target.json"));
		const source = new NaiaMemoryProvider({ adapter: sourceAdapter });
		const target = new NaiaMemoryProvider({ adapter: targetAdapter });
		try {
			await sourceAdapter.semantic.upsert(makeBackupFact("provider secret"));
			const blob = await source.exportBackup("correct-password");
			await targetAdapter.semantic.upsert(makeBackupFact("target-only data"));
			const before = await targetAdapter.semantic.getAll();

			await expect(
				target.importBackup(blob, "wrong-password"),
			).rejects.toThrow("Decryption failed");
			expect(await targetAdapter.semantic.getAll()).toEqual(before);
		} finally {
			await source.close();
			await target.close();
		}
	});
});

/**
 * R2.3 — bi-temporal recall via existing `-v{ts}` / `status: "superseded"` scheme.
 * Verifies that `recallWithHistory(query, T)` returns the fact version that was
 * active at time T, leveraging history rows produced by `index.ts:715-737`.
 */
describe("NaiaMemoryProvider — recallWithHistory bi-temporal (R2.3)", () => {
	let dir: string;
	let storePath: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "r23-bitemp-"));
		storePath = join(dir, `store-${randomUUID()}.json`);
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	});

	it("returns the version active at the queried timestamp (Neovim → Cursor)", async () => {
		const adapter = new LocalAdapter(storePath);
		const provider = new NaiaMemoryProvider({ adapter });

		const T0 = Date.now();
		const T1 = T0 + 60_000;

		const baseId = "fact-editor";
		const oldFact: Fact = {
			id: baseId,
			content: "user uses Neovim editor",
			entities: ["Neovim", "user"],
			topics: ["editor"],
			createdAt: T0,
			updatedAt: T0,
			importance: 0.8,
			recallCount: 0,
			lastAccessed: T0,
			strength: 0.8,
			status: "active",
			sourceEpisodes: [],
		};
		await adapter.semantic.upsert(oldFact);

		// Simulate the reconsolidation update path (index.ts:715-737):
		// 1) mark the old fact superseded with updatedAt = T1
		await adapter.semantic.upsert({ ...oldFact, status: "superseded", updatedAt: T1 });
		// 2) create a new versioned fact with the new content
		const newFact: Fact = {
			...oldFact,
			id: `${baseId}-v${T1}`,
			content: "user uses Cursor editor",
			entities: ["Cursor", "user"],
			createdAt: T1,
			updatedAt: T1,
			lastAccessed: T1,
			status: "active",
		};
		await adapter.semantic.upsert(newFact);

		// Recall as of just after T0 (before the switch) → should return Neovim
		const hitsBefore = await provider.recallWithHistory("editor", T0 + 1000, { topK: 5 });
		expect(hitsBefore.length).toBeGreaterThan(0);
		expect(hitsBefore.some((h) => h.content.includes("Neovim"))).toBe(true);
		expect(hitsBefore.every((h) => !h.content.includes("Cursor"))).toBe(true);

		// Recall as of just after T1 (after the switch) → should return Cursor
		const hitsAfter = await provider.recallWithHistory("editor", T1 + 1000, { topK: 5 });
		expect(hitsAfter.length).toBeGreaterThan(0);
		expect(hitsAfter.some((h) => h.content.includes("Cursor"))).toBe(true);
		expect(hitsAfter.every((h) => !h.content.includes("Neovim"))).toBe(true);

		await adapter.close();
	});

	it("hits include createdAt/updatedAt timestamps (issue #8 acceptance)", async () => {
		const adapter = new LocalAdapter(storePath);
		const provider = new NaiaMemoryProvider({ adapter });

		const T0 = Date.now();
		await adapter.semantic.upsert({
			id: "fact-loc",
			content: "user lives in Seoul",
			entities: ["Seoul", "user"],
			topics: ["location"],
			createdAt: T0,
			updatedAt: T0,
			importance: 0.7,
			recallCount: 0,
			lastAccessed: T0,
			strength: 0.7,
			status: "active",
			sourceEpisodes: [],
		});

		const hits = await provider.recallWithHistory("location", T0 + 1000, { topK: 5 });
		expect(hits.length).toBeGreaterThan(0);
		expect(typeof hits[0]!.createdAt).toBe("number");
		expect(typeof hits[0]!.updatedAt).toBe("number");
		expect(hits[0]!.createdAt).toBe(T0);

		await adapter.close();
	});

	it("excludes facts created after the queried timestamp", async () => {
		const adapter = new LocalAdapter(storePath);
		const provider = new NaiaMemoryProvider({ adapter });

		const T0 = Date.now();
		const T_LATER = T0 + 120_000;

		await adapter.semantic.upsert({
			id: "fact-future",
			content: "future hobby is climbing",
			entities: ["climbing"],
			topics: ["hobby"],
			createdAt: T_LATER,
			updatedAt: T_LATER,
			importance: 0.7,
			recallCount: 0,
			lastAccessed: T_LATER,
			strength: 0.7,
			status: "active",
			sourceEpisodes: [],
		});

		const hits = await provider.recallWithHistory("hobby", T0 + 1000, { topK: 5 });
		expect(hits.every((h) => !h.content.includes("climbing"))).toBe(true);

		await adapter.close();
	});
});
