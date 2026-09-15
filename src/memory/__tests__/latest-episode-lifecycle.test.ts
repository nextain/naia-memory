import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "../adapters/local.js";
import { MemorySystem } from "../index.js";
import type { Episode, Fact } from "../types.js";

let rootDir: string;

beforeEach(async () => {
	rootDir = await mkdtemp(join(tmpdir(), "latest-episode-lifecycle-"));
});

afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true }).catch(() => {});
});

// Current time: LocalAdapter decays episode strength, so old timestamps fall below
// minStrength and would hide the behaviour under test.
const now = Date.now() - 60_000;

function episode(id: string, content: string, timestamp: number): Episode {
	return {
		id,
		content,
		summary: content,
		role: "user",
		timestamp,
		importance: { importance: 0.5, surprise: 0, emotion: 0.5, utility: 0.5 },
		encodingContext: { project: "p" },
		consolidated: true,
		recallCount: 0,
		lastAccessed: timestamp,
		strength: 1,
	};
}

function fact(
	id: string,
	content: string,
	sourceEpisodes: string[],
	status: Fact["status"],
	extra: Partial<Fact> = {},
): Fact {
	return {
		id,
		content,
		entities: [],
		topics: ["p"],
		createdAt: now,
		updatedAt: now,
		importance: 0.7,
		recallCount: 0,
		lastAccessed: now,
		strength: 0.8,
		sourceEpisodes,
		status,
		encodingContext: { project: "p" },
		...extra,
	} as Fact;
}

async function seededSystem() {
	const adapter = new LocalAdapter(join(rootDir, `store-${randomUUID()}.json`));
	const system = new MemorySystem({ adapter, consolidationIntervalMs: 0 });
	await system.init();
	await adapter.episode.store(episode("e-old", "recording starts at 10 am", now));
	await adapter.episode.store(episode("e-new", "final recording start is 1 pm, the 10 am slot is cancelled", now + 1));
	await adapter.episode.store(episode("e-plain", "recording room is on the second floor", now + 2));
	await adapter.episode.store(episode("e-mixed", "recording engineer is Mina and recording starts at 10 am", now + 3));
	await adapter.semantic.upsert(fact("f-old", "recording start: 10 am", ["e-old"], "superseded", { validTo: now + 1 }));
	await adapter.semantic.upsert(fact("f-new", "recording start: 1 pm", ["e-new"], "active"));
	await adapter.semantic.upsert(fact("f-mixed-retired", "recording start: 10 am", ["e-mixed"], "archived", { validTo: now + 3 }));
	await adapter.semantic.upsert(fact("f-mixed-live", "recording engineer: Mina", ["e-mixed"], "active"));
	return { adapter, system };
}

describe("latest-mode retired episode filter", () => {
	it("drops an episode whose derived facts are all retired and keeps the rest", async () => {
		const { system } = await seededSystem();
		try {
			const { episodes } = await system.recall("recording", { project: "p", topK: 10 });
			const ids = episodes.map((e) => e.id);
			expect(ids).not.toContain("e-old");
			expect(ids).toContain("e-new");
			expect(ids).toContain("e-plain");
			expect(ids).toContain("e-mixed");
		} finally {
			await system.close();
		}
	});

	it("does not filter episodes in history mode, deep recall or at-time recall", async () => {
		const { system } = await seededSystem();
		try {
			for (const context of [
				{ project: "p", topK: 10, mode: "history" as const },
				{ project: "p", topK: 10, deepRecall: true },
				{ project: "p", topK: 10, mode: "at-time" as const, atTimestamp: now },
			]) {
				const { episodes } = await system.recall("recording", context);
				expect(episodes.map((e) => e.id)).toContain("e-old");
			}
		} finally {
			await system.close();
		}
	});

	it("keeps episodes whose only derived fact has a future validTo", async () => {
		const adapter = new LocalAdapter(join(rootDir, `store-${randomUUID()}.json`));
		const system = new MemorySystem({ adapter, consolidationIntervalMs: 0 });
		await system.init();
		try {
			await adapter.episode.store(episode("e1", "trial membership ends next month", Date.now()));
			await adapter.semantic.upsert(fact("f1", "membership: trial", ["e1"], "active", { validTo: Date.now() + 86_400_000 }));
			const { episodes } = await system.recall("membership", { project: "p", topK: 10 });
			expect(episodes.map((e) => e.id)).toContain("e1");
		} finally {
			await system.close();
		}
	});

	it("drops an episode inherited by a live successor that is not its anchor", async () => {
		const adapter = new LocalAdapter(join(rootDir, `store-${randomUUID()}.json`));
		const system = new MemorySystem({ adapter, consolidationIntervalMs: 0 });
		await system.init();
		try {
			await adapter.episode.store(episode("e1", "meeting starts at 10 am", now));
			await adapter.episode.store(episode("e2", "meeting moved to 11 am", now + 1));
			await adapter.episode.store(episode("e3", "meeting final time is 1 pm, 10 and 11 are cancelled", now + 2));
			// Successors inherit predecessors' episodes: [...inherited, ...new].
			await adapter.semantic.upsert(fact("v1", "meeting start: 10 am", ["e1"], "superseded", { validTo: now + 1 }));
			await adapter.semantic.upsert(fact("v2", "meeting start: 11 am", ["e1", "e2"], "superseded", { validTo: now + 2, supersedes: "v1" }));
			await adapter.semantic.upsert(fact("v3", "meeting start: 1 pm", ["e1", "e2", "e3"], "active", { supersedes: "v2" }));
			const { episodes } = await system.recall("meeting", { project: "p", topK: 10 });
			const ids = episodes.map((e) => e.id);
			expect(ids).toEqual(["e3"]);
			const history = await system.recall("meeting", { project: "p", topK: 10, mode: "history" });
			expect(history.episodes.map((e) => e.id).sort()).toEqual(["e1", "e2", "e3"]);
		} finally {
			await system.close();
		}
	});
});
