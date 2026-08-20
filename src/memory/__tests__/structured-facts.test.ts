import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "../adapters/local.js";
import { MemorySystem } from "../index.js";
import {
	findStructuredNegationRetirements,
	sameStructuredFact,
} from "../structured-facts.js";
import type {
	ContradictionFilterProvider,
	EncodingContext,
	Episode,
	ExtractedFact,
	Fact,
	FactExtractor,
	MemoryInput,
	RecallContext,
	StructuredFact,
} from "../index.js";

let rootDir: string;
beforeEach(async () => {
	rootDir = await mkdtemp(join(tmpdir(), "structured-facts-test-"));
});
afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true }).catch(() => {});
});

function makeSystem(
	opts: {
		factExtractor?: FactExtractor;
		contradictionFilter?: ContradictionFilterProvider;
	} = {},
): {
	system: MemorySystem;
	adapter: LocalAdapter;
} {
	const adapter = new LocalAdapter(join(rootDir, `store-${randomUUID()}.json`));
	const system = new MemorySystem({
		adapter,
		consolidationIntervalMs: 0,
		...(opts.factExtractor ? { factExtractor: opts.factExtractor } : {}),
		...(opts.contradictionFilter
			? { contradictionFilter: opts.contradictionFilter }
			: {}),
	});
	return { system, adapter };
}
const DEFAULT_CTX: EncodingContext = {};
const RECALL_CTX: RecallContext = { topK: 20 };
function input(overrides: Partial<MemoryInput> = {}): MemoryInput {
	return { content: "", role: "user", ...overrides };
}

describe("structured value comparison safety", () => {
	const base: StructuredFact = {
		subject: "user",
		subjectId: "person:self",
		property: "allergy",
		propertyId: "profile:allergy",
		value: "peanut",
		polarity: "affirmed",
		cardinality: "multi",
	};

	it("accepts a terminal-s variant only for a one-token multi value", () => {
		expect(sameStructuredFact(base, { ...base, value: "peanuts" })).toBe(true);
		expect(
			sameStructuredFact(
				{ ...base, cardinality: "single", value: "state" },
				{ ...base, cardinality: "single", value: "states" },
			),
		).toBe(false);
		expect(sameStructuredFact(base, { ...base, value: "tree nuts" })).toBe(
			false,
		);
		expect(sameStructuredFact(base, { ...base, value: "땅콩들" })).toBe(false);
	});

	it("retires only the exact affirmed member negated by a multi-valued fact", () => {
		const peanut = {
			id: "peanut",
			content: "User likes peanuts",
			status: "active" as const,
			structured: base,
		} as unknown as Fact;
		const almonds = {
			...peanut,
			id: "almonds",
			structured: { ...base, value: "almonds" },
		};
		expect(
			findStructuredNegationRetirements([peanut, almonds], {
				...base,
				polarity: "negated",
			}),
		).toEqual([peanut]);
	});
});

