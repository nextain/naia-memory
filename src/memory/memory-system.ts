import type { Episode, Fact, RecallContext } from "./types.js";
import { MemorySystemCompaction } from "./memory-system-compaction.js";

export class MemorySystem extends MemorySystemCompaction {

	// ─── R4 #26 Background brain — spike + active context ──────────────

	/** Subscribe spike events. naia-agent 가 source-monitor + pragmatic-gate
	 *  로 처리 후 SpikeAction 반환 (또는 skip).
	 *  R4 Step 2 — emit infrastructure. 실 emit 은 Step 3 (consolidate
	 *  / R2.5 supersede / decay 시점) 에서 trigger 예정. */
	on(
		event: "spike",
		handler: (e: import("./spike.js").SpikeEvent) => Promise<
			import("./spike.js").SpikeAction | void
		>,
	): void {
		if (event === "spike") this.spikeHandlers.push(handler);
	}

	off(
		event: "spike",
		handler: (e: import("./spike.js").SpikeEvent) => Promise<
			import("./spike.js").SpikeAction | void
		>,
	): void {
		if (event === "spike") {
			const idx = this.spikeHandlers.indexOf(handler);
			if (idx >= 0) this.spikeHandlers.splice(idx, 1);
		}
	}

	/** Push active context — naia-agent 가 *현재 대화 context* 명시.
	 *  Background brain 의 spike rule 평가 시 사용. cross-project leak
	 *  방지 (anchor §A10) — scope.project 필수. */
	setActiveContext(ctx: import("./spike.js").ActiveContext): void {
		this.activeContext = ctx;
	}

	/** Read current active context (debug / introspection). */
	getActiveContext(): import("./spike.js").ActiveContext | null {
		return this.activeContext;
	}

	/** Internal — emit spike to all subscribers. R4 Step 3 — supersede /
	 *  high-importance-relevant trigger 에서 호출. */
	protected async emitSpike(
		event: import("./spike.js").SpikeEvent,
	): Promise<void> {
		// R4 Step 3 — optOutTopics 검사 (cross-project / privacy 차단).
		if (this.activeContext?.optOutTopics?.length) {
			const optOut = this.activeContext.optOutTopics;
			const lower = event.content.toLowerCase();
			if (optOut.some((t) => lower.includes(t.toLowerCase()))) {
				return; // skip
			}
		}
		// Cross-project leak 차단 (anchor §A10): scope.project 가 active
		// context project 와 다르면 skip.
		if (
			this.activeContext &&
			event.scope?.project &&
			event.scope.project !== this.activeContext.scope.project
		) {
			return;
		}
		// R4 측정 framework — emit count 기록 (handler 미등록도 count).
		try {
			const { recordSpike } = await import("./usage-tracker.js");
			recordSpike(event.reason);
		} catch {}
		for (const handler of this.spikeHandlers) {
			try {
				await handler(event);
			} catch (e: any) {
				console.warn(`[MemorySystem] spike handler failed: ${e?.message}`);
			}
		}
	}

	/** R4 Step 5c — User-emotion-anniversary spike detection.
	 *  Consolidate cycle 마다 *high importance + 같은 month/day* fact 매칭
	 *  시 emit. 학계 정합 (anchor §7): emotion-modulated memory (LeDoux 1996,
	 *  amygdala) + DMN 의 *anniversary effect*.
	 *
	 *  temporal-anchor 와 차이:
	 *  - temporal-anchor: 365 ± 1 day (1년 전 정확)
	 *  - user-emotion-anniversary: month/day 매칭 (연도 무관, 매년)
	 */
	protected async detectEmotionAnniversaries(now: number): Promise<void> {
		try {
			const today = new Date(now);
			const todayMonth = today.getMonth();
			const todayDay = today.getDate();
			const allFacts = await this.adapter.semantic.getAll();
			for (const fact of allFacts) {
				if (fact.status !== "active") continue;
				if (fact.importance < 0.8) continue; // high importance only
				const factDate = new Date(fact.createdAt);
				if (
					factDate.getMonth() === todayMonth &&
					factDate.getDate() === todayDay &&
					factDate.getFullYear() < today.getFullYear() // 작년 이상
				) {
					await this.emitSpike({
						factId: fact.id,
						content: fact.content,
						reason: "user-emotion-anniversary",
						confidence: fact.importance,
						relatedFactIds: [],
						emittedAt: now,
						scope: fact.encodingContext?.project
							? { project: fact.encodingContext.project }
							: undefined,
					});
				}
			}
		} catch (e: any) {
			console.warn(`[MemorySystem] anniversary scan failed: ${e?.message}`);
		}
	}

