import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "../adapters/local.js";
import { MemorySystem } from "../index.js";
import type {
	EncodingContext,
	Episode,
	ExtractedFact,
	FactExtractor,
	MemoryInput,
	RecallContext,
} from "../index.js";

/**
 * Phase D.5 — `MemorySystem` orchestration integration tests.
 * Outline at .agents/progress/phase-d-5-outline.md (authored by
 * independent Plan agent per §4.3).
 *
 * Every test gets a fresh tmpdir LocalAdapter. Consolidate tests inject
 * a test-local factExtractor so the default heuristic stub stays out of
 * scope here.
 */

let rootDir: string;

beforeEach(async () => {
	rootDir = await mkdtemp(join(tmpdir(), "memory-system-test-"));
});

afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true }).catch(() => {});
});

function tmpAdapter(): { adapter: LocalAdapter; path: string } {
	const path = join(rootDir, `store-${randomUUID()}.json`);
	return { adapter: new LocalAdapter(path), path };
}

function makeSystem(opts: {
	factExtractor?: FactExtractor;
	consolidationIntervalMs?: number;
} = {}): { system: MemorySystem; path: string } {
	const { adapter, path } = tmpAdapter();
	const sysOpts: ConstructorParameters<typeof MemorySystem>[0] = {
		adapter,
		consolidationIntervalMs: opts.consolidationIntervalMs ?? 0, // disable timer
	};
	if (opts.factExtractor) sysOpts.factExtractor = opts.factExtractor;
	const system = new MemorySystem(sysOpts);
	return { system, path };
}

const DEFAULT_CTX: EncodingContext = {};
const RECALL_CTX: RecallContext = { topK: 20 };

function input(overrides: Partial<MemoryInput> = {}): MemoryInput {
	return {
		content: "",
		role: "user",
		...overrides,
	};
}

// Test-local factExtractor: 1 fact per episode, with entities/topics
// populated from the content so D.1 primitives have real data to work on.
function oneFactPerEpisodeExtractor(): FactExtractor {
	return async (episodes: Episode[]) =>
		episodes.map(
			(ep): ExtractedFact => ({
				content: ep.content,
				entities: [],
				topics: [],
				importance: ep.importance.utility,
				maxEmotion: ep.importance.emotion,
				sourceEpisodeIds: [ep.id],
			}),
		);
}

// ─── encode (MS-01..MS-10 subset) ──────────────────────────────────────

describe("MemorySystem.encode", () => {
	it("MS-01 high-utility user with IMPORTANCE marker stores an episode", async () => {
		const { system } = makeSystem();
		const ep = await system.encode(
			input({ content: "always remember this important fact" }),
			DEFAULT_CTX,
		);
		expect(ep).not.toBeNull();
		const { episodes } = await system.recall("remember", RECALL_CTX);
		expect(episodes.map((e) => e.id)).toContain(ep?.id);
		await system.close();
	});

	it("MS-02 [P1] marker-free user → stored (encoding gate removed)", async () => {
		const { system } = makeSystem();
		const ep = await system.encode(
			input({ content: "the weather is nice today" }),
			DEFAULT_CTX,
		);
		expect(ep).not.toBeNull();
		expect(ep!.content).toBe("the weather is nice today");
		await system.close();
	});

	it("MS-03 [P1] assistant-role + no markers → stored (encoding gate removed)", async () => {
		const { system } = makeSystem();
		const ep = await system.encode(
			input({ content: "Sure, I can help you with that.", role: "assistant" }),
			DEFAULT_CTX,
		);
		expect(ep).not.toBeNull();
		expect(ep!.content).toBe("Sure, I can help you with that.");
		await system.close();
	});

	it("MS-04 timestamp override preserved on stored episode", async () => {
		const { system } = makeSystem();
		const fixedTs = 1_700_000_000_000;
		const ep = await system.encode(
			input({ content: "always remember", timestamp: fixedTs }),
			DEFAULT_CTX,
		);
		expect(ep?.timestamp).toBe(fixedTs);
		expect(ep?.lastAccessed).toBe(fixedTs);
		await system.close();
	});

	it("MS-08 encode persists across reload", async () => {
		const { system, path } = makeSystem();
		const ep = await system.encode(
			input({ content: "always remember after reload" }),
			DEFAULT_CTX,
		);
		await system.close();

		const adapter2 = new LocalAdapter(path);
		const system2 = new MemorySystem({
			adapter: adapter2,
			consolidationIntervalMs: 0,
		});
		const recent = await adapter2.episode.getRecent(10);
		expect(recent.map((e) => e.id)).toContain(ep?.id);
		await system2.close();
	});

	it("MS-09 two identical-content encodes → 2 distinct episodes (dedup is at consolidation, not encode)", async () => {
		const { system } = makeSystem();
		const a = await system.encode(
			input({ content: "always remember this" }),
			DEFAULT_CTX,
		);
		const b = await system.encode(
			input({ content: "always remember this" }),
			DEFAULT_CTX,
		);
		expect(a?.id).not.toBe(b?.id);
		await system.close();
	});

	it("MS-10 [P1] marker-free user utility === 0.15 → encode returns episode (gate removed)", async () => {
		const { system } = makeSystem();
		const ep = await system.encode(input({ content: "hello" }), DEFAULT_CTX);
		expect(ep).not.toBeNull();
		expect(ep!.importance.utility).toBe(0.15);
		await system.close();
	});
});

