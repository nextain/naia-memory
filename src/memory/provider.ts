/**
 * NaiaMemoryProvider — MemoryProvider wrapper around MemorySystem.
 *
 * R1.3: Adapter layer that exposes MemoryProvider interface (provider-types.ts)
 * while delegating to the existing MemorySystem orchestrator.
 *
 * This is the public API surface for naia-memory consumers (naia-agent, naia-os).
 */

import {
	type ContradictionFilterProvider,
	HeuristicContradictionFilter,
	selectFilter,
} from "./contradiction-filter.js";
import { scoreImportance as scoreImportanceFn } from "./importance.js";
import { MemorySystem } from "./index.js";
import type { DeleteVerifier, FactExtractor } from "./index.js";
import type {
	BackupCapableProvider,
	CompactableCapableProvider,
	ImportanceScoringCapable,
	ReconsolidationCapableProvider,
	TemporalCapableProvider,
} from "./provider-types.js";
import type {
	ConsolidationSummary,
	MemoryHit,
	MemoryProvider,
	MemoryProviderInput,
	RecallOptions,
} from "./provider-types.js";
import { findContradictionsWith } from "./reconsolidation.js";
import type { MemoryAdapter } from "./types.js";

export interface NaiaMemoryProviderOptions {
	adapter: MemoryAdapter;
	factExtractor?: FactExtractor;
	/** Independent fail-closed authorization for destructive memory updates. */
	deleteVerifier?: DeleteVerifier;
	/** R2.5 — pluggable contradiction filter. Defaults to env-based selection
	 *  (Vllm > Gemini > Heuristic). */
	contradictionFilter?: ContradictionFilterProvider;
}

