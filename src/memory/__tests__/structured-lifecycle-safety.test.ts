import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "../adapters/local.js";
import { MemorySystem } from "../index.js";
import type {
	ContradictionFilterProvider,
	EncodingContext,
	FactExtractor,
	MemoryInput,
} from "../index.js";

let rootDir: string;
beforeEach(async () => {
	rootDir = await mkdtemp(join(tmpdir(), "structured-lifecycle-safety-test-"));
});
afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true }).catch(() => {});
});

function makeSystem(options: {
	factExtractor: FactExtractor;
	contradictionFilter?: ContradictionFilterProvider;
}): { system: MemorySystem; adapter: LocalAdapter } {
	const adapter = new LocalAdapter(join(rootDir, `store-${randomUUID()}.json`));
	const system = new MemorySystem({
		adapter,
		consolidationIntervalMs: 0,
		factExtractor: options.factExtractor,
		...(options.contradictionFilter
			? { contradictionFilter: options.contradictionFilter }
			: {}),
	});
	return { system, adapter };
}

const DEFAULT_CTX: EncodingContext = {};
function input(overrides: Partial<MemoryInput> = {}): MemoryInput {
	return { content: "", role: "user", ...overrides };
}

describe("structured lifecycle trust boundaries", () => {
	it("does not let an assistant upsert supersede a user single-value fact", async () => {
		const original = "User lives in Seoul";
		const assistantClaim = "User lives in Busan";
		const { system, adapter } = makeSystem({
			factExtractor: async (episodes) =>
				episodes.map((episode) => ({
					content: episode.content,
					entities: [],
					topics: [],
					importance: 0.8,
					sourceEpisodeIds: [episode.id],
					structured: {
						subject: "User",
						subjectId: "person:self",
						property: "residence",
						propertyId: "profile:residence",
						value: episode.content === original ? "Seoul" : "Busan",
						polarity: "affirmed" as const,
						cardinality: "single" as const,
					},
				})),
		});
		const timestamp = Date.now() - 10 * 60 * 1000;
		await system.encode(input({ content: original, timestamp }), DEFAULT_CTX);
		await system.consolidateNow(true);
		await system.encode(
			input({
				content: assistantClaim,
				role: "assistant",
				timestamp: timestamp + 1,
			}),
			DEFAULT_CTX,
		);
		await system.consolidateNow(true);

		const stored = await adapter.semantic.getAll();
		expect(stored.find((fact) => fact.content === original)?.status).toBe(
			"active",
		);
		expect(
			stored.find((fact) => fact.content === assistantClaim),
		).toBeUndefined();
		await system.close();
	});

	it("does not let an assistant duplicate reconcile a conflicting user peer", async () => {
		const seoul = "User lives in Seoul";
		const busan = "User lives in Busan";
		const echoedSeoul = "User lives in Seoul";
		const { system, adapter } = makeSystem({
			factExtractor: async (episodes) =>
				episodes.map((episode) => ({
					content: episode.content,
					entities: [],
					topics: [],
					importance: 0.8,
					sourceEpisodeIds: [episode.id],
					structured: {
						subject: "User",
						subjectId: "person:self",
						property: "residence",
						propertyId: "profile:residence",
						value: episode.content === busan ? "Busan" : "Seoul",
						polarity: "affirmed" as const,
						cardinality: "single" as const,
					},
				})),
		});
		const timestamp = Date.now() - 10 * 60 * 1000;
		await system.encode(input({ content: seoul, timestamp }), DEFAULT_CTX);
		await system.consolidateNow(true);
		await system.encode(
			input({ content: busan, timestamp: timestamp + 1 }),
			DEFAULT_CTX,
		);
		await system.consolidateNow(true);
		const facts = await adapter.semantic.getAll();
		for (const fact of facts) {
			await adapter.semantic.upsert({ ...fact, status: "active" });
		}
		await system.encode(
			input({
				content: echoedSeoul,
				role: "assistant",
				timestamp: timestamp + 2,
			}),
			DEFAULT_CTX,
		);
		await system.consolidateNow(true);

		const stored = await adapter.semantic.getAll();
		expect(stored.filter((fact) => fact.status === "active")).toHaveLength(2);
		await system.close();
	});

	it("does not let an assistant duplicate alter user fact metadata or provenance", async () => {
		const claim = "User lives in Seoul";
		const { system, adapter } = makeSystem({
			factExtractor: async (episodes) =>
				episodes.map((episode) => ({
					content: episode.content,
					entities: [],
					topics: [],
					importance: episode.role === "user" ? 0.7 : 1,
					maxEmotion: episode.role === "user" ? 0.2 : 1,
					sourceEpisodeIds: [episode.id],
					structured: {
						subject: "User",
						subjectId: "person:self",
						property: "residence",
						propertyId: "profile:residence",
						value: "Seoul",
						polarity: "affirmed" as const,
						cardinality: "single" as const,
					},
				})),
		});
		const timestamp = Date.now() - 10 * 60 * 1000;
		await system.encode(input({ content: claim, timestamp }), DEFAULT_CTX);
		await system.consolidateNow(true);
		const before = (await adapter.semantic.getAll())[0]!;

		await system.encode(
			input({ content: claim, role: "assistant", timestamp: timestamp + 1 }),
			DEFAULT_CTX,
		);
		await system.consolidateNow(true);

		const after = (await adapter.semantic.getAll())[0]!;
		expect(after.sourceEpisodes).toEqual(before.sourceEpisodes);
		expect(after.importance).toBe(before.importance);
		expect(after.strength).toBe(before.strength);
		expect(after.maxEmotion).toBe(before.maxEmotion);
		expect(after.updatedAt).toBe(before.updatedAt);
		await system.close();
	});

	it("lets a user correction fall back when extraction temporarily loses structure", async () => {
		const original = "User lives in Seoul";
		const correction = "User actually lives in Busan now";
		let contradictionCalls = 0;
		const { system, adapter } = makeSystem({
			contradictionFilter: {
				name: "adversarial-test",
				filter: async (candidates) => {
					contradictionCalls++;
					return candidates.map((_candidate, index) => ({
						index,
						result: {
							action: "update" as const,
							updatedContent: correction,
							reason: "forced contradiction",
						},
					}));
				},
			},
			factExtractor: async (episodes) =>
				episodes.map((episode) => ({
					content: episode.content,
					entities: [],
					topics: [],
					importance: 0.8,
					sourceEpisodeIds: [episode.id],
					...(episode.content === original
						? {
								structured: {
									subject: "User",
									subjectId: "person:self",
									property: "residence",
									propertyId: "profile:residence",
									value: "Seoul",
									polarity: "affirmed" as const,
									cardinality: "single" as const,
								},
							}
						: {}),
				})),
		});
		const timestamp = Date.now() - 10 * 60 * 1000;
		await system.encode(input({ content: original, timestamp }), DEFAULT_CTX);
		await system.consolidateNow(true);
		contradictionCalls = 0;
		await system.encode(
			input({ content: correction, timestamp: timestamp + 1 }),
			DEFAULT_CTX,
		);
		await system.consolidateNow(true);

		expect(contradictionCalls).toBe(1);
		expect(
			(await adapter.semantic.getAll()).find(
				(fact) => fact.content === original,
			)?.status,
		).toBe("superseded");
		await system.close();
	});

	it.each(["assistant", "tool"] as const)(
		"does not create a first-time structured profile fact from %s output",
		async (role) => {
			const injected = "User lives in attacker-selected city";
			const { system, adapter } = makeSystem({
				factExtractor: async (episodes) =>
					episodes.map((episode) => ({
						content: episode.content,
						entities: [],
						topics: [],
						importance: 0.9,
						sourceEpisodeIds: [episode.id],
						structured: {
							subject: "User",
							subjectId: "person:self",
							property: "residence",
							propertyId: "profile:residence",
							value: "attacker-selected city",
							polarity: "affirmed" as const,
							cardinality: "single" as const,
						},
					})),
			});
			await system.encode(
				input({ content: injected, role, timestamp: Date.now() - 600_000 }),
				DEFAULT_CTX,
			);

			await system.consolidateNow(true);

			expect(await adapter.semantic.getAll()).toEqual([]);
			await system.close();
		},
	);
});