// ─── recall (MR-01..MR-04) ─────────────────────────────────────────────

describe("MemorySystem.recall", () => {
	it("MR-01 empty store → empty arrays", async () => {
		const { system } = makeSystem();
		const r = await system.recall("anything", RECALL_CTX);
		expect(r.episodes).toEqual([]);
		expect(r.facts).toEqual([]);
		expect(r.reflections).toEqual([]);
		await system.close();
	});

	it("MR-02 multiple matching encodes → ranked episodes", async () => {
		const { system } = makeSystem();
		await system.encode(
			input({ content: "always remember TypeScript decisions" }),
			DEFAULT_CTX,
		);
		await system.encode(
			input({ content: "must remember Postgres migration" }),
			DEFAULT_CTX,
		);
		await system.encode(
			input({ content: "unrelated surprising bug found elsewhere" }),
			DEFAULT_CTX,
		);
		const r = await system.recall("remember", RECALL_CTX);
		expect(r.episodes.length).toBeGreaterThanOrEqual(2);
		await system.close();
	});

	it("MR-03 topK limits result count", async () => {
		const { system } = makeSystem();
		for (let i = 0; i < 5; i++) {
			await system.encode(
				input({ content: `always remember fact ${i} here` }),
				DEFAULT_CTX,
			);
		}
		const r = await system.recall("remember", { topK: 2 });
		expect(r.episodes.length).toBeLessThanOrEqual(2);
		await system.close();
	});
});

// ─── consolidateNow (MC-01..MC-12 subset) ──────────────────────────────