	/** R4 Step 5a — Temporal-anchor spike detection.
	 *  Consolidate cycle 마다 fact 의 createdAt 이 *N 일 전 같은 날짜* 인지
	 *  확인 (1년 / 6개월 / 3개월 / 1개월). 매칭 시 emit.
	 *  학계 정합 (anchor §7): DMN 의 spontaneous reorganization — 시간
	 *  anchor 에 의한 연관 fact 떠올림. */
	protected async detectTemporalAnchors(now: number): Promise<void> {
		try {
			const allFacts = await this.adapter.semantic.getAll();
			const ANCHORS = [365, 180, 90, 30]; // days
			const TOL = 1; // ±1 day
			const dayMs = 24 * 60 * 60 * 1000;
			for (const fact of allFacts) {
				if (fact.status !== "active") continue;
				if (fact.importance < 0.7) continue; // 중요 fact 만 anchor
				const ageDays = Math.round((now - fact.createdAt) / dayMs);
				const matched = ANCHORS.find((a) => Math.abs(ageDays - a) <= TOL);
				if (matched) {
					await this.emitSpike({
						factId: fact.id,
						content: fact.content,
						reason: "temporal-anchor",
						confidence: fact.importance,
						relatedFactIds: [],
						emittedAt: now,
						scope: fact.encodingContext?.project
							? { project: fact.encodingContext.project }
							: undefined,
					});
				}
			}
		} catch (e: any) {
			console.warn(`[MemorySystem] temporal-anchor scan failed: ${e?.message}`);
		}
	}

	/** R4 Step 4 — fact 가 active context 매칭 (replay boost 시 사용). */
	protected matchesActiveContextFact(fact: Fact): boolean {
		return this.matchesActiveContext(fact);
	}

	/** R4 Step 3b — fact 가 active context topic / recentFactIds / entity
	 *  와 매칭? heuristic — fact content/topics 가 active topic substring 매칭. */
	protected matchesActiveContext(fact: Fact): boolean {
		if (!this.activeContext) return false;
		const lower = fact.content.toLowerCase();
		// active topic substring 매칭
		for (const t of this.activeContext.topics) {
			if (lower.includes(t.toLowerCase())) return true;
		}
		// fact entity 가 active topic 매칭
		for (const e of fact.entities) {
			for (const t of this.activeContext.topics) {
				if (e.toLowerCase().includes(t.toLowerCase())) return true;
			}
		}
		return false;
	}

	/** R4 #220 — Register or update a life epoch. */
	async upsertEpoch(epoch: import("./types.js").Epoch): Promise<void> {
	        if ("upsertEpoch" in this.adapter) {
	                await (this.adapter as any).upsertEpoch(epoch);
	        }
	}

	/** R4 #220 — Get all defined life epochs. */
	async getEpochs(): Promise<import("./types.js").Epoch[]> {
	        if ("getEpochs" in this.adapter) {
	                return (this.adapter as any).getEpochs();
	        }
	        return [];
	}

	// ─── Lifecycle ────────────────────────────────────────────────────────

	/** R2.5 v2 — Bi-temporal recall: memories valid at T. */
	async recallWithHistory(
	        query: string,
	        atTimestamp: number,
	        opts: RecallContext = {},
	): Promise<{ facts: Fact[]; episodes: Episode[] }> {
	        return this.recall(query, { ...opts, mode: "at-time", atTimestamp });
	}

	/** Run a decay cycle. Returns number of facts archived/weakened. */
	async applyDecay(): Promise<number> {
	        return this.adapter.semantic.decay(Date.now());
	}

	/** Force adapter writes to stable storage before an external outbox is acknowledged. */
	async flush(): Promise<void> {
		await this.adapter.flush?.();
	}

	async close(): Promise<void> {		this.stopConsolidation();
		this.spikeHandlers = [];
		this.activeContext = null;
		this.recallHistory = [];
		await this.adapter.close();
	}
}
