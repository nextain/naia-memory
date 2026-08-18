import crypto from "node:crypto";
import {
	MAX_EPISODES_PER_CYCLE,
	contentTokens,
	jaccardSimilarity,
} from "./consolidation-primitives.js";
import type { MemorySystemOptions } from "./memory-system-api.js";
import { MemorySystemBackup } from "./memory-system-backup.js";
import { filterNegativeCapture } from "./negative-capture.js";
import { findContradictionsWith } from "./reconsolidation.js";
import {
	findStructuredDeletionTargets,
	findStructuredSupersessions,
	sameStructuredFact,
} from "./structured-facts.js";
import type { ConsolidationResult, Fact } from "./types.js";

/** Sleep-cycle consolidation and adapter backup operations. */
export abstract class MemorySystemConsolidation extends MemorySystemBackup {
	private consolidationTimer: ReturnType<typeof setInterval> | null = null;
	private readonly consolidationIntervalMs: number;

	constructor(options: MemorySystemOptions) {
		super(options);
		this.consolidationIntervalMs =
			options.consolidationIntervalMs ?? 30 * 60 * 1000;
	}
	/**
	 * Start the background consolidation timer.
	 * Runs periodically during idle time, like sleep-cycle memory consolidation.
	 *
	 * Neuroscience basis: during slow-wave sleep, the hippocampus replays
	 * recent experiences and transfers patterns to the neocortex.
	 */
	startConsolidation(): void {
		if (this.consolidationTimer) return;
		this.consolidationTimer = setInterval(async () => {
			try {
				await this.consolidateNow();
			} catch (err) {
				// Non-critical — log and continue
				console.error("[MemorySystem] consolidation error:", err);
			}
		}, this.consolidationIntervalMs);
	}

	/** Stop the consolidation timer */
	stopConsolidation(): void {
		if (this.consolidationTimer) {
			clearInterval(this.consolidationTimer);
			this.consolidationTimer = null;
		}
	}

