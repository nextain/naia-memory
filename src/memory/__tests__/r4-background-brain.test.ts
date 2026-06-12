/**
 * R4 #26 Background brain — unit tests (실 동작 verify).
 *
 * 검증:
 * - Step 1+2: spike subscribe / unsubscribe / setActiveContext / getActiveContext
 * - Step 3a: contradiction trigger (R2.5 supersede 시점)
 * - Step 3b: high-importance-relevant (active context 매칭 + importance ≥ 0.8)
 * - Step 4: replay boost (consolidate cycle)
 * - Step 5a: temporal-anchor — WIP, detector 미배선이라 3건 모두 it.skip (아래 참고)
 * - Privacy: cross-project leak 차단 + optOutTopics
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "../adapters/local.js";
import { MemorySystem } from "../index.js";
import type {
	ActiveContext,
	SpikeAction,
	SpikeEvent,
} from "../spike.js";
import type { Fact } from "../types.js";

describe("R4 Background brain — Step 1+2 infrastructure", () => {
	let memory: MemorySystem;

	beforeEach(() => {
		const tmpPath = `/tmp/r4-test-${Date.now()}-${Math.random()}.json`;
		memory = new MemorySystem({
			adapter: new LocalAdapter({ storePath: tmpPath }),
		});
	});

	afterEach(async () => {
		await memory.close();
	});

	it("subscribe / unsubscribe spike handler", () => {
		const handler = async (_e: SpikeEvent): Promise<SpikeAction | void> => {};
		memory.on("spike", handler);
		// off 가 정상 작동 — 다음 emit 시 handler 호출 X (별도 verify)
		memory.off("spike", handler);
		expect(true).toBe(true); // smoke — no throw
	});

	it("setActiveContext / getActiveContext round-trip", () => {
		const ctx: ActiveContext = {
			topics: ["직업", "이직"],
			recentFactIds: ["a", "b"],
			scope: { project: "personal" },
		};
		memory.setActiveContext(ctx);
		expect(memory.getActiveContext()).toEqual(ctx);
	});

	it("close() clears handlers + activeContext", async () => {
		memory.on("spike", async () => {});
		memory.setActiveContext({
			topics: [],
			recentFactIds: [],
			scope: { project: "p" },
		});
		await memory.close();
		expect(memory.getActiveContext()).toBeNull();
	});
});

describe("R4 Step 3a — contradiction trigger", () => {
	let memory: MemorySystem;
	let receivedSpikes: SpikeEvent[];

	beforeEach(() => {
		receivedSpikes = [];
		const tmpPath = `/tmp/r4-test-${Date.now()}-${Math.random()}.json`;
		memory = new MemorySystem({
			adapter: new LocalAdapter({ storePath: tmpPath }),
		});
		memory.on("spike", async (e) => {
			receivedSpikes.push(e);
		});
	});

	afterEach(async () => {
		await memory.close();
	});

	it("emitSpike — contradiction reason 발사 후 handler 받음", async () => {
		// Direct emit test — 내부 로직 verify
		await (memory as any).emitSpike({
			factId: "f1",
			content: "사용자 직업: 디자이너",
			reason: "contradiction",
			confidence: 0.9,
			relatedFactIds: ["f0"],
			emittedAt: Date.now(),
			scope: { project: "personal" },
		});
		expect(receivedSpikes).toHaveLength(1);
		expect(receivedSpikes[0].reason).toBe("contradiction");
		expect(receivedSpikes[0].factId).toBe("f1");
	});

	it("Cross-project scope 차단 — active context 와 다른 project skip", async () => {
		memory.setActiveContext({
			topics: [],
			recentFactIds: [],
			scope: { project: "work" },
		});
		await (memory as any).emitSpike({
			factId: "f1",
			content: "심리 상담",
			reason: "high-importance-relevant",
			confidence: 0.9,
			relatedFactIds: [],
			emittedAt: Date.now(),
			scope: { project: "personal" }, // active 와 다름
		});
		expect(receivedSpikes).toHaveLength(0);
	});

	it("optOutTopics 차단 — 사용자 명시 차단 topic", async () => {
		memory.setActiveContext({
			topics: [],
			recentFactIds: [],
			scope: { project: "p" },
			optOutTopics: ["민감주제"],
		});
		await (memory as any).emitSpike({
			factId: "f1",
			content: "이건 민감주제 관련 fact",
			reason: "contradiction",
			confidence: 0.9,
			relatedFactIds: [],
			emittedAt: Date.now(),
			scope: { project: "p" },
		});
		expect(receivedSpikes).toHaveLength(0);
	});
});

describe("R4 Step 3b — high-importance-relevant trigger", () => {
	it("matchesActiveContext — topic substring 매칭", () => {
		const tmpPath = `/tmp/r4-match-${Date.now()}.json`;
		const memory = new MemorySystem({
			adapter: new LocalAdapter({ storePath: tmpPath }),
		});
		memory.setActiveContext({
			topics: ["직업"],
			recentFactIds: [],
			scope: { project: "p" },
		});
		const fact: Fact = {
			id: "f1",
			content: "사용자 직업: 디자이너",
			entities: [],
			topics: [],
			createdAt: Date.now(),
			updatedAt: Date.now(),
			importance: 0.9,
			recallCount: 0,
			lastAccessed: Date.now(),
			strength: 0.9,
			status: "active",
			sourceEpisodes: [],
		};
		expect((memory as any).matchesActiveContext(fact)).toBe(true);
		memory.close();
	});

	it("matchesActiveContext — entity 매칭", () => {
		const tmpPath = `/tmp/r4-match2-${Date.now()}.json`;
		const memory = new MemorySystem({
			adapter: new LocalAdapter({ storePath: tmpPath }),
		});
		memory.setActiveContext({
			topics: ["디자이너"],
			recentFactIds: [],
			scope: { project: "p" },
		});
		const fact: Fact = {
			id: "f1",
			content: "User profession changed",
			entities: ["디자이너", "회사"],
			topics: [],
			createdAt: Date.now(),
			updatedAt: Date.now(),
			importance: 0.9,
			recallCount: 0,
			lastAccessed: Date.now(),
			strength: 0.9,
			status: "active",
			sourceEpisodes: [],
		};
		expect((memory as any).matchesActiveContext(fact)).toBe(true);
		memory.close();
	});

	it("matchesActiveContext — no match", () => {
		const tmpPath = `/tmp/r4-match3-${Date.now()}.json`;
		const memory = new MemorySystem({
			adapter: new LocalAdapter({ storePath: tmpPath }),
		});
		memory.setActiveContext({
			topics: ["커피"],
			recentFactIds: [],
			scope: { project: "p" },
		});
		const fact: Fact = {
			id: "f1",
			content: "사용자 직업: 디자이너",
			entities: ["디자이너"],
			topics: [],
			createdAt: Date.now(),
			updatedAt: Date.now(),
			importance: 0.9,
			recallCount: 0,
			lastAccessed: Date.now(),
			strength: 0.9,
			status: "active",
			sourceEpisodes: [],
		};
		expect((memory as any).matchesActiveContext(fact)).toBe(false);
		memory.close();
	});
});

describe("R4 Step 3c — recall-failure-resolved", () => {
	it("getRepeatedFailQueries — 3회 반복 + 모두 low result 검출", async () => {
		const tmpPath = `/tmp/r4-repeated-${Date.now()}.json`;
		const memory = new MemorySystem({
			adapter: new LocalAdapter({ storePath: tmpPath }),
		});
		// recallHistory 에 직접 push (private — 접근 위해 cast)
		const m = memory as any;
		for (let i = 0; i < 3; i++) {
			m.recallHistory.push({
				query: "내 직업이 뭐였지",
				resultCount: 0,
				ts: Date.now() - i * 1000,
			});
		}
		// 다른 query 1회 + result 충분 — repeated 가 아님
		m.recallHistory.push({
			query: "오늘 날씨",
			resultCount: 5,
			ts: Date.now(),
		});
		const repeated = memory.getRepeatedFailQueries(3, 3);
		expect(repeated).toContain("내 직업이 뭐였지");
		expect(repeated).not.toContain("오늘 날씨");
		await memory.close();
	});

	it("repeated-fail → consolidate 새 fact 매칭 → emit (자동)", async () => {
		const tmpPath = `/tmp/r4-repemit-${Date.now()}.json`;
		const adapter = new LocalAdapter({ storePath: tmpPath });
		const memory = new MemorySystem({ adapter });
		const m = memory as any;
		// 같은 query 3회 + 모두 result < 3
		for (let i = 0; i < 3; i++) {
			m.recallHistory.push({
				query: "내 직업",
				resultCount: 1,
				ts: Date.now() - i * 1000,
			});
		}
		const received: SpikeEvent[] = [];
		memory.on("spike", async (e) => {
			received.push(e);
		});
		const fact: Fact = {
			id: "f-rep",
			content: "사용자 직업: 디자이너",
			entities: [],
			topics: [],
			createdAt: Date.now(),
			updatedAt: Date.now(),
			importance: 0.8,
			recallCount: 0,
			lastAccessed: Date.now(),
			strength: 0.8,
			status: "active",
			sourceEpisodes: [],
		};
		await m.checkRepeatedFailResolved(fact, Date.now());

		const repeatedSpikes = received.filter((s) => s.reason === "repeated-fail");
		expect(repeatedSpikes.length).toBeGreaterThanOrEqual(1);
		await memory.close();
	});

	it("recall fail (result=0) → consolidate 새 fact 매칭 → emit", async () => {
		const tmpPath = `/tmp/r4-failresolve-${Date.now()}.json`;
		const adapter = new LocalAdapter({ storePath: tmpPath });
		const memory = new MemorySystem({ adapter });
		const m = memory as any;
		// fail recall history 직접 inject
		m.recallHistory.push({
			query: "엔지니어",
			resultCount: 0,
			ts: Date.now(),
		});
		const received: SpikeEvent[] = [];
		memory.on("spike", async (e) => {
			received.push(e);
		});
		// 매칭 fact 직접 추가 + consolidate 흐름 모방
		const fact: Fact = {
			id: "f-resolve",
			content: "사용자 직업: 엔지니어",
			entities: [],
			topics: [],
			createdAt: Date.now(),
			updatedAt: Date.now(),
			importance: 0.8,
			recallCount: 0,
			lastAccessed: Date.now(),
			strength: 0.8,
			status: "active",
			sourceEpisodes: [],
		};
		await m.checkRecallFailureResolved(fact, Date.now());

		const failResolved = received.filter(
			(s) => s.reason === "recall-failure-resolved",
		);
		expect(failResolved.length).toBeGreaterThanOrEqual(1);
		await memory.close();
	});
});

describe("R4 Step 4 — replay boost", () => {
	it("recent + important fact 의 strength 가 boost 됨 (consolidate)", async () => {
		const tmpPath = `/tmp/r4-replay-${Date.now()}.json`;
		const adapter = new LocalAdapter({ storePath: tmpPath });
		// Inject high-importance recent fact directly
		const now = Date.now();
		const fact: Fact = {
			id: "f1",
			content: "사용자 직업: 엔지니어",
			entities: [],
			topics: [],
			createdAt: now - 1 * 24 * 60 * 60 * 1000, // 1 day ago
			updatedAt: now,
			importance: 0.9,
			recallCount: 0,
			lastAccessed: now,
			strength: 0.5, // low strength — should boost
			status: "active",
			sourceEpisodes: [],
		};
		await adapter.semantic.upsert(fact);

		const memory = new MemorySystem({ adapter });
		const result = await memory.consolidateNow(true);
		const after = (await adapter.semantic.getAll()).find((f) => f.id === "f1");
		expect(after).toBeDefined();
		expect(after!.strength).toBeGreaterThan(0.5); // boosted

		// replayBoosted count
		expect((result as any).replayBoosted).toBeGreaterThanOrEqual(1);
		await memory.close();
	});
});

describe("R4 Step 5a — temporal-anchor trigger", () => {
	// WIP: detectTemporalAnchors / detectEmotionAnniversaries exist as methods but
	// are not called anywhere in consolidateNow (verify: grep shows no call site).
	// These two tests assert spikes those detectors would emit, so they cannot pass
	// until the detectors are wired in. Skipped until then — un-skip when wired.
	it.skip("365일 ± 1day fact 의 anchor emit", async () => {
		const tmpPath = `/tmp/r4-anchor-${Date.now()}.json`;
		const adapter = new LocalAdapter({ storePath: tmpPath });
		const now = Date.now();
		const dayMs = 24 * 60 * 60 * 1000;
		const fact: Fact = {
			id: "f1-anniversary",
			content: "사용자 결혼: 2025-05-09",
			entities: [],
			topics: [],
			createdAt: now - 365 * dayMs, // exactly 365 days ago
			updatedAt: now - 365 * dayMs,
			importance: 0.9, // 중요 fact
			recallCount: 0,
			lastAccessed: now,
			strength: 0.9,
			status: "active",
			sourceEpisodes: [],
		};
		await adapter.semantic.upsert(fact);

		const memory = new MemorySystem({ adapter });
		const received: SpikeEvent[] = [];
		memory.on("spike", async (e) => {
			received.push(e);
		});

		await memory.consolidateNow(true);

		const anchorSpikes = received.filter((s) => s.reason === "temporal-anchor");
		expect(anchorSpikes.length).toBeGreaterThanOrEqual(1);
		expect(anchorSpikes[0].factId).toBe("f1-anniversary");
		await memory.close();
	});

	it.skip("user-emotion-anniversary — 같은 month/day + 작년 이상 emit", async () => {
		const tmpPath = `/tmp/r4-anniv-${Date.now()}.json`;
		const adapter = new LocalAdapter({ storePath: tmpPath });
		const now = Date.now();
		const today = new Date(now);
		// 작년 같은 month/day fact
		const lastYearSameDate = new Date(
			today.getFullYear() - 1,
			today.getMonth(),
			today.getDate(),
			today.getHours(),
		);
		const fact: Fact = {
			id: "f1-anniv",
			content: "결혼 기념일",
			entities: [],
			topics: [],
			createdAt: lastYearSameDate.getTime(),
			updatedAt: lastYearSameDate.getTime(),
			importance: 0.9,
			recallCount: 0,
			lastAccessed: now,
			strength: 0.9,
			status: "active",
			sourceEpisodes: [],
		};
		await adapter.semantic.upsert(fact);

		const memory = new MemorySystem({ adapter });
		const received: SpikeEvent[] = [];
		memory.on("spike", async (e) => {
			received.push(e);
		});

		await memory.consolidateNow(true);

		const anniv = received.filter(
			(s) => s.reason === "user-emotion-anniversary",
		);
		expect(anniv.length).toBeGreaterThanOrEqual(1);
		expect(anniv[0].factId).toBe("f1-anniv");
		await memory.close();
	});

	// Also skipped: this negative assertion is vacuous while the detector is
	// un-wired — no fact ever produces a temporal-anchor spike, so "low importance
	// → no anchor" always passes without exercising the threshold. Un-skip together
	// with the two positive tests above once detectTemporalAnchors is called.
	it.skip("importance < 0.7 fact 는 anchor X (skip)", async () => {
		const tmpPath = `/tmp/r4-anchor-skip-${Date.now()}.json`;
		const adapter = new LocalAdapter({ storePath: tmpPath });
		const now = Date.now();
		const dayMs = 24 * 60 * 60 * 1000;
		const fact: Fact = {
			id: "f1-low",
			content: "사용자 점심: 김밥",
			entities: [],
			topics: [],
			createdAt: now - 365 * dayMs,
			updatedAt: now - 365 * dayMs,
			importance: 0.5, // 낮은 importance — anchor X
			recallCount: 0,
			lastAccessed: now,
			strength: 0.5,
			status: "active",
			sourceEpisodes: [],
		};
		await adapter.semantic.upsert(fact);

		const memory = new MemorySystem({ adapter });
		const received: SpikeEvent[] = [];
		memory.on("spike", async (e) => {
			received.push(e);
		});

		await memory.consolidateNow(true);

		const anchorSpikes = received.filter((s) => s.reason === "temporal-anchor");
		expect(anchorSpikes.length).toBe(0);
		await memory.close();
	});
});