describe("MemorySystem.consolidateNow", () => {
	it("MC-01 empty store force=true → zero result", async () => {
		const { system } = makeSystem({
			factExtractor: oneFactPerEpisodeExtractor(),
		});
		const r = await system.consolidateNow(true);
		expect(r.episodesProcessed).toBe(0);
		expect(r.factsCreated).toBe(0);
		expect(r.factsUpdated).toBe(0);
		await system.close();
	});

	it("MC-02 aged episodes + force=false → processed, facts created", async () => {
		const oldTs = Date.now() - 10 * 60 * 1000; // 10 min ago, past 5-min gate
		const { system } = makeSystem({
			factExtractor: oneFactPerEpisodeExtractor(),
		});
		await system.encode(
			input({
				content: "always remember Postgres decision",
				timestamp: oldTs,
			}),
			DEFAULT_CTX,
		);
		await system.encode(
			input({ content: "must use TypeScript everywhere", timestamp: oldTs }),
			DEFAULT_CTX,
		);
		const r = await system.consolidateNow(false);
		expect(r.episodesProcessed).toBe(2);
		expect(r.factsCreated).toBe(2);
		await system.close();
	});

	it("MC-03 fresh episodes + force=false → age gate blocks", async () => {
		const { system } = makeSystem({
			factExtractor: oneFactPerEpisodeExtractor(),
		});
		await system.encode(
			input({ content: "always remember fresh episode" }),
			DEFAULT_CTX,
		);
		const r = await system.consolidateNow(false);
		expect(r.episodesProcessed).toBe(0);
		await system.close();
	});

	it("MC-04 fresh episodes + force=true → gate bypassed", async () => {
		const { system } = makeSystem({
			factExtractor: oneFactPerEpisodeExtractor(),
		});
		await system.encode(
			input({ content: "always remember fresh episode" }),
			DEFAULT_CTX,
		);
		const r = await system.consolidateNow(true);
		expect(r.episodesProcessed).toBe(1);
		expect(r.factsCreated).toBe(1);
		await system.close();
	});

	it("MC-05 re-entrancy — second concurrent call returns zero immediately", async () => {
		let resolver: (() => void) | undefined;
		const block = new Promise<void>((r) => {
			resolver = r;
		});
		let extractorCalls = 0;
		const extractor: FactExtractor = async (eps) => {
			extractorCalls++;
			await block;
			return eps.map(
				(ep): ExtractedFact => ({
					content: ep.content,
					entities: [],
					topics: [],
					importance: 0.7,
					maxEmotion: ep.importance.emotion,
					sourceEpisodeIds: [ep.id],
				}),
			);
		};
		const { system } = makeSystem({ factExtractor: extractor });
		await system.encode(input({ content: "always remember blocking" }), DEFAULT_CTX);

		const p1 = system.consolidateNow(true);
		// Let p1 start
		await new Promise((r) => setImmediate(r));
		const r2 = await system.consolidateNow(true);
		expect(r2.episodesProcessed).toBe(0);
		expect(r2.factsCreated).toBe(0);
		expect(extractorCalls).toBe(1); // only p1's call

		resolver?.();
		await p1;
		await system.close();
	});

	it("MC-06 [D.1 dedup hot-path integration] two near-duplicate facts within temporal window → merged to 1 in semantic store", async () => {
		const ts = Date.now() - 10 * 60 * 1000;
		const { system } = makeSystem({
			factExtractor: oneFactPerEpisodeExtractor(),
		});
		// Two highly-similar contents that should jaccard > 0.85 after tokenization
		await system.encode(
			input({
				content: "Luke prefers TypeScript for everyday work coding",
				timestamp: ts,
			}),
			DEFAULT_CTX,
		);
		await system.encode(
			input({
				content: "Luke prefers TypeScript for everyday work coding",
				timestamp: ts + 60_000,
			}),
			DEFAULT_CTX,
		);
		const r = await system.consolidateNow(true);
		expect(r.episodesProcessed).toBe(2);
		// Either factsCreated=1 (cycle-level dedup via mergeRelatedFacts
		// before upsert) OR factsCreated=1 + factsUpdated=1 (first created,
		// second matches duplicate). Both prove the D.1 hot-path is live.
		const { facts } = await system.recall("TypeScript", RECALL_CTX);
		expect(facts).toHaveLength(1);
		await system.close();
	});

	it("MC-06b [anti-over-merge] two facts with jaccard below 0.85 → 2 facts preserved", async () => {
		const ts = Date.now() - 10 * 60 * 1000;
		const { system } = makeSystem({
			factExtractor: oneFactPerEpisodeExtractor(),
		});
		// Deliberately-disjoint content so token overlap stays below 0.85.
		await system.encode(
			input({
				content: "always remember Postgres database connection pooling",
				timestamp: ts,
			}),
			DEFAULT_CTX,
		);
		await system.encode(
			input({
				content: "must prefer TypeScript strict mode compiler settings",
				timestamp: ts + 60_000,
			}),
			DEFAULT_CTX,
		);
		const r = await system.consolidateNow(true);
		expect(r.episodesProcessed).toBe(2);
		// Dedup must NOT merge these — distinct topics, no shared semantic
		// tokens after tokenization. Pin the specificity floor.
		const { facts: allFacts } = await system.recall("database", RECALL_CTX);
		const { facts: tsFacts } = await system.recall("TypeScript", RECALL_CTX);
		const merged = new Set([
			...allFacts.map((f) => f.content),
			...tsFacts.map((f) => f.content),
		]);
		expect(merged.size).toBeGreaterThanOrEqual(2);
		await system.close();
	});

	it("MC-09 extractor throws → rejects and releases the re-entrancy lock", async () => {
		let calls = 0;
		const extractor: FactExtractor = async () => {
			calls++;
			if (calls === 1) throw new Error("extractor boom");
			return [];
		};
		const { system } = makeSystem({ factExtractor: extractor });
		const ts = Date.now() - 10 * 60 * 1000;
		await system.encode(
			input({ content: "always remember failing path", timestamp: ts }),
			DEFAULT_CTX,
		);

		await expect(system.consolidateNow(false)).rejects.toThrow(/boom/);

		// Re-entrancy lock must be released for the follow-up call.
		const r2 = await system.consolidateNow(false);
		expect(r2).toBeDefined();
		expect(calls).toBe(2);
		await system.close();
	});

	it("MC-12 [P1] both marker-free and marker-rich episodes stored and consolidated", async () => {
		const ts = Date.now() - 10 * 60 * 1000;
		const { system } = makeSystem({
			factExtractor: oneFactPerEpisodeExtractor(),
		});
		await system.encode(
			input({ content: "weather is pleasant", timestamp: ts }),
			DEFAULT_CTX,
		);
		await system.encode(
			input({
				content: "always prefer TypeScript for this project",
				timestamp: ts,
			}),
			DEFAULT_CTX,
		);
		const r = await system.consolidateNow(false);
		expect(r.episodesProcessed).toBe(2);
		expect(r.factsCreated).toBe(2);
		await system.close();
	});
});