describe("structured consolidation idempotency", () => {
	it("deduplicates exact active content when extractor structure drifts", async () => {
		let extraction = 0;
		const content = "ユーザーはコーヒーを飲みません";
		const { system, adapter } = makeSystem({
			factExtractor: async (episodes) => {
				extraction++;
				return episodes.map((ep) => ({
					content: extraction === 1 ? `${content}。` : content,
					entities: [],
					topics: [],
					importance: 0.8,
					sourceEpisodeIds: [ep.id],
					structured:
						extraction === 2
							? {
									subject: "user",
									subjectId: "person:self",
									property: "beverage consumption",
									propertyId: "profile:beverage-consumption",
									value: "coffee",
									polarity: "negated" as const,
									cardinality: "multi" as const,
								}
							: undefined,
				}));
			},
		});
		const timestamp = Date.now() - 10 * 60 * 1000;
		await system.encode(input({ content, timestamp }), DEFAULT_CTX);
		await system.consolidateNow(true);
		await system.encode(
			input({ content, timestamp: timestamp + 1 }),
			DEFAULT_CTX,
		);
		await system.consolidateNow(true);

		const active = (await adapter.semantic.getAll()).filter(
			(fact) => fact.status === "active",
		);
		expect(active).toHaveLength(1);
		expect(active[0].sourceEpisodes).toHaveLength(2);
		await system.close();
	});
});

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
	function structuredExtractor(
		values: Record<string, StructuredFact>,
	): FactExtractor {
		return async (episodes) =>
			episodes.map((ep) => ({
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
				[oldContent]: {
					subject: "사용자",
					property: "거주지",
					value: "서울",
					polarity: "affirmed",
					cardinality: "single",
					provenance: "caller",
				},
				[newContent]: {
					subject: "사용자",
					property: "거주지",
					value: "부산",
					polarity: "affirmed",
					cardinality: "single",
					provenance: "caller",
				},
			}),
		});
		const timestamp = Date.now() - 10 * 60 * 1000;
		await system.encode(input({ content: oldContent, timestamp }), DEFAULT_CTX);
		await system.consolidateNow(true);
		await system.encode(
			input({ content: newContent, timestamp: timestamp + 1 }),
			DEFAULT_CTX,
		);
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

	it("falls back to semantic contradiction review when structured property IDs drift", async () => {
		const oldContent = "ユーザーの朝の習慣: 読書";
		const newContent = "朝は読書ではなく瞑想に切り替えました";
		const extractor = structuredExtractor({
			[oldContent]: {
				subject: "ユーザー",
				subjectId: "person:self",
				property: "朝の習慣",
				propertyId: "routine:morning",
				value: "読書",
				polarity: "affirmed",
				cardinality: "single",
			},
			[newContent]: {
				subject: "ユーザー",
				subjectId: "person:self",
				property: "趣味",
				propertyId: "profile:hobby",
				value: "瞑想",
				polarity: "affirmed",
				cardinality: "single",
			},
		});
		const contradictionFilter: ContradictionFilterProvider = {
			name: "test-contextual-fallback",
			filter: async (candidates) =>
				candidates.length === 1
					? [
							{
								index: 0,
								result: {
									action: "update",
									updatedContent: newContent,
									reason: "explicit morning-routine replacement",
								},
							},
						]
					: [],
		};
		const { system, adapter } = makeSystem({
			factExtractor: extractor,
			contradictionFilter,
		});
		const timestamp = Date.now() - 10 * 60 * 1000;
		for (const [offset, content] of [oldContent, newContent].entries()) {
			await system.encode(
				input({ content, timestamp: timestamp + offset }),
				DEFAULT_CTX,
			);
			await system.consolidateNow(true);
		}
		const stored = await adapter.semantic.getAll();
		expect(stored.find((fact) => fact.content === oldContent)?.status).toBe(
			"superseded",
		);
		expect(stored.find((fact) => fact.content === newContent)?.status).toBe(
			"active",
		);
		await system.close();
	});

	it("does not let an unscoped write supersede a fact from another project", async () => {
		const projectFact = "사용자 거주지: 서울";
		const unscopedFact = "사용자 거주지: 부산";
		const { system, adapter } = makeSystem({
			factExtractor: structuredExtractor({
				[projectFact]: {
					subject: "사용자",
					property: "거주지",
					value: "서울",
					polarity: "affirmed",
					cardinality: "single",
					provenance: "caller",
				},
				[unscopedFact]: {
					subject: "사용자",
					property: "거주지",
					value: "부산",
					polarity: "affirmed",
					cardinality: "single",
					provenance: "caller",
				},
			}),
		});
		const timestamp = Date.now() - 10 * 60 * 1000;
		await system.encode(input({ content: projectFact, timestamp }), {
			project: "personal",
		});
		await system.consolidateNow(true);
		await system.encode(
			input({ content: unscopedFact, timestamp: timestamp + 1 }),
			DEFAULT_CTX,
		);
		const result = await system.consolidateNow(true);

		expect(result.factsUpdated).toBe(0);
		const facts = await adapter.semantic.getAll();
		expect(facts).toHaveLength(2);
		expect(facts.every((fact) => fact.status === "active")).toBe(true);
		expect(
			facts.find((fact) => fact.content === projectFact)?.encodingContext
				?.project,
		).toBe("personal");
		await system.close();
	});

	it("uses the same opaque comparison rule for English and Japanese", async () => {
		const englishOld = "User preferred editor: Vim";
		const englishNew = "User preferred editor: Helix";
		const japaneseOld = "ユーザー居住地: 東京";
		const japaneseNew = "ユーザー居住地: 大阪";
		const { system, adapter } = makeSystem({
			factExtractor: structuredExtractor({
				[englishOld]: {
					subject: "user",
					property: "preferred editor",
					value: "Vim",
					polarity: "affirmed",
					cardinality: "single",
				},
				[englishNew]: {
					subject: "USER",
					property: "preferred   editor",
					value: "Helix",
					polarity: "affirmed",
					cardinality: "single",
				},
				[japaneseOld]: {
					subject: "ユーザー",
					property: "居住地",
					value: "東京",
					polarity: "affirmed",
					cardinality: "single",
				},
				[japaneseNew]: {
					subject: "ユーザー",
					property: "居住地",
					value: "大阪",
					polarity: "affirmed",
					cardinality: "single",
				},
			}),
		});
		const timestamp = Date.now() - 10 * 60 * 1000;
		for (const content of [englishOld, englishNew, japaneseOld, japaneseNew]) {
			await system.encode(input({ content, timestamp }), DEFAULT_CTX);
			await system.consolidateNow(true);
		}
		const facts = await adapter.semantic.getAll();
		expect(
			facts
				.filter((fact) => fact.status === "active")
				.map((fact) => fact.content)
				.sort(),
		).toEqual([englishNew, japaneseNew].sort());
		await system.close();
	});

	it("supersedes across languages only when the caller supplies the same opaque identity", async () => {
		const korean = "사용자 거주지: 서울";
		const english = "User residence: Busan";
		const { system, adapter } = makeSystem({
			factExtractor: structuredExtractor({
				[korean]: {
					subject: "사용자",
					subjectId: "person:self",
					property: "거주지",
					propertyId: "profile:residence",
					value: "서울",
					polarity: "affirmed",
					cardinality: "single",
				},
				[english]: {
					subject: "user",
					subjectId: "person:self",
					property: "residence",
					propertyId: "profile:residence",
					value: "Busan",
					polarity: "affirmed",
					cardinality: "single",
				},
			}),
		});
		const timestamp = Date.now() - 10 * 60 * 1000;
		for (const content of [korean, english]) {
			await system.encode(input({ content, timestamp }), DEFAULT_CTX);
			await system.consolidateNow(true);
		}
		const facts = await adapter.semantic.getAll();
		expect(facts.find((fact) => fact.content === korean)?.status).toBe(
			"superseded",
		);
		expect(facts.find((fact) => fact.content === english)?.status).toBe(
			"active",
		);
		await system.close();
	});

	it("does not merge equal labels when complete opaque identities disagree", async () => {
		const first = "User residence: Seoul";
		const second = "User residence: Busan";
		const { system, adapter } = makeSystem({
			factExtractor: structuredExtractor({
				[first]: {
					subject: "user",
					subjectId: "person:a",
					property: "residence",
					propertyId: "profile:residence",
					value: "Seoul",
					polarity: "affirmed",
					cardinality: "single",
				},
				[second]: {
					subject: "user",
					subjectId: "person:b",
					property: "residence",
					propertyId: "profile:residence",
					value: "Busan",
					polarity: "affirmed",
					cardinality: "single",
				},
			}),
		});
		const timestamp = Date.now() - 10 * 60 * 1000;
		for (const content of [first, second]) {
			await system.encode(input({ content, timestamp }), DEFAULT_CTX);
			await system.consolidateNow(true);
		}
		expect(
			(await adapter.semantic.getAll()).every(
				(fact) => fact.status === "active",
			),
		).toBe(true);
		await system.close();
	});

	it("fails closed when only one side has IDs or an identity is incomplete", async () => {
		const legacy = "User residence: Seoul";
		const identified = "User residence: Busan";
		const partial = "User residence: Tokyo";
		const { system, adapter } = makeSystem({
			factExtractor: structuredExtractor({
				[legacy]: {
					subject: "user",
					property: "residence",
					value: "Seoul",
					polarity: "affirmed",
					cardinality: "single",
				},
				[identified]: {
					subject: "user",
					subjectId: "person:self",
					property: "residence",
					propertyId: "profile:residence",
					value: "Busan",
					polarity: "affirmed",
					cardinality: "single",
				},
				[partial]: {
					subject: "user",
					subjectId: "person:self",
					property: "residence",
					value: "Tokyo",
					polarity: "affirmed",
					cardinality: "single",
				},
			}),
		});
		const timestamp = Date.now() - 10 * 60 * 1000;
		for (const content of [legacy, identified, partial]) {
			await system.encode(input({ content, timestamp }), DEFAULT_CTX);
			await system.consolidateNow(true);
		}
		expect(
			(await adapter.semantic.getAll()).every(
				(fact) => fact.status === "active",
			),
		).toBe(true);
		await system.close();
	});

	it("keeps multi/different-property facts while exact negation retires its affirmative", async () => {
		const skills = "사용자 기술: TypeScript";
		const moreSkills = "사용자 기술: Rust";
		const residence = "사용자 거주지: 서울";
		const office = "사용자 근무지: 서울";
		const notSeoul = "사용자는 서울에 살지 않는다";
		const { system, adapter } = makeSystem({
			factExtractor: structuredExtractor({
				[skills]: {
					subject: "사용자",
					property: "기술",
					value: "TypeScript",
					polarity: "affirmed",
					cardinality: "multi",
				},
				[moreSkills]: {
					subject: "사용자",
					property: "기술",
					value: "Rust",
					polarity: "affirmed",
					cardinality: "multi",
				},
				[residence]: {
					subject: "사용자",
					property: "거주지",
					value: "서울",
					polarity: "affirmed",
					cardinality: "single",
				},
				[office]: {
					subject: "사용자",
					property: "근무지",
					value: "서울",
					polarity: "affirmed",
					cardinality: "single",
				},
				[notSeoul]: {
					subject: "사용자",
					property: "거주지",
					value: "서울",
					polarity: "negated",
					cardinality: "single",
				},
			}),
		});
		const timestamp = Date.now() - 10 * 60 * 1000;
		for (const content of [skills, moreSkills, residence, office, notSeoul]) {
			await system.encode(input({ content, timestamp }), DEFAULT_CTX);
			await system.consolidateNow(true);
		}
		const stored = await adapter.semantic.getAll();
		expect(stored.find((fact) => fact.content === skills)?.status).toBe(
			"active",
		);
		expect(stored.find((fact) => fact.content === moreSkills)?.status).toBe(
			"active",
		);
		expect(stored.find((fact) => fact.content === residence)?.status).toBe(
			"superseded",
		);
		expect(stored.find((fact) => fact.content === office)?.status).toBe(
			"active",
		);
		expect(stored.find((fact) => fact.content === notSeoul)?.status).toBe(
			"active",
		);
		await system.close();
	});

	it("archives only an exact explicit structured deletion target", async () => {
		const storedContent = "사용자 알레르기: 땅콩";
		const deleteContent = "땅콩 알레르기 기억은 지워줘";
		const target: StructuredFact = {
			subject: "사용자",
			property: "알레르기",
			value: "땅콩",
			polarity: "affirmed",
			cardinality: "multi",
		};
		const { system, adapter } = makeSystem({
			factExtractor: async (episodes) =>
				episodes.map((ep) => ({
					content: ep.content === deleteContent ? storedContent : ep.content,
					entities: [],
					topics: [],
					importance: 0.8,
					sourceEpisodeIds: [ep.id],
					structured: target,
					operation: ep.content === deleteContent ? "delete" : "upsert",
				})),
		});
		const timestamp = Date.now() - 10 * 60 * 1000;
		await system.encode(
			input({ content: storedContent, timestamp }),
			DEFAULT_CTX,
		);
		await system.consolidateNow(true);
		await system.encode(
			input({ content: deleteContent, timestamp: timestamp + 1 }),
			DEFAULT_CTX,
		);
		const result = await system.consolidateNow(true);

		expect(result.factsUpdated).toBe(1);
		expect((await adapter.semantic.getAll())[0].status).toBe("archived");
		expect((await system.recall("땅콩", { topK: 10 })).facts).toHaveLength(0);
		await system.close();
	});

	it("fails closed for an unstructured delete operation", async () => {
		const storedContent = "User allergy: peanut";
		const deleteContent = "Forget my peanut allergy";
		const { system, adapter } = makeSystem({
			factExtractor: async (episodes) =>
				episodes.map((ep) => ({
					content: ep.content,
					entities: [],
					topics: [],
					importance: 0.8,
					sourceEpisodeIds: [ep.id],
					operation: ep.content === deleteContent ? "delete" : "upsert",
				})),
		});
		const timestamp = Date.now() - 10 * 60 * 1000;
		await system.encode(
			input({ content: storedContent, timestamp }),
			DEFAULT_CTX,
		);
		await system.consolidateNow(true);
		await system.encode(
			input({ content: deleteContent, timestamp: timestamp + 1 }),
			DEFAULT_CTX,
		);
		const result = await system.consolidateNow(true);

		expect(result.factsUpdated).toBe(0);
		expect((await adapter.semantic.getAll())[0].status).toBe("active");
		await system.close();
	});

	it("uses complete ontology IDs across language label drift for exact deletion", async () => {
		const storedContent = "User allergy: peanut";
		const deleteContent = "땅콩 알레르기 기억은 지워줘";
		const { system, adapter } = makeSystem({
			factExtractor: async (episodes) =>
				episodes.map((ep) => ({
					content: ep.content,
					entities: [],
					topics: [],
					importance: 0.8,
					sourceEpisodeIds: [ep.id],
					structured: {
						subject: ep.content === deleteContent ? "사용자" : "user",
						subjectId: "person:self",
						property: ep.content === deleteContent ? "알레르기" : "allergy",
						propertyId: "profile:allergy",
						value: ep.content === deleteContent ? "peanuts" : "peanut",
						polarity: "affirmed" as const,
						cardinality: "multi" as const,
					},
					operation: ep.content === deleteContent ? "delete" : "upsert",
				})),
		});
		const timestamp = Date.now() - 10 * 60 * 1000;
		await system.encode(
			input({ content: storedContent, timestamp }),
			DEFAULT_CTX,
		);
		await system.consolidateNow(true);
		await system.encode(
			input({ content: deleteContent, timestamp: timestamp + 1 }),
			DEFAULT_CTX,
		);
		const result = await system.consolidateNow(true);

		expect(result.factsUpdated).toBe(1);
		expect((await adapter.semantic.getAll())[0].status).toBe("archived");
		await system.close();
	});
});