	/**
	 * Run a full consolidation cycle on demand.
	 *
	 * Pipeline:
	 * 1. Extract facts from unconsolidated episodes (hippocampal replay)
	 * 2. Check extracted facts against existing facts (reconsolidation)
	 * 3. Upsert new/updated facts into semantic memory
	 * 4. Mark processed episodes as consolidated
	 * 5. Run adapter-level decay + association cleanup
	 */
	async consolidateNow(force = false): Promise<ConsolidationResult> {
		if (this._isConsolidating) {
			return {
				episodesProcessed: 0,
				factsCreated: 0,
				factsUpdated: 0,
				memoriesPruned: 0,
				associationsUpdated: 0,
			};
		}
		this._isConsolidating = true;

		try {
			const now = Date.now();
			let factsCreated = 0;
			let factsUpdated = 0;

			// 1. Get unconsolidated episodes
			// LocalAdapter returns insertion order (oldest-first); slice preserves that order.
			const unconsolidated = await this.adapter.episode.getUnconsolidated();
			const readyEpisodes = unconsolidated
				.filter((ep) => force || now - ep.timestamp > 5 * 60 * 1000) // 5 min age gate (skip if forced)
				.slice(0, MAX_EPISODES_PER_CYCLE); // Cap batch size — oldest first

			if (readyEpisodes.length > 0) {
				// 2. Extract facts from episodes
				const extractedRaw = await this.factExtractor(readyEpisodes);
				// negative-capture (hermes-derived): drop transient/env-dependent "facts" that would
				// harden into durable self-imposed constraints (e.g. "tool X is broken"). Deterministic
				// backstop to the LLM extractor's prompt-level policy (negative-capture.ts). Single
				// chokepoint here covers both the heuristic and the LLM extractor.
				const { kept: extracted, dropped: negDropped } =
					filterNegativeCapture(extractedRaw);
				if (negDropped.length > 0 && process.env.NAIA_FILTER_DEBUG === "1") {
					console.error(
						`[NEG_CAPTURE] dropped ${negDropped.length} fact(s): ${negDropped.map((d) => d.reason).join(", ")}`,
					);
				}

				// Dedup entity-pair associations across the entire cycle (not just per-fact)
				const seenPairs = new Set<string>();

				// 3. For each extracted fact, check contradictions and upsert
				for (const ef of extracted) {
					const srcEp = readyEpisodes.find((e) =>
						ef.sourceEpisodeIds.includes(e.id),
					);
					const efProject = srcEp?.encodingContext?.project;
					// Search for semantically similar facts instead of getAll() — O(topK) not O(N).
					// R2.5 (#20): deepRecall=true so the isRelevant threshold
					// (`vs>=0.12 || bs>0 || eb>=0.2`) does NOT prune candidates here. For
					// contradiction detection we want broad recall — even loosely related
					// facts must reach the LLM filter so it can decide.
					const existingFacts = ef.structured
						? (await this.adapter.semantic.getAll()).filter(
								// Supersession mutates the predecessor.  Unlike soft recall, it
								// must never let an unscoped write update a project-scoped fact.
								(fact) => fact.encodingContext?.project === efProject,
							)
						: await this.adapter.semantic.search(
								ef.content,
								10,
								true,
								efProject ? { project: efProject } : undefined,
							);
					if (process.env.NAIA_FILTER_DEBUG === "1") {
						const totalFacts =
							(this.adapter as any).getStore?.()?.facts?.length ?? "?";
						console.error(
							`[FILTER_DEBUG] search("${ef.content.slice(0, 40)}", topK=10, deepRecall=true, proj=${efProject ?? "—"}) → ${existingFacts.length} hits | store total facts: ${totalFacts}`,
						);
					}

					if (ef.operation === "delete") {
						const targets = ef.structured
							? findStructuredDeletionTargets(existingFacts, ef.structured)
							: [];
						for (const target of targets) {
							await this.adapter.semantic.upsert({
								...target,
								status: "archived",
								updatedAt: now,
								validTo: now,
							});
							factsUpdated++;
						}
						continue;
					}

					// Check for exact/near identity to prevent semantic redundancy (#4)
					const duplicate = ef.structured
						? existingFacts.find(
								(fact) =>
									!!fact.structured &&
									sameStructuredFact(fact.structured, ef.structured!),
							)
						: existingFacts.find((f) => {
								const sim = jaccardSimilarity(
									contentTokens(f.content),
									contentTokens(ef.content),
								);
								return sim > 0.85; // High similarity threshold for identity
							});

					if (duplicate) {
						// Near-duplicate found — update metadata but don't create new entry
						const newImportance = Math.max(
							duplicate.importance,
							ef.importance,
							0.7,
						);
						const newMaxEmotion = Math.max(
							duplicate.maxEmotion ?? 0,
							ef.maxEmotion ?? 0,
						);
						await this.adapter.semantic.upsert({
							...duplicate,
							updatedAt: now,
							lastAccessed: now, // Strengthening on reactivation
							importance: newImportance,
							maxEmotion: newMaxEmotion,
							strength: newImportance,
							sourceEpisodes: [
								...new Set([
									...duplicate.sourceEpisodes,
									...ef.sourceEpisodeIds,
								]),
							],
						});
						factsUpdated++;
						continue;
					}

					const structuredSupersessions = ef.structured
						? findStructuredSupersessions(existingFacts, ef.structured)
						: [];
					const contradictions = ef.structured
						? structuredSupersessions.map((fact) => ({
								fact,
								result: {
									action: "update" as const,
									updatedContent: ef.content,
								},
							}))
						: await findContradictionsWith(
								existingFacts,
								ef.content,
								this.contradictionFilter,
							);

					if (contradictions.length > 0) {
						// Update ALL contradicted facts to prevent stale contradictory data
						// (Partial resolution bug #4 fixed).
						// R2.5 v2: chain + bi-temporal validity (보존 우선).
						for (const { fact, result } of contradictions) {
							if (result.action === "update" && result.updatedContent) {
								const newImportance = Math.max(
									fact.importance,
									ef.importance,
									0.7,
								);
								const newMaxEmotion = Math.max(
									fact.maxEmotion ?? 0,
									ef.maxEmotion ?? 0,
								);
								const successorId = `${fact.id}-v${Date.now()}`;
								await this.adapter.semantic.upsert({
									...fact,
									status: "superseded",
									updatedAt: now,
									validTo: now,
									successorId,
								});
								await this.adapter.semantic.upsert({
									...fact,
									id: successorId,
									content: result.updatedContent,
									status: "active",
									createdAt: now,
									updatedAt: now,
									lastAccessed: now,
									importance: newImportance,
									maxEmotion: newMaxEmotion,
									strength: newImportance,
									sourceEpisodes: [
										...new Set([
											...fact.sourceEpisodes,
											...ef.sourceEpisodeIds,
										]),
									],
									entities: ef.entities,
									topics: ef.topics,
									structured: ef.structured ?? fact.structured,
									encodingContext:
										fact.encodingContext ?? srcEp?.encodingContext,
									supersedes: fact.id,
									validFrom: now,
									validTo: null,
								}); // R4 #26 Step 3a — supersede 시점 spike emit
								// (consolidate path).
								await this.emitSpike({
									factId: successorId,
									content: result.updatedContent,
									reason: "contradiction",
									confidence: 0.9,
									relatedFactIds: [fact.id],
									emittedAt: now,
									scope: fact.encodingContext?.project
										? { project: fact.encodingContext.project }
										: undefined,
								});
								factsUpdated++;
							}
						}
					} else {
						// New fact — create with deterministic UUID for idempotency
						// Prevents duplicates if consolidation is interrupted and re-run.
						// Format: 32 SHA-256 hex chars arranged as UUID (8-4-4-4-12) — accepted by both
						// LocalAdapter (string key) and QdrantAdapter (requires UUID format).
						const hashHex = crypto
							.createHash("sha256")
							.update(ef.content + ef.sourceEpisodeIds.sort().join(","))
							.digest("hex")
							.slice(0, 32);
						const deterministicId = `${hashHex.slice(0, 8)}-${hashHex.slice(8, 12)}-${hashHex.slice(12, 16)}-${hashHex.slice(16, 20)}-${hashHex.slice(20, 32)}`;

						const newImportance = Math.max(ef.importance, 0.7);
						const newFact: Fact = {
							id: deterministicId,
							content: ef.content,
							entities: ef.entities,
							topics: ef.topics,
							createdAt: now,
							updatedAt: now,
							importance: newImportance,
							maxEmotion: ef.maxEmotion,
							recallCount: 0,
							lastAccessed: now,
							strength: newImportance,
							status: "active",
							sourceEpisodes: ef.sourceEpisodeIds,
							encodingContext: srcEp?.encodingContext,
							structured: ef.structured,
						};
						await this.adapter.semantic.upsert(newFact);
						factsCreated++;
						// R4 #26 Step 3b — high-importance + active context relevant
						// 시점 spike emit. naia-agent 가 active context push 했고,
						// 새 fact 가 active topic 또는 entity 매칭 + importance ≥ 0.8.
						if (
							this.activeContext &&
							newImportance >= 0.8 &&
							this.matchesActiveContext(newFact)
						) {
							await this.emitSpike({
								factId: deterministicId,
								content: ef.content,
								reason: "high-importance-relevant",
								confidence: newImportance,
								relatedFactIds: [],
								emittedAt: now,
								scope: srcEp?.encodingContext?.project
									? { project: srcEp.encodingContext.project }
									: undefined,
							});
						}
						// R4 Step 3c — recall-failure-resolved 검사.
						await this.checkRecallFailureResolved(newFact, now);
						// R4 Step 3d — repeated-fail 검사 (자동 emit).
						await this.checkRepeatedFailResolved(newFact, now);
					}

					// Strengthen associations between extracted entities (cycle-level dedup)
					for (let i = 0; i < ef.entities.length; i++) {
						for (let j = i + 1; j < ef.entities.length; j++) {
							const a = ef.entities[i].toLowerCase();
							const b = ef.entities[j].toLowerCase();
							const pairKey = a < b ? `${a}|${b}` : `${b}|${a}`;
							if (seenPairs.has(pairKey)) continue;
							seenPairs.add(pairKey);
							await this.adapter.semantic.associate(a, b, 0.05);
						}
					}
				}

				// 4. Mark episodes as consolidated
				await this.adapter.episode.markConsolidated(
					readyEpisodes.map((ep) => ep.id),
				);
			}

			// 5. Run adapter-level decay + cleanup
			const adapterResult = await this.adapter.consolidate();

			// 6. R4 #220 Step 3 — Semantic Consolidation (Insight Distillation)
			//    Distill clusters of facts into high-level insights.
			const insightsCreated = await this.distillInsights(now);

			// R4 Step 5a/5c — Background-brain 시간 스파이크(시간 anchor + 기념일).
			//    detectTemporalAnchors/detectEmotionAnniversaries 는 구현돼 있었으나
			//    consolidate 사이클에 한 번도 연결되지 않아 spike 가 안 났음 → 배선.
			await this.detectTemporalAnchors(now);
			await this.detectEmotionAnniversaries(now);

			// 7. R4 #26 Step 4 — Replay-worthy fact strength boost.
			//    학계 정합 (anchor §7): Sharp-wave ripples + CLS — 자다가
			//    *recent + important + recently-recalled* fact 의 strength
			//    를 강화 (replay). decay 의 반대 동작.
			//
			// 기준:
			//  - createdAt < 14일 이내 (recent)
			//  - importance >= 0.7 (high)
			//  - 또는 lastAccessed < 7일 이내 (recent recall)
			//  - active context topic 매칭 시 추가 boost
			const sevenDays = 7 * 24 * 60 * 60 * 1000;
			const fourteenDays = 14 * 24 * 60 * 60 * 1000;
			let replayBoosted = 0;
			try {
				const allFacts = await this.adapter.semantic.getAll();
				for (const fact of allFacts) {
					if (fact.status !== "active") continue;
					const isRecent = now - fact.createdAt < fourteenDays;
					const isImportant = fact.importance >= 0.7;
					const recentRecall = now - fact.lastAccessed < sevenDays;
					if (!(isRecent && isImportant) && !recentRecall) continue;
					// boost = +5% strength, capped 1.0
					const boost = this.matchesActiveContextFact(fact) ? 0.1 : 0.05;
					fact.strength = Math.min(1.0, fact.strength + boost);
					await this.adapter.semantic.upsert(fact);
					replayBoosted++;
				}
			} catch (e: any) {
				console.warn(`[MemorySystem] replay boost failed: ${e?.message}`);
			}
			// 측정 framework — replay 갯수 기록.
			try {
				const { recordReplayBoost } = await import("./usage-tracker.js");
				recordReplayBoost(replayBoosted);
			} catch {}

			return {
				episodesProcessed: readyEpisodes.length,
				factsCreated,
				factsUpdated,
				insightsCreated,
				memoriesPruned: adapterResult.memoriesPruned,
				associationsUpdated: adapterResult.associationsUpdated,
				// R4 Step 4 — replay boost count (informational, not part of legacy
				// ConsolidationResult contract; type-assert to extend).
				...({ replayBoosted } as any),
			};
		} finally {
			this._isConsolidating = false;
		}
	}

