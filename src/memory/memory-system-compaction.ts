import {
	buildDeterministicRecap,
	buildRecapFromRollingSummary,
	buildStructuredSections,
} from "./compaction-helpers.js";
import { MemorySystemRolling } from "./memory-system-rolling.js";
import type { CompactionSummarizer } from "./compaction-helpers.js";

/** Conversation compaction and cross-session handoff operations. */
export abstract class MemorySystemCompaction extends MemorySystemRolling {
	async compact(input: {
		messages: readonly { role: string; content: string; timestamp?: number }[];
		keepTail: number;
		targetTokens: number;
		sessionId?: string;
		strategy?: string;
		priorRecap?: { role: string; content: string; timestamp?: number };
		/** Request-scoped override avoids sharing authorization across concurrent calls. */
		summarizer?: CompactionSummarizer;
	}): Promise<{
		summary: { role: "assistant"; content: string; timestamp?: number };
		droppedCount: number;
		realtime?: boolean;
	}> {
		const messages = input.messages;
		const rolling = input.sessionId
			? this.rollingSummaries.get(input.sessionId)
			: undefined;
		const baseRecap = rolling
			? buildRecapFromRollingSummary(rolling, messages.length, input.keepTail)
			: buildDeterministicRecap(messages, input.keepTail);
		const structured = buildStructuredSections(messages, input.priorRecap);
		const recap =
			structured.length > 0 ? `${baseRecap}\n\n${structured}` : baseRecap;
		let finalContent = recap;
		let realtime = rolling !== undefined;
		const summarizer = input.summarizer ?? this.summarizer;
		if (summarizer) {
			try {
				const polished = await summarizer({
					messages,
					keepTail: input.keepTail,
					targetTokens: input.targetTokens,
					...(input.sessionId !== undefined
						? { sessionId: input.sessionId }
						: {}),
					seedSummary: recap,
				});
				if (typeof polished === "string") {
					if (polished.trim().length > 0) finalContent = polished.trim();
				} else if (polished.content.trim().length > 0) {
					finalContent = polished.content.trim();
					if (polished.realtime === true) realtime = true;
				} else if (polished.realtime === true) {
					realtime = true;
				}
			} catch {
				console.warn("[MemorySystem] compaction summarizer failed, using existing recap");
			}
		}
		return {
			summary: {
				role: "assistant",
				content: finalContent,
				timestamp: Date.now(),
			},
			droppedCount: messages.length,
			realtime,
		};
	}

	async attachHandoff(blob: {
		readonly version: 1;
		readonly sessionId: string;
		readonly createdAt: number;
		readonly turnCount: number;
		readonly totalTokens: number;
		readonly trigger: string;
		readonly recap: { role: string; content: string; timestamp?: number };
		readonly anchors: readonly string[];
	}): Promise<void> {
		const context = { sessionId: `handoff:${blob.sessionId}` };
		await this.encode(
			{
				content: `[Handoff from session ${blob.sessionId} — ${blob.turnCount} turns, trigger=${blob.trigger}]\n${blob.recap.content}`,
				role: "assistant",
				timestamp: blob.createdAt,
			},
			context,
		);
		for (const anchor of blob.anchors) {
			// Handoff anchors are synthesized context, never fresh user authority.
			await this.encode(
				{
					content: `[Handoff anchor] ${anchor}`,
					role: "tool",
					timestamp: blob.createdAt,
				},
				context,
			);
		}
	}
}
