import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "../adapters/local.js";
import { MemorySystem } from "../index.js";
import type { Fact, FactExtractor, StructuredFact } from "../index.js";
import { getUsage, resetUsage } from "../usage-tracker.js";

const residence = (value: string): StructuredFact => ({
	subject: "user",
	subjectId: "person:self",
	property: "residence",
	propertyId: "profile:residence",
	value,
	polarity: "affirmed",
	cardinality: "single",
});

function storedFact(id: string, value: string): Fact {
	return {
		id,
		content: `User residence: ${value}`,
		entities: [],
		topics: [],
		createdAt: 1,
		updatedAt: 1,
		importance: 0.8,
		recallCount: 0,
		lastAccessed: 1,
		strength: 0.8,
		status: "active",
		sourceEpisodes: [],
		structured: residence(value),
	};
}

describe("structured duplicate reconciliation", () => {
	let rootDir: string | undefined;
	afterEach(async () => {
		if (rootDir) await rm(rootDir, { recursive: true, force: true });
	});

	it("retires an older active value even when the new value is already stored", async () => {
		resetUsage();
		rootDir = await mkdtemp(join(tmpdir(), "duplicate-reconciliation-"));
		const adapter = new LocalAdapter(join(rootDir, "store.json"));
		await adapter.semantic.upsert(storedFact("old", "Seoul"));
		await adapter.semantic.upsert(storedFact("canonical", "Busan"));
		const extractor: FactExtractor = async (episodes) =>
			episodes.map((episode) => ({
				content: "User residence: Busan",
				entities: [],
				topics: [],
				importance: 0.8,
				sourceEpisodeIds: [episode.id],
				structured: residence("Busan"),
			}));
		const system = new MemorySystem({
			adapter,
			factExtractor: extractor,
			consolidationIntervalMs: 0,
		});
		await system.encode(
			{
				content: "User residence: Busan",
				role: "user",
				timestamp: Date.now() - 600_000,
			},
			{},
		);
		await system.consolidateNow(true);

		const facts = await adapter.semantic.getAll();
		expect(facts.find((fact) => fact.id === "old")).toMatchObject({
			status: "superseded",
			successorId: "canonical",
		});
		expect(facts.filter((fact) => fact.status === "active")).toHaveLength(1);
		expect(getUsage().mutationOutcomes).toMatchObject({
			structured_duplicate_reconciled: 1,
			structured_duplicate_noop: 0,
			structured_supersession_applied: 0,
			structured_fact_created: 0,
		});
		await system.close();
	});
});
