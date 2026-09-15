import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "../adapters/local.js";
import { MemorySystem } from "../index.js";
import type { ExtractedFact, FactExtractor, StructuredFact } from "../index.js";

let rootDir: string;
beforeEach(async () => {
	rootDir = await mkdtemp(join(tmpdir(), "same-episode-supersession-"));
});
afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true }).catch(() => {});
});

function activity(property: string, value: string): StructuredFact {
	return {
		subject: "user",
		subjectId: "person:self",
		property,
		propertyId: "plan:activity",
		value,
		polarity: "affirmed",
		cardinality: "single",
	};
}

function fact(content: string, episodeId: string, structured: StructuredFact): ExtractedFact {
	return { content, entities: [], topics: [], importance: 0.8, sourceEpisodeIds: [episodeId], structured };
}

async function run(extract: (episodeIds: string[]) => ExtractedFact[], turns: string[]) {
	const adapter = new LocalAdapter(join(rootDir, `store-${randomUUID()}.json`));
	const extractor: FactExtractor = async (episodes) => extract(episodes.map((episode) => episode.id));
	const system = new MemorySystem({ adapter, consolidationIntervalMs: 0, factExtractor: extractor });
	const start = Date.now() - 10 * 60 * 1000;
	for (const [index, content] of turns.entries()) {
		await system.encode({ content, role: "user", timestamp: start + index * 60_000 }, { project: "p" });
	}
	await system.consolidateNow(true);
	const facts = await adapter.semantic.getAll();
	await system.close();
	return facts;
}

describe("supersession between facts of the same source episode", () => {
	it("keeps both facts when one utterance yields two values under one identity", async () => {
		// "I booked a Tuesday calligraphy class and a Thursday cooking class."
		const facts = await run(
			([e1]) => [
				fact("Tuesday calligraphy class booked", e1, activity("plan:activity", "Tuesday calligraphy class")),
				fact("Thursday cooking class booked", e1, activity("plan:activity", "Thursday cooking class")),
			],
			["I booked a Tuesday calligraphy class and a Thursday cooking class."],
		);
		const active = facts.filter((f) => f.status === "active").map((f) => f.structured?.value).sort();
		expect(active).toEqual(["Thursday cooking class", "Tuesday calligraphy class"]);
		expect(facts.some((f) => f.status === "superseded")).toBe(false);
	});

	it("still supersedes a fact from an earlier episode", async () => {
		const facts = await run(
			([e1, e2]) => [
				fact("Gift sets: 36", e1, activity("gift set count", "36")),
				fact("Gift sets: 63", e2, activity("gift set count", "63")),
			],
			["The gift sets are 36.", "Correction: the gift sets are 63."],
		);
		expect(facts.filter((f) => f.status === "active").map((f) => f.structured?.value)).toEqual(["63"]);
		expect(facts.filter((f) => f.status === "superseded").map((f) => f.structured?.value)).toEqual(["36"]);
	});
});
