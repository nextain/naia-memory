import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalAdapter } from "../adapters/local.js";
import { MemorySystem } from "../index.js";
import type { StructuredFact } from "../index.js";
import { sameStructuredFact } from "../structured-facts.js";
import { getUsage, resetUsage } from "../usage-tracker.js";

let rootDir: string;

beforeEach(async () => {
	rootDir = await mkdtemp(join(tmpdir(), "multilingual-delete-test-"));
	resetUsage();
});

afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true }).catch(() => {});
	vi.restoreAllMocks();
});

describe("multilingual delete selection", () => {
	it("accepts a terminal-s variant only for a one-token multi value", () => {
		const base: StructuredFact = {
			subject: "user",
			subjectId: "person:self",
			property: "allergy",
			propertyId: "profile:allergy",
			value: "peanut",
			polarity: "affirmed",
			cardinality: "multi",
		};

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

	it("lets a secondary verifier select one value from eligible identity candidates", async () => {
		const peanut = "User allergy: peanut";
		const treeNuts = "User allergy: tree nuts";
		const deleteContent = "내 땅콩 알레르기 기억을 지워줘";
		let candidateValues: string[] = [];
		const adapter = new LocalAdapter(
			join(rootDir, `store-${randomUUID()}.json`),
		);
		const system = new MemorySystem({
			adapter,
			consolidationIntervalMs: 0,
			deleteVerifier: async (_episode, _fact, candidates) => {
				candidateValues = candidates.map(
					(candidate) => candidate.structured.value,
				);
				const selected = candidates.find(
					(candidate) => candidate.structured.value === "peanut",
				);
				return selected
					? { authorized: true, targetFactId: selected.id }
					: { authorized: false };
			},
			factExtractor: async (episodes) =>
				episodes.map((episode) => {
					const isDelete = episode.content === deleteContent;
					const value = episode.content === treeNuts ? "tree nuts" : "peanut";
					return {
						content: isDelete ? peanut : episode.content,
						entities: [],
						topics: [],
						importance: 0.8,
						sourceEpisodeIds: [episode.id],
						structured: {
							subject: isDelete ? "나" : "User",
							subjectId: "person:self",
							property: isDelete ? "알레르기" : "allergy",
							propertyId: "health:allergy",
							value,
							polarity: "affirmed" as const,
							cardinality: "multi" as const,
						},
						operation: isDelete ? ("delete" as const) : ("upsert" as const),
						...(isDelete
							? {
									deleteEvidence: {
										kind: "explicit_removal_request" as const,
										evidenceQuote: deleteContent,
										targetQuote: "땅콩 알레르기",
									},
								}
							: {}),
					};
				}),
		});
		const timestamp = Date.now() - 10 * 60 * 1000;
		await system.encode({ content: peanut, role: "user", timestamp }, {});
		await system.encode(
			{ content: treeNuts, role: "user", timestamp: timestamp + 1 },
			{},
		);
		await system.consolidateNow(true);
		await system.encode(
			{ content: deleteContent, role: "user", timestamp: timestamp + 2 },
			{},
		);

		expect((await system.consolidateNow(true)).factsUpdated).toBe(1);
		expect(candidateValues).toEqual(["peanut"]);
		const stored = await adapter.semantic.getAll();
		expect(stored.find((fact) => fact.content === peanut)?.status).toBe(
			"archived",
		);
		expect(stored.find((fact) => fact.content === treeNuts)?.status).toBe(
			"active",
		);
		await system.close();
	});

	it("does not widen a delete across many different values of one identity", async () => {
		const deleteContent = "내 알레르기 기억을 지워줘";
		let verifierCalls = 0;
		const adapter = new LocalAdapter(
			join(rootDir, `store-${randomUUID()}.json`),
		);
		const system = new MemorySystem({
			adapter,
			consolidationIntervalMs: 0,
			deleteVerifier: async () => {
				verifierCalls++;
				return { authorized: false };
			},
			factExtractor: async (episodes) =>
				episodes.map((episode) => {
					const isDelete = episode.content === deleteContent;
					return {
						content: episode.content,
						entities: [],
						topics: [],
						importance: 0.8,
						sourceEpisodeIds: [episode.id],
						structured: {
							subject: isDelete ? "나" : "User",
							subjectId: "person:self",
							property: isDelete ? "알레르기" : "allergy",
							propertyId: "health:allergy",
							value: isDelete ? "target" : episode.content,
							polarity: "affirmed" as const,
							cardinality: "multi" as const,
						},
						operation: isDelete ? ("delete" as const) : ("upsert" as const),
						...(isDelete
							? {
									deleteEvidence: {
										kind: "explicit_removal_request" as const,
										evidenceQuote: deleteContent,
										targetQuote: "알레르기",
									},
								}
							: {}),
					};
				}),
		});
		const timestamp = Date.now() - 10 * 60 * 1000;
		for (let index = 0; index < 33; index++) {
			await system.encode(
				{
					content: `allergy-${index}`,
					role: "user",
					timestamp: timestamp + index,
				},
				{},
			);
		}
		await system.consolidateNow(true);
		await system.encode(
			{ content: deleteContent, role: "user", timestamp: timestamp + 34 },
			{},
		);

		expect((await system.consolidateNow(true)).factsUpdated).toBe(0);
		expect(verifierCalls).toBe(0);
		expect(getUsage().deleteOutcomes?.denied).toBe(1);
		expect(
			(await adapter.semantic.getAll()).filter(
				(fact) => fact.status === "active",
			),
		).toHaveLength(33);
		await system.close();
	});

	it("fails closed without aborting consolidation when a custom verifier throws", async () => {
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
		const deleteContent = "forget folk";
		const adapter = new LocalAdapter(
			join(rootDir, `store-${randomUUID()}.json`),
		);
		const system = new MemorySystem({
			adapter,
			consolidationIntervalMs: 0,
			deleteVerifier: async () => {
				throw new Error("provider detail must not escape");
			},
			factExtractor: async (episodes) =>
				episodes.map((item) => ({
					content: "User preference: folk",
					entities: [],
					topics: [],
					importance: 0.8,
					sourceEpisodeIds: [item.id],
					structured: {
						subject: "User",
						property: "preference",
						value: "folk",
						polarity: "affirmed" as const,
						cardinality: "single" as const,
					},
					operation:
						item.content === deleteContent
							? ("delete" as const)
							: ("upsert" as const),
					...(item.content === deleteContent
						? {
								deleteEvidence: {
									kind: "explicit_removal_request" as const,
									evidenceQuote: deleteContent,
									targetQuote: "folk",
								},
							}
						: {}),
				})),
		});
		const timestamp = Date.now() - 600_000;
		await system.encode({ content: "folk", role: "user", timestamp }, {});
		await system.consolidateNow(true);
		await system.encode(
			{ content: deleteContent, role: "user", timestamp: timestamp + 1 },
			{},
		);

		await expect(system.consolidateNow(true)).resolves.toMatchObject({
			factsUpdated: 0,
		});
		expect(warning).toHaveBeenCalledWith(
			expect.stringContaining("delete verifier failed"),
		);
		expect(getUsage().deleteOutcomes?.verifier_failed).toBe(1);
		expect((await adapter.semantic.getAll())[0]?.status).toBe("active");
		await system.close();
	});
});
