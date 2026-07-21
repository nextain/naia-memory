/**
 * Mem0Adapter — mem0 OSS-backed MemoryAdapter implementation.
 *
 * Uses mem0ai/oss as the vector search/storage backend.
 * Existing neuroscience modules (decay, importance, knowledge-graph)
 * remain as layers on top — mem0 replaces keyword matching, not the architecture.
 *
 * Architecture decision (2026-03-26 design session):
 * - mem0 handles: embedding, vector storage, LLM-based fact extraction, semantic search
 * - Naia keeps: decay curves, importance gating, knowledge graph, reconsolidation logic
 *
 * Privacy: All mem0 operations run locally (OSS mode).
 * No user data leaves the device.
 */

import { randomUUID } from "node:crypto";
import { calculateStrength, shouldPrune } from "../decay.js";
import {
	type KGState,
	KnowledgeGraph,
	emptyKGState,
} from "../knowledge-graph.js";
import type {
	ConsolidationResult,
	Episode,
	Fact,
	MemoryAdapter,
	RecallContext,
	Reflection,
	Skill,
} from "../types.js";

// mem0 types (imported dynamically to avoid bundling issues)
type Mem0Memory = any; // Will be import("mem0ai/oss").Memory

export interface Mem0AdapterOptions {
	/** mem0 OSS configuration */
	mem0Config: {
		embedder: { provider: string; config: Record<string, any> };
		vectorStore: { provider: string; config: Record<string, any> };
		llm: { provider: string; config: Record<string, any> };
		historyDbPath?: string;
	};
	/** User ID for mem0 scoping */
	userId?: string;
	/** Phase B-γ A/B measurement toggle — when true, the knowledge-graph
	 *  spreading-activation step is skipped during episode/fact recall so
	 *  ranking falls back to mem0's vector cosine only.
	 *  Default false. The KG itself is preserved (touchNode/strengthen
	 *  remain reachable); only the lookup-side propagation is bypassed. */
	disableKGSpreading?: boolean;
	/** Test/runtime injection for a preconfigured local Mem0 client. */
	memoryFactory?: () => Mem0Memory | Promise<Mem0Memory>;
}

/**
 * Adapter that wraps mem0 as the vector search backend while preserving
 * Naia's neuroscience-inspired memory modules on top.
 */
export class Mem0Adapter implements MemoryAdapter {
	private mem0: Mem0Memory | null = null;
	private initPromise: Promise<void> | null = null;
	private readonly config: Mem0AdapterOptions;
	private readonly userId: string;

	// Local stores for Naia-specific data that mem0 doesn't handle
	private episodes: Episode[] = [];
	private skills: Skill[] = [];
	private reflections: Reflection[] = [];
	private kg: KnowledgeGraph;
	private kgState: KGState;
	/** Phase B-γ A/B toggle — see Mem0AdapterOptions.disableKGSpreading. */
	private readonly disableKGSpreading: boolean;

	constructor(options: Mem0AdapterOptions) {
		this.config = options;
		this.userId = options.userId ?? "naia-user";
		this.kgState = emptyKGState();
		this.kg = new KnowledgeGraph(this.kgState);
		this.disableKGSpreading = options.disableKGSpreading ?? false;
	}

	private async ensureMem0(): Promise<Mem0Memory> {
		if (this.mem0) return this.mem0;
		if (this.initPromise) {
			await this.initPromise;
			return this.mem0!;
		}
		this.initPromise = this._initMem0();
		await this.initPromise;
		return this.mem0!;
	}

	private async _initMem0(): Promise<void> {
		if (this.config.memoryFactory) {
			this.mem0 = await this.config.memoryFactory();
			return;
		}
		const { Memory } = await import("mem0ai/oss");
		this.mem0 = new Memory(this.config.mem0Config);
	}

	// ─── Episodic Memory ─────────────────────────────────────────────────

