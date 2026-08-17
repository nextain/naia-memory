import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "../adapters/local.js";
import { MemorySystem } from "../index.js";
import type { EncodingContext, Episode, ExtractedFact, FactExtractor, MemoryInput, RecallContext, StructuredFact } from "../index.js";

let rootDir: string;
beforeEach(async () => { rootDir = await mkdtemp(join(tmpdir(), "structured-facts-test-")); });
afterEach(async () => { await rm(rootDir, { recursive: true, force: true }).catch(() => {}); });

function makeSystem(opts: { factExtractor?: FactExtractor } = {}): { system: MemorySystem; adapter: LocalAdapter } {
	const adapter = new LocalAdapter(join(rootDir, `store-${randomUUID()}.json`));
	const system = new MemorySystem({ adapter, consolidationIntervalMs: 0, ...(opts.factExtractor ? { factExtractor: opts.factExtractor } : {}) });
	return { system, adapter };
}
const DEFAULT_CTX: EncodingContext = {};
const RECALL_CTX: RecallContext = { topK: 20 };
function input(overrides: Partial<MemoryInput> = {}): MemoryInput { return { content: "", role: "user", ...overrides }; }

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

describe("[#39 structured facts] conservative multilingual supersession", () => {
	function structuredExtractor(values: Record<string, StructuredFact>): FactExtractor {
		return async (episodes) => episodes.map((ep) => ({
			content: ep.content,
			entities: [],
			topics: [],
			importance: 0.8,
			sourceEpisodeIds: [ep.id],
			structured: values[ep.content],
		}));
	}

	it("Korean single-valued replacement keeps the raw predecessor and its chain", async () => {
		const oldContent = "사용자 거주지: 서울";
		const newContent = "사용자 거주지: 부산";
		const { system, adapter } = makeSystem({
			factExtractor: structuredExtractor({
				[oldContent]: { subject: "사용자", property: "거주지", value: "서울", polarity: "affirmed", cardinality: "single", provenance: "caller" },
				[newContent]: { subject: "사용자", property: "거주지", value: "부산", polarity: "affirmed", cardinality: "single", provenance: "caller" },
			}),
		});
		const timestamp = Date.now() - 10 * 60 * 1000;
		await system.encode(input({ content: oldContent, timestamp }), DEFAULT_CTX);
		await system.consolidateNow(true);
		await system.encode(input({ content: newContent, timestamp: timestamp + 1 }), DEFAULT_CTX);
		const result = await system.consolidateNow(true);

		expect(result.factsUpdated).toBe(1);
		const stored = await adapter.semantic.getAll();
		expect(stored).toHaveLength(2);
		const predecessor = stored.find((fact) => fact.content === oldContent)!;
		const successor = stored.find((fact) => fact.content === newContent)!;
		expect(predecessor.status).toBe("superseded");
		expect(predecessor.successorId).toBe(successor.id);
		expect(successor.status).toBe("active");
		expect(successor.supersedes).toBe(predecessor.id);
		expect(successor.structured?.value).toBe("부산");
		const latest = await system.recall("거주지", { topK: 10 });
		expect(latest.facts.map((fact) => fact.content)).toEqual([newContent]);
		await system.close();
	});

	it("does not let an unscoped write supersede a fact from another project", async () => {
		const projectFact = "사용자 거주지: 서울";
		const unscopedFact = "사용자 거주지: 부산";
		const { system, adapter } = makeSystem({
			factExtractor: structuredExtractor({
				[projectFact]: { subject: "사용자", property: "거주지", value: "서울", polarity: "affirmed", cardinality: "single", provenance: "caller" },
				[unscopedFact]: { subject: "사용자", property: "거주지", value: "부산", polarity: "affirmed", cardinality: "single", provenance: "caller" },
			}),
		});
		const timestamp = Date.now() - 10 * 60 * 1000;
		await system.encode(input({ content: projectFact, timestamp }), { project: "personal" });
		await system.consolidateNow(true);
		await system.encode(input({ content: unscopedFact, timestamp: timestamp + 1 }), DEFAULT_CTX);
		const result = await system.consolidateNow(true);

		expect(result.factsUpdated).toBe(0);
		const facts = await adapter.semantic.getAll();
		expect(facts).toHaveLength(2);
		expect(facts.every((fact) => fact.status === "active")).toBe(true);
		expect(facts.find((fact) => fact.content === projectFact)?.encodingContext?.project).toBe("personal");
		await system.close();
	});

	it("uses the same opaque comparison rule for English and Japanese", async () => {
		const englishOld = "User preferred editor: Vim";
		const englishNew = "User preferred editor: Helix";
		const japaneseOld = "ユーザー居住地: 東京";
		const japaneseNew = "ユーザー居住地: 大阪";
		const { system, adapter } = makeSystem({
			factExtractor: structuredExtractor({
				[englishOld]: { subject: "user", property: "preferred editor", value: "Vim", polarity: "affirmed", cardinality: "single" },
				[englishNew]: { subject: "USER", property: "preferred   editor", value: "Helix", polarity: "affirmed", cardinality: "single" },
				[japaneseOld]: { subject: "ユーザー", property: "居住地", value: "東京", polarity: "affirmed", cardinality: "single" },
				[japaneseNew]: { subject: "ユーザー", property: "居住地", value: "大阪", polarity: "affirmed", cardinality: "single" },
			}),
		});
		const timestamp = Date.now() - 10 * 60 * 1000;
		for (const content of [englishOld, englishNew, japaneseOld, japaneseNew]) {
			await system.encode(input({ content, timestamp }), DEFAULT_CTX);
			await system.consolidateNow(true);
		}
		const facts = await adapter.semantic.getAll();
		expect(facts.filter((fact) => fact.status === "active").map((fact) => fact.content).sort())
			.toEqual([englishNew, japaneseNew].sort());
		await system.close();
	});

	it("does not replace multi-valued, negated, or different-property facts", async () => {
		const skills = "사용자 기술: TypeScript";
		const moreSkills = "사용자 기술: Rust";
		const residence = "사용자 거주지: 서울";
		const office = "사용자 근무지: 서울";
		const notSeoul = "사용자는 서울에 살지 않는다";
		const { system, adapter } = makeSystem({
			factExtractor: structuredExtractor({
				[skills]: { subject: "사용자", property: "기술", value: "TypeScript", polarity: "affirmed", cardinality: "multi" },
				[moreSkills]: { subject: "사용자", property: "기술", value: "Rust", polarity: "affirmed", cardinality: "multi" },
				[residence]: { subject: "사용자", property: "거주지", value: "서울", polarity: "affirmed", cardinality: "single" },
				[office]: { subject: "사용자", property: "근무지", value: "서울", polarity: "affirmed", cardinality: "single" },
				[notSeoul]: { subject: "사용자", property: "거주지", value: "서울", polarity: "negated", cardinality: "single" },
			}),
		});
		const timestamp = Date.now() - 10 * 60 * 1000;
		for (const content of [skills, moreSkills, residence, office, notSeoul]) {
			await system.encode(input({ content, timestamp }), DEFAULT_CTX);
			await system.consolidateNow(true);
		}
		expect((await adapter.semantic.getAll()).every((fact) => fact.status === "active")).toBe(true);
		await system.close();
	});
});