	/**
	 * R4 #220 Step 3 — Semantic Consolidation (The Power of Forgetting).
	 *
	 * Distills clusters of related facts into high-level semantic insights.
	 * Prunes/archives the raw facts that have been fully consolidated to mirror
	 * human memory abstraction.
	 */
	private async distillInsights(now: number): Promise<number> {
		let insightsCreated = 0;
		try {
			// Get all active facts that are not already insights
			const allFacts = await this.adapter.semantic.getAll();
			const activeFacts = allFacts.filter(
				(f) =>
					f.status === "active" &&
					!(f.topics?.includes("system:insight") ?? false),
			);

			// Use KnowledgeGraph hubs to identify candidates for distillation
			// This mirrors how the brain prioritizes highly-connected concepts for abstraction.
			const hubs =
				"getHubs" in this.adapter
					? await (this.adapter as any).getHubs()
					: "getStore" in this.adapter
						? ((this.adapter as any).getStore().knowledgeGraph?.nodes ?? {})
						: {};
			const hubNames = Object.keys(hubs).sort(
				(a, b) => (hubs[b].frequency ?? 0) - (hubs[a].frequency ?? 0),
			);

			for (const hubName of hubNames.slice(0, 10)) {
				const related = activeFacts.filter((f) =>
					f.entities.some((e) => e.toLowerCase() === hubName.toLowerCase()),
				);

				// Threshold for distillation: 3+ related facts about a hub entity
				if (related.length >= 3) {
					// R4 #220 — Genuine insight distillation.
					// Summarize the core themes of the related facts.
					const themes = [
						...new Set(related.flatMap((f) => f.topics ?? [])),
					].join(", ");
					const distilledContent = `Consolidated Insight on '${hubName}': Observed consistent patterns regarding ${themes}. Key observations include: ${related.map((f) => f.content).join("; ")}`;

					const hashHex = crypto
						.createHash("sha256")
						.update(
							"insight:" +
								hubName +
								related
									.map((f) => f.id)
									.sort()
									.join(","),
						)
						.digest("hex")
						.slice(0, 32);
					const deterministicId = `insight-${hashHex.slice(0, 8)}-${hashHex.slice(8, 12)}-${hashHex.slice(12, 16)}-${hashHex.slice(16, 20)}-${hashHex.slice(20, 32)}`;

					const insightFact: Fact = {
						id: deterministicId,
						content: distilledContent,
						entities: [hubName],
						topics: [
							"system:insight",
							...new Set(related.flatMap((f) => f.topics ?? [])),
						],
						createdAt: now,
						updatedAt: now,
						importance: 0.95, // Insights are highly important
						maxEmotion: Math.max(...related.map((f) => f.maxEmotion ?? 0), 0.5),
						recallCount: 0,
						lastAccessed: now,
						strength: 1.0, // Fresh insights start at full strength
						status: "active",
						sourceEpisodes: [
							...new Set(related.flatMap((f) => f.sourceEpisodes)),
						],
						encodingContext: { category: "insight" },
					};

					await this.adapter.semantic.upsert(insightFact);
					insightsCreated++;

					// "The Power of Forgetting": Archive source facts to prioritize the insight.
					// This reduces noise in standard retrieval.
					for (const f of related) {
						f.status = "archived";
						f.strength *= 0.5; // Weaken for Ebbinghaus decay sweep
						await this.adapter.semantic.upsert(f);
					}
				}
			}
		} catch (e: any) {
			console.warn(`[MemorySystem] insight distillation failed: ${e?.message}`);
		}
		return insightsCreated;
	}
}
