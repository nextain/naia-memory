import type { EncodingContext, MemoryInput } from "./types.js";
import { truncateForRecap, type RollingSummary, type RollingSummarySnapshot } from "./compaction-helpers.js";
import { MemorySystemConsolidation } from "./memory-system-consolidation.js";

/** Rolling-summary state and persistence hooks for MemorySystem. */
export abstract class MemorySystemRolling extends MemorySystemConsolidation {
	protected updateRollingSummary(input: MemoryInput, context: EncodingContext): void {
		const sessionId = context.sessionId;
		if (!sessionId) return;
		let rs = this.rollingSummaries.get(sessionId);
		if (!rs) {
			rs = { sessionId, started: Date.now(), updated: Date.now(), recent: [], compressed: "", userCount: 0, assistantCount: 0, toolCount: 0, topics: new Map<string, number>(), firstUser: undefined };
			this.rollingSummaries.set(sessionId, rs);
		}
		if (input.role === "user") {
			rs.userCount++;
			if (!rs.firstUser) rs.firstUser = truncateForRecap(input.content, 120);
		} else if (input.role === "assistant") rs.assistantCount++;
		else if (input.role === "tool") rs.toolCount++;

		for (const match of input.content.matchAll(/\b[\p{Lu}\p{Lo}][\p{L}\p{N}_-]{2,}\b/gu)) {
			const topic = match[0];
			if (rs.topics.has(topic)) rs.topics.delete(topic);
			rs.topics.set(topic, Date.now());
			while (rs.topics.size > this.rollingTopicCap) {
				const iter = rs.topics.keys().next();
				if (iter.done) break;
				rs.topics.delete(iter.value);
			}
		}

		rs.recent.push({ role: input.role, content: input.content, timestamp: input.timestamp ?? Date.now() });
		if (rs.recent.length > this.rollingHeadroom) {
			const evicted = rs.recent.splice(0, rs.recent.length - this.rollingHeadroom);
			if (evicted.length > 0) {
				if (rs.evictedCount === undefined) rs.evictedCount = 0;
				if (rs.evictedFirst === undefined) rs.evictedFirst = truncateForRecap(evicted[0].content, 80);
				rs.evictedCount += evicted.length;
				rs.compressed = `${rs.evictedCount} earlier message(s) compacted; oldest: "${rs.evictedFirst}"`;
				if (rs.compressed.length > this.rollingCompressedMax) {
					const overflow = rs.compressed.length - this.rollingCompressedMax;
					rs.compressed = `[…earlier stem truncated…]\n${rs.compressed.slice(overflow)}`;
				}
			}
		}
		rs.updated = Date.now();
	}

	snapshotRollingSummaries(): RollingSummarySnapshot[] {
		return Array.from(this.rollingSummaries.values()).map((rs) => ({
			sessionId: rs.sessionId, started: rs.started, updated: rs.updated, recent: [...rs.recent], compressed: rs.compressed,
			userCount: rs.userCount, assistantCount: rs.assistantCount, toolCount: rs.toolCount, topics: Array.from(rs.topics.keys()),
			...(rs.firstUser !== undefined ? { firstUser: rs.firstUser } : {}),
		}));
	}

	clearRollingSummary(sessionId: string): void {
		this.rollingSummaries.delete(sessionId);
	}

	loadRollingSummaries(snapshots: readonly RollingSummarySnapshot[]): void {
		for (const s of snapshots) {
			const topics = new Map<string, number>();
			for (const topic of s.topics) topics.set(topic, s.updated);
			const rs: RollingSummary = { sessionId: s.sessionId, started: s.started, updated: s.updated, recent: [...s.recent], compressed: s.compressed, userCount: s.userCount, assistantCount: s.assistantCount, toolCount: s.toolCount, topics };
			if (s.firstUser !== undefined) rs.firstUser = s.firstUser;
			this.rollingSummaries.set(s.sessionId, rs);
		}
	}
}
