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

function structured(property: string, value: string): Fact["structured"] {
	return { subject: "user", property, value, polarity: "affirmed", cardinality: "single" };
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
	await adapter.semantic.upsert(fact("f-mixed-retired", "recording start: 10 am", ["e-mixed"], "archived", { validTo: now + 3, deletedAt: now + 3, structured: structured("recording start", "10 am") }));
	await adapter.semantic.upsert(fact("f-mixed-live", "recording engineer: Mina", ["e-mixed"], "active", { structured: structured("recording engineer", "Mina") }));
	return { adapter, system };
}

describe("latest-mode deleted episode filter", () => {
	it("keeps an episode whose fact was only superseded and drops one whose fact was deleted", async () => {
		const { system } = await seededSystem();
		try {
			const { episodes } = await system.recall("recording", { project: "p", topK: 10 });
			const ids = episodes.map((e) => e.id);
			// e-old's fact was superseded: a wrong supersession would otherwise lose
			// the only record of the value, so the utterance stays visible.
			expect(ids).toContain("e-old");
			expect(ids).toContain("e-new");
			expect(ids).toContain("e-plain");
			// e-mixed has an archived (deleted) fact but also anchors a live fact.
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

	it("keeps superseded chain episodes and drops every source of a deleted chain", async () => {
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
			expect(episodes.map((e) => e.id).sort()).toEqual(["e1", "e2", "e3"]);
			await adapter.episode.store(episode("e4", "forget the meeting time entirely", now + 3));
			await adapter.semantic.upsert(fact("v3", "meeting start: 1 pm", ["e1", "e2", "e3"], "archived", { supersedes: "v2", validTo: now + 3, deletedAt: now + 3 }));
			const afterDelete = await system.recall("meeting", { project: "p", topK: 10 });
			expect(afterDelete.episodes.map((e) => e.id)).not.toContain("e1");
			expect(afterDelete.episodes.map((e) => e.id)).not.toContain("e2");
			expect(afterDelete.episodes.map((e) => e.id)).not.toContain("e3");
			const history = await system.recall("meeting", { project: "p", topK: 10, mode: "history" });
			expect(history.episodes.map((e) => e.id).sort()).toEqual(["e1", "e2", "e3", "e4"]);
		} finally {
			await system.close();
		}
	});
});

describe("latest-mode masking of deleted values", () => {
	async function recallOne(setup: (adapter: LocalAdapter) => Promise<void>, query: string) {
		const adapter = new LocalAdapter(join(rootDir, `store-${randomUUID()}.json`));
		const system = new MemorySystem({ adapter, consolidationIntervalMs: 0 });
		await system.init();
		try {
			await setup(adapter);
			const latest = await system.recall(query, { project: "p", topK: 10 });
			const history = await system.recall(query, { project: "p", topK: 10, mode: "history" });
			return { latest: latest.episodes, history: history.episodes };
		} finally {
			await system.close();
		}
	}

	it("masks the deleted value in an utterance that still anchors a live fact", async () => {
		const { system } = await seededSystem();
		try {
			const { episodes } = await system.recall("recording", { project: "p", topK: 10 });
			const mixed = episodes.find((e) => e.id === "e-mixed");
			expect(mixed?.content).toBe("recording engineer is Mina and recording starts at [deleted]");
			expect(mixed?.redactions).toEqual(["f-mixed-retired"]);
			const past = await system.recall("recording", { project: "p", topK: 10, mode: "history" });
			expect(past.episodes.find((e) => e.id === "e-mixed")?.content).toBe(
				"recording engineer is Mina and recording starts at 10 am",
			);
		} finally {
			await system.close();
		}
	});

	it("masks a Korean deleted value and keeps the live value said with it", async () => {
		const { latest, history } = await recallOne(async (adapter) => {
			await adapter.episode.store(episode("e1", "내 금고 비밀번호는 3852이고 우리 집 와이파이 이름은 달빛이야.", now));
			await adapter.semantic.upsert(fact("secret", "사용자 금고 비밀번호: 3852", ["e1"], "archived", { validTo: now + 1, deletedAt: now + 1, structured: structured("금고 비밀번호", "3852") }));
			await adapter.semantic.upsert(fact("wifi", "사용자 와이파이 이름: 달빛", ["e1"], "active", { structured: structured("와이파이 이름", "달빛") }));
		}, "금고 비밀번호 와이파이");
		expect(latest.find((e) => e.id === "e1")?.content).toBe("내 금고 비밀번호는 [deleted]이고 우리 집 와이파이 이름은 달빛이야.");
		expect(history.find((e) => e.id === "e1")?.content).toContain("3852");
	});

	it("drops the anchoring utterance when the deleted value is not said literally", async () => {
		const { latest } = await recallOne(async (adapter) => {
			await adapter.episode.store(episode("e1", "금고 번호는 삼팔오이이고 와이파이 이름은 달빛이야.", now));
			await adapter.semantic.upsert(fact("secret", "사용자 금고 비밀번호: 3852", ["e1"], "archived", { validTo: now + 1, deletedAt: now + 1, structured: structured("금고 비밀번호", "3852") }));
			await adapter.semantic.upsert(fact("wifi", "사용자 와이파이 이름: 달빛", ["e1"], "active", { structured: structured("와이파이 이름", "달빛") }));
		}, "금고 와이파이");
		expect(latest.map((e) => e.id)).not.toContain("e1");
	});

	it("leaves an occurrence that is part of a live value", async () => {
		const { latest } = await recallOne(async (adapter) => {
			await adapter.episode.store(episode("e1", "요즘은 커피 우유만 마셔.", now));
			await adapter.semantic.upsert(fact("coffee", "사용자 음료: 커피", ["e1"], "archived", { validTo: now + 1, deletedAt: now + 1, structured: structured("음료", "커피") }));
			await adapter.semantic.upsert(fact("latte", "사용자 음료: 커피 우유", ["e1"], "active", { structured: structured("음료", "커피 우유") }));
		}, "커피 우유 음료");
		const e1 = latest.find((e) => e.id === "e1");
		expect(e1?.content).toBe("요즘은 커피 우유만 마셔.");
		expect(e1?.redactions).toBeUndefined();
	});

	it("does not retire or mask an utterance whose fact was archived without a deletion", async () => {
		const { latest } = await recallOne(async (adapter) => {
			await adapter.episode.store(episode("e1", "주말 산책 코스는 강변길이야.", now));
			// Decay and insight distillation archive facts without deletedAt.
			await adapter.semantic.upsert(fact("walk", "사용자 산책 코스: 강변길", ["e1"], "archived", { structured: structured("산책 코스", "강변길") }));
		}, "산책 코스");
		expect(latest.find((e) => e.id === "e1")?.content).toBe("주말 산책 코스는 강변길이야.");
	});
});