	episode = {
		store: async (event: Episode): Promise<void> => {
			const existing = this.episodes.findIndex((episode) => episode.id === event.id);
			if (existing >= 0) return;

			// Also store in mem0 for vector search
			const m = await this.ensureMem0();
			const persisted = await m.getAll({ userId: this.userId });
			const persistedItems = persisted?.results ?? persisted ?? [];
			if (persistedItems.some((item: any) => item.metadata?.episodeId === event.id)) {
				this.episodes.push(event);
				return;
			}
			await m.add([{ role: "user", content: event.content }], {
				userId: this.userId,
				metadata: {
					type: "episode",
					episodeId: event.id,
					project: event.encodingContext.project,
					timestamp: event.timestamp,
				},
			});
			this.episodes.push(event);
		},

		recall: async (
			query: string,
			context: RecallContext,
		): Promise<Episode[]> => {
			const topK = context.topK ?? 5;

			// Use mem0 vector search instead of keyword matching
			const m = await this.ensureMem0();
			const results = await m.search(query, {
				userId: this.userId,
				limit: topK,
			});

			// Map mem0 results back to episodes
			const matchedEpisodes: Array<Episode & { _mem0Score: number }> = [];
			const resultItems = results?.results ?? results ?? [];

			for (const r of resultItems) {
				const memoryText = r.memory ?? r.text ?? r.content ?? "";
				const mem0Score: number = r.score ?? 0.5;
				// Find matching episode by content similarity
				const match = this.episodes.find(
					(ep) =>
						ep.content === memoryText ||
						memoryText.includes(ep.content.slice(0, 50)) ||
						ep.content.includes(memoryText.slice(0, 50)),
				);
				const now = Date.now();
				if (match) {
					match.recallCount++;
					match.lastAccessed = now;
					match.strength = calculateStrength(
						match.importance.utility,
						match.timestamp,
						match.recallCount,
						match.lastAccessed,
						now,
					);
					matchedEpisodes.push({ ...match, _mem0Score: mem0Score });
				} else {
					// mem0 returned a memory not in our episode list
					// (could be from a previous session). Create a synthetic episode.
					const createdAt = r.created_at
						? new Date(r.created_at).getTime()
						: now;
					const strength = calculateStrength(0.5, createdAt, 1, now, now);
					matchedEpisodes.push({
						id: r.id ?? randomUUID(),
						content: memoryText,
						summary: memoryText.slice(0, 200),
						timestamp: createdAt,
						importance: {
							importance: 0.5,
							surprise: 0,
							emotion: 0.5,
							utility: 0.5,
						},
						encodingContext: { project: r.metadata?.project },
						consolidated: true,
						recallCount: 1,
						lastAccessed: now,
						strength,
						_mem0Score: mem0Score,
					});
				}
			}

			// KG spreading activation for episode re-ranking.
			// Phase B-γ toggle: when disabled, leave `activated` empty so
			// the kg boost contribution to scoring is 0 (graph itself
			// preserved — propagation only is skipped).
			const queryTokens = query.split(/\s+/).filter((t) => t.length >= 2);
			const activated = new Map<string, number>();
			if (!this.disableKGSpreading) {
				try {
					const kgResults = this.kg.spreadingActivation(queryTokens);
					for (const { entity, activation } of kgResults) {
						activated.set(entity.toLowerCase(), activation);
					}
				} catch {}
			}

			// Sort by: relevance first, decay as tiebreaker
			// No filter — memories are never removed from search results.
			matchedEpisodes.sort((a, b) => {
				const aCtx =
					context.project && a.encodingContext.project === context.project
						? 0.3
						: 0;
				const bCtx =
					context.project && b.encodingContext.project === context.project
						? 0.3
						: 0;
				// KG boost from content token overlap with activated entities
				let aKg = 0;
				let bKg = 0;
				for (const [entity, act] of activated) {
					if (a.content.toLowerCase().includes(entity)) aKg += act * 0.1;
					if (b.content.toLowerCase().includes(entity)) bKg += act * 0.1;
				}
				// Relevance-first: cosine similarity base, strength/KG as bonus
				const aCosine = a._mem0Score;
				const bCosine = b._mem0Score;
				const aScore = aCosine * (1 + a.strength + aCtx + aKg);
				const bScore = bCosine * (1 + b.strength + bCtx + bKg);
				return bScore - aScore;
			});

			return matchedEpisodes.slice(0, topK).map(({ _mem0Score, ...ep }) => ep);
		},

		getRecent: async (n: number): Promise<Episode[]> => {
			return [...this.episodes]
				.sort((a, b) => b.timestamp - a.timestamp)
				.slice(0, n);
		},

		getUnconsolidated: async (): Promise<Episode[]> => {
			return this.episodes.filter((ep) => !ep.consolidated);
		},

		markConsolidated: async (ids: string[]): Promise<void> => {
			const idSet = new Set(ids);
			for (const ep of this.episodes) {
				if (idSet.has(ep.id)) ep.consolidated = true;
			}
		},
	};