// ─── RC-04 value-replacement (D.2) through the full orchestration ─────

describe("[D.2 RC-04 integration] value-replacement flows through consolidation", () => {
	it("MR-05 encode old fact → consolidate → encode replacement → consolidate → recall returns the replacement only", async () => {
		const ts = Date.now() - 10 * 60 * 1000;
		// Extractor that preserves entities so RC-04's sharedEntities check fires.
		const extractor: FactExtractor = async (eps) =>
			eps.map((ep) => ({
				content: ep.content,
				entities: ["Luke"],
				topics: ["database"],
				importance: 0.8,
				maxEmotion: ep.importance.emotion,
				sourceEpisodeIds: [ep.id],
			}));
		const { system } = makeSystem({ factExtractor: extractor });

		await system.encode(
			input({
				content: "Luke prefers Postgres for the project database",
				timestamp: ts,
			}),
			DEFAULT_CTX,
		);
		const r1 = await system.consolidateNow(true);
		expect(r1.factsCreated).toBe(1);

		await system.encode(
			input({
				content: "Luke prefers SQLite for the project database",
				timestamp: ts + 120_000,
			}),
			DEFAULT_CTX,
		);
		const r2 = await system.consolidateNow(true);

		// Either factsUpdated=1 (RC-04 kicked reconsolidation) OR factsCreated=1
		// new + existing untouched. Observable behaviour we care about: when we
		// recall, SQLite wins and Postgres is gone.
		expect(r2.episodesProcessed).toBe(1);

		const { facts } = await system.recall("database", RECALL_CTX);
		const contents = facts.map((f) => f.content.toLowerCase());
		expect(contents.some((c) => c.includes("sqlite"))).toBe(true);
		// Postgres fact must be superseded (either deleted or content rewritten).
		// Strict pin: exactly one fact about the database.
		expect(facts).toHaveLength(1);
		await system.close();
	});
});