export class NaiaMemoryProvider
	implements
		MemoryProvider,
		BackupCapableProvider,
		ImportanceScoringCapable,
		ReconsolidationCapableProvider,
		TemporalCapableProvider,
		CompactableCapableProvider
{
	private system: MemorySystem;
	private contradictionFilter: ContradictionFilterProvider;

	constructor(opts: NaiaMemoryProviderOptions) {
		this.contradictionFilter =
			opts.contradictionFilter ??
			(typeof process !== "undefined" && process.env
				? selectFilter(process.env)
				: new HeuristicContradictionFilter());
		this.system = new MemorySystem({
			adapter: opts.adapter,
			factExtractor: opts.factExtractor,
			deleteVerifier: opts.deleteVerifier,
			contradictionFilter: this.contradictionFilter,
		});
	}

	async encode(
		input: MemoryProviderInput,
		opts?: { project?: string },
	): Promise<void> {
		await this.system.encode(
			{
				content: input.content,
				role: input.role,
				timestamp: input.timestamp,
				context: input.context,
				...(input.emotion !== undefined ? { emotion: input.emotion } : {}),
				...(input.importance !== undefined
					? { importance: input.importance }
					: {}),
			},
			{ project: opts?.project },
		);
	}

	async recall(query: string, opts?: RecallOptions): Promise<MemoryHit[]> {
		const result = await this.system.recall(query, {
			project: opts?.project,
			topK: opts?.topK ?? 50,
		});

		const hits: MemoryHit[] = [
			...result.facts.map((f) => ({
				id: f.id,
				content: f.content,
				score: f.relevanceScore ?? 0,
				createdAt: f.createdAt,
				updatedAt: f.updatedAt,
				metadata: {
					type: "fact" as const,
					entities: f.entities,
					topics: f.topics,
					importance: f.importance,
					// Emotional salience (0..1) — surfaced so a consumer/agent can
					// weigh contextual appropriateness, not just relevance. From the
					// first-class reaction signal (fact.maxEmotion).
					emotion: f.maxEmotion ?? 0,
					status: f.status,
				},
			})),
			...result.episodes.map((e) => ({
				id: e.id,
				content: e.content,
				score: 0.3,
				createdAt: e.timestamp,
				metadata: {
					type: "episode" as const,
					emotion: e.importance?.emotion ?? 0,
					consolidated: e.consolidated,
				},
			})),
		];

		hits.sort((a, b) => b.score - a.score);
		return hits;
	}

	async consolidate(): Promise<ConsolidationSummary> {
		const start = Date.now();
		const r = await this.system.consolidateNow(true);
		return {
			factsCreated: r.factsCreated,
			factsUpdated: r.factsUpdated,
			episodesProcessed: r.episodesProcessed,
			durationMs: Date.now() - start,
		};
	}

	async close(): Promise<void> {
		await this.system.close();
	}

	// ─── Capability: BackupCapable ────────────────────────────────────────────

	exportBackup(password: string): Promise<Uint8Array> {
		// biome-ignore lint/complexity/useLiteralKeys: bracket access intentionally reaches a protected integration seam.
		const adapter = this.system["adapter"];
		if (
			"exportBackup" in adapter &&
			typeof adapter.exportBackup === "function"
		) {
			return adapter.exportBackup(password);
		}
		throw new Error("BackupCapable not supported by current adapter");
	}

	importBackup(blob: Uint8Array, password: string): Promise<void> {
		// biome-ignore lint/complexity/useLiteralKeys: bracket access intentionally reaches a protected integration seam.
		const adapter = this.system["adapter"];
		if (
			"importBackup" in adapter &&
			typeof adapter.importBackup === "function"
		) {
			return adapter.importBackup(blob, password);
		}
		throw new Error("BackupCapable not supported by current adapter");
	}

	// ─── Capability: ImportanceScoring ────────────────────────────────────────

	scoreImportance(text: string): {
		importance: number;
		surprise: number;
		emotion: number;
		utility: number;
	} {
		return scoreImportanceFn({ content: text, role: "user" });
	}

	// ─── Capability: Reconsolidation ──────────────────────────────────────────

	async findContradictions(
		newContent: string,
		_existingIds?: string[],
	): Promise<
		{
			conflictingId: string;
			conflictType: "direct" | "indirect";
			reason: string;
		}[]
	> {
		const result = await this.system.recall(newContent, { topK: 10 });
		const contradictions = await findContradictionsWith(
			result.facts,
			newContent,
			this.contradictionFilter,
		);
		return contradictions.map(({ fact, result: r }) => ({
			conflictingId: fact.id,
			conflictType:
				r.action === "update" ? ("direct" as const) : ("indirect" as const),
			reason: r.reason,
		}));
	}

	// ─── Capability: Temporal ─────────────────────────────────────────────────

	async applyDecay(): Promise<number> {
		// biome-ignore lint/complexity/useLiteralKeys: bracket access intentionally reaches a protected integration seam.
		const adapter = this.system["adapter"] as MemoryAdapter;
		return adapter.semantic.decay(Date.now());
	}

	async recallWithHistory(
		query: string,
		atTimestamp: number,
		opts?: RecallOptions,
	): Promise<MemoryHit[]> {
		// biome-ignore lint/complexity/useLiteralKeys: bracket access intentionally reaches a protected integration seam.
		const adapter = this.system["adapter"] as MemoryAdapter;
		const facts = await adapter.semantic.search(query, opts?.topK ?? 50, true, {
			project: opts?.project,
			atTimestamp,
		});

		return facts.map((f) => ({
			id: f.id,
			content: f.content,
			score: f.relevanceScore ?? 0,
			createdAt: f.createdAt,
			updatedAt: f.updatedAt,
			metadata: {
				type: "fact" as const,
				status: f.status,
			},
		}));
	}

	// ─── Capability: Compactable ─────────────────────────────────────────────

	async compact(input: {
		messages: readonly { role: string; content: string; timestamp?: number }[];
		keepTail: number;
		targetTokens: number;
		sessionId?: string;
	}): Promise<{
		summary: { role: "assistant"; content: string; timestamp?: number };
		droppedCount: number;
		realtime?: boolean;
	}> {
		return this.system.compact(input);
	}
}

export type {
	MemoryProvider,
	MemoryProviderInput,
	MemoryHit,
	RecallOptions,
	ConsolidationSummary,
};
export type {
	BackupCapableProvider,
	ImportanceScoringCapable,
	ReconsolidationCapableProvider,
	TemporalCapableProvider,
} from "./provider-types.js";
export { isCapable } from "./provider-types.js";