	// ─── Semantic Memory ─────────────────────────────────────────────────

	semantic = {
		upsert: async (fact: Fact): Promise<void> => {
			// Store/update in mem0
			const m = await this.ensureMem0();
			try {
				await m.add([{ role: "user", content: fact.content }], {
					userId: this.userId,
					metadata: {
						type: "fact",
						factId: fact.id,
						entities: fact.entities,
						topics: fact.topics,
					},
				});
			} catch (err: any) {
				console.warn(
					`[Mem0Adapter] semantic.upsert internal error: ${err.message}`,
				);
			}
		},

		search: async (
			query: string,
			topK: number,
			deepRecall = false,
			context?: { project?: string; atTimestamp?: number },
		): Promise<Fact[]> => {
			// R2.3 — bi-temporal recall is not implemented in this adapter.
			// Refuse explicitly instead of silently returning current-time results.
			if (context?.atTimestamp !== undefined) {
				throw new Error(
					"Mem0Adapter does not support bi-temporal search (atTimestamp). Use LocalAdapter for recallWithHistory.",
				);
			}
			const m = await this.ensureMem0();
			const results = await m.search(query, {
				userId: this.userId,
				limit: topK,
			});

			const now = Date.now();
			const resultItems = results?.results ?? results ?? [];

			// KG spreading activation for re-ranking.
			// Phase B-γ toggle: when disabled, leave `activated` empty so
			// kgBoost evaluates to 0 below (graph itself preserved —
			// propagation only is skipped).
			const queryTokens = query.split(/\s+/).filter((t) => t.length >= 2);
			const activated = new Map<string, number>();
			if (!this.disableKGSpreading) {
				try {
					const kgResults = this.kg.spreadingActivation(queryTokens);
					for (const { entity, activation } of kgResults) {
						activated.set(entity.toLowerCase(), activation);
					}
				} catch {}
			}

			const facts: Array<Fact & { _score: number }> = resultItems.map(
				(r: any, idx: number) => {
					const createdAt = r.created_at
						? new Date(r.created_at).getTime()
						: now;
					const updatedAt = r.updated_at
						? new Date(r.updated_at).getTime()
						: now;
					const entities: string[] = r.metadata?.entities ?? [];

					// Decay-based strength
					const strength = calculateStrength(0.5, createdAt, 1, now, now);

					// KG activation bonus
					let kgBoost = 0;
					for (const entity of entities) {
						const act = activated.get(entity.toLowerCase());
						if (act) kgBoost += act;
					}

					// Scoring strategy:
					// - Normal mode: relevance × (1 + decay boost) — relevance first, decay adjusts
					// - Deep recall: pure vector similarity — ignore decay entirely
					const cosineScore = r.score ?? 1 - idx / resultItems.length;
					const _score = deepRecall
						? cosineScore
						: cosineScore * (1 + strength + kgBoost * 0.1);

					return {
						id: r.id ?? randomUUID(),
						content: r.memory ?? r.text ?? r.content ?? "",
						entities,
						topics: r.metadata?.topics ?? [],
						createdAt,
						updatedAt,
						importance: 0.5,
						recallCount: 1,
						lastAccessed: now,
						strength,
						sourceEpisodes: [],
						relevanceScore: r.score,
						_score,
					};
				},
			);

			// No filter — memories are never removed from search results.
			// Decay affects ranking only, not existence.
			// (LocalAdapter still filters for storage constraints.)
			return facts
				.sort((a, b) => b._score - a._score)
				.slice(0, topK)
				.map(({ _score, ...fact }) => fact);
		},

		decay: async (now: number): Promise<number> => {
			// Apply Ebbinghaus decay to episodes
			let pruned = 0;
			this.episodes = this.episodes.filter((ep) => {
				const strength = calculateStrength(
					ep.importance.utility,
					ep.timestamp,
					ep.recallCount,
					ep.lastAccessed,
					now,
				);
				ep.strength = strength;
				if (shouldPrune(strength) && ep.consolidated) {
					pruned++;
					return false;
				}
				return true;
			});
			return pruned;
		},

		associate: async (
			entityA: string,
			entityB: string,
			weight?: number,
		): Promise<void> => {
			this.kg.strengthen(entityA, entityB, weight, Date.now());
		},

		getAll: async (): Promise<Fact[]> => {
			const m = await this.ensureMem0();
			const results = await m.getAll({ userId: this.userId });
			const resultItems = results?.results ?? results ?? [];
			return resultItems.map((r: any) => ({
				id: r.id ?? randomUUID(),
				content: r.memory ?? r.text ?? r.content ?? "",
				entities: r.metadata?.entities ?? [],
				topics: r.metadata?.topics ?? [],
				createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
				updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : Date.now(),
				importance: 0.5,
				recallCount: 0,
				lastAccessed: Date.now(),
				strength: 0.5,
				status: "active" as const,
				sourceEpisodes: [],
			}));
		},

		delete: async (id: string): Promise<boolean> => {
			try {
				const m = await this.ensureMem0();
				await m.delete(id);
				return true;
			} catch {
				return false;
			}
		},
	};

	// ─── Procedural Memory ───────────────────────────────────────────────

	procedural = {
		getSkill: async (name: string): Promise<Skill | null> => {
			return this.skills.find((s) => s.name === name) ?? null;
		},

		recordOutcome: async (name: string, success: boolean): Promise<void> => {
			let skill = this.skills.find((s) => s.name === name);
			if (!skill) {
				skill = {
					id: randomUUID(),
					name,
					description: "",
					learnedAt: Date.now(),
					successCount: 0,
					failureCount: 0,
					confidence: 0,
				};
				this.skills.push(skill);
			}
			if (success) skill.successCount++;
			else skill.failureCount++;
			skill.confidence =
				skill.successCount / (skill.successCount + skill.failureCount);
		},

		learnFromFailure: async (reflection: Reflection): Promise<void> => {
			this.reflections.push(reflection);

			// Also store in mem0 for semantic retrieval
			const m = await this.ensureMem0();
			await m.add(
				[
					{
						role: "user",
						content: `Task: ${reflection.task}. Failure: ${reflection.failure}. Correction: ${reflection.correction}`,
					},
				],
				{
					userId: this.userId,
					metadata: { type: "reflection" },
				},
			);
		},

		getReflections: async (
			task: string,
			topK: number,
		): Promise<Reflection[]> => {
			// Search local reflections by keyword
			// Note: reflections stored via learnFromFailure are also in mem0,
			// but local search is sufficient for current session's reflections.
			// Cross-session reflection retrieval requires Mem0Adapter persistence (#189).
			const taskLower = task.toLowerCase();
			return this.reflections
				.filter(
					(r) =>
						r.task.toLowerCase().includes(taskLower) ||
						taskLower.includes(r.task.toLowerCase()),
				)
				.slice(0, topK);
		},
	};

	// ─── Consolidation ───────────────────────────────────────────────────

	/**
	 * Adapter-level consolidation: decay sweep + KG edge decay.
	 *
	 * Note: Episode → fact extraction is handled by MemorySystem.consolidateNow(),
	 * not here. Mem0Adapter's consolidate() only runs maintenance tasks.
	 * episodesProcessed/factsCreated are 0 because MemorySystem tracks those.
	 *
	 * Limitation: semantic.decay() only prunes local episodes, not mem0 vector
	 * store facts. mem0 facts persist indefinitely. This is intentional —
	 * fact pruning will be addressed with long-term memory separation.
	 */
	async consolidate(): Promise<ConsolidationResult> {
		const now = Date.now();

		// 1. Decay sweep (local episodes only; mem0 facts are not pruned)
		const memoriesPruned = await this.semantic.decay(now);

		// 2. Knowledge graph edge decay
		const associationsUpdated = this.kg.decayEdges(0.95, 0.01);

		return {
			episodesProcessed: 0,
			factsCreated: 0,
			factsUpdated: 0,
			memoriesPruned,
			associationsUpdated,
		};
	}

	async close(): Promise<void> {
		// mem0 OSS doesn't require explicit close
	}
}
