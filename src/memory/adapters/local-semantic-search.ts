/**
 * Local semantic search pipeline.
 *
 * Ranking is deliberately separated from JSON persistence so changes to
 * retrieval can be evaluated without changing LocalAdapter storage behavior.
 */

import { calculateStrength } from "../decay.js";
import type { EmbeddingProvider } from "../embeddings.js";
import type { KnowledgeGraph } from "../knowledge-graph.js";
import type { Epoch, Fact, MemoryAdapter } from "../types.js";
import { sameStructuredIdentity } from "../structured-facts.js";
import { BM25, cosineSimilarity, tokenize } from "./local-search.js";

export type SemanticSearchContext = Parameters<MemoryAdapter["semantic"]["search"]>[3];

export interface LocalSemanticSearchHost {
	readonly facts: Fact[];
	readonly factEmbeddings: Record<string, number[]> | undefined;
	readonly embedder: EmbeddingProvider | null;
	readonly disableKGSpreading: boolean;
	readonly kg: KnowledgeGraph;
	readonly reranker: import("../reranker.js").RerankerProvider | null;
	embedWithCache(text: string): Promise<number[] | null>;
	factsInTimeRange(start: number, end: number | null): Fact[];
	factsValidAtTime(timestamp: number): Fact[];
	getEpochs(): Epoch[];
	markDirty(): void;
	save(): void;
}

export async function searchLocalSemanticMemory(
	host: LocalSemanticSearchHost,
	query: string,
	topK: number,
	deepRecall = false,
	context?: SemanticSearchContext,
): Promise<Fact[]> {
			const now = Date.now();
		        const BROAD_FACTOR = 3;
			const searchMode = process.env.NAIA_SEARCH_MODE ?? (host.embedder && host.embedder.dims >= 2000 ? "vector-only" : "rrf");
			if (!["rrf", "vector-only", "bm25-only", "vector-head-rrf-tail"].includes(searchMode)) {
				throw new Error(`unsupported NAIA_SEARCH_MODE: ${searchMode}`);
			}
			if (searchMode === "vector-head-rrf-tail") {
				const queryIntent = (context as { queryIntent?: unknown } | undefined)?.queryIntent;
				if (
					!deepRecall ||
					host.reranker !== null ||
					process.env.NAIA_MMR !== "off" ||
					(context?.minConfidence ?? 0) !== 0 ||
					queryIntent !== undefined ||
					(context?.mode ?? "latest") !== "latest"
				) {
					throw new Error(
						"vector-head-rrf-tail requires deepRecall, no reranker, NAIA_MMR=off, minConfidence=0, no queryIntent, and mode=latest",
					);
				}
			}

			// #27 HyDE — caller 가 queryHint 주면 그것으로 embedding (가상 답 →
			// fact form 정합). 미설정 시 query 그대로.
			const embedTarget = context?.queryHint ?? query;
			const queryVec = searchMode === "bm25-only"
				? null
				: await host.embedWithCache(embedTarget);

			const queryTokens = tokenize(query);
			const structuredQuery = context?.structuredQuery;
			// Phase B-γ toggle: skip spreading activation entirely when disabled
			// so ranking falls back to vector cosine + BM25 only. The graph
			// itself is preserved (touchNode/strengthen still run on upsert)
			// — only this lookup-side propagation is bypassed.
			const activatedEntities = host.disableKGSpreading
				? []
				: host.kg.spreadingActivation(queryTokens, 2, 0.5);
			const activationMap = new Map<string, number>();
			for (const { entity, activation } of activatedEntities) {
				activationMap.set(entity, activation);
			}

			const broadK = topK * BROAD_FACTOR;
			const RRF_K = 60;
			const useBM25 = searchMode !== "vector-only";

			const proj = context?.project;
			let atT = context?.atTimestamp;
			const epochAnchor = (context as any)?.epochAnchor;
			let epochRange: { start: number; end: number | null } | null = null;

			// R4 #220 — Resolve epoch anchor to range or timestamp
			if (epochAnchor && atT === undefined) {
			        const epochs = host.getEpochs();
			        const matched = epochs.find(e =>
			                e.name.toLowerCase().includes(epochAnchor.toLowerCase()) ||
			                (e.description && e.description.toLowerCase().includes(epochAnchor.toLowerCase()))
			        );
			        if (matched) {
			                epochRange = { start: matched.start, end: matched.end };
			        }
			}

			// R2.5 v2 fix #1: mode='at-time' requires atTimestamp (either explicit or resolved via epoch).
			if (context?.mode === "at-time" && atT === undefined && !epochRange) {
			        throw new Error(
			                "semantic.search: mode='at-time' requires `atTimestamp` or a valid `epochAnchor` to be set",
			        );
			}

			const scopeMode = (context as any)?.scopeMode ?? "soft";                    const crossProject = (context as any)?.crossProject ?? false;

			let baseFacts: Fact[];
			if (epochRange) {
			        baseFacts = host.factsInTimeRange(epochRange.start, epochRange.end);
			} else if (atT !== undefined) {
			        baseFacts = host.factsValidAtTime(atT);
			} else {
			        baseFacts = host.facts;
			}

			let allFacts: Fact[];
			if (scopeMode === "strict" && !crossProject) {
			        if (proj) {
			                // Topics are content metadata, not an authorization boundary.
			                // Strict scope requires an explicit exact project assignment.
			                allFacts = baseFacts.filter(
			                        (f) => f.encodingContext?.project === proj,
			                );
			        } else {
			                // strict + no project: cross-project leak 방지 → project 없는 fact 만
			                allFacts = baseFacts.filter((f) => !f.encodingContext?.project);
			        }
			} else if (crossProject) {
			        // explicit cross-project recall: no filtering
			        allFacts = baseFacts;
			} else {
			        // soft mode (legacy default).
			        allFacts = proj
			                ? baseFacts.filter(
			                                (f) =>
			                                        f.encodingContext?.project === proj ||
			                                        (f.topics?.includes(proj) ?? false),
			                        )
			                : baseFacts;
			}

			// Apply the latest-view lifecycle contract before candidate truncation.
			// Otherwise superseded/archived rows can occupy all broadK slots and
			// disappear only after slicing, starving lower-ranked active facts.
			const mode = context?.mode ?? "latest";
			const includeSuperseded = mode === "history" || deepRecall || epochRange !== null;
			if (!includeSuperseded && atT === undefined) {
				allFacts = allFacts.filter((fact) => (fact.status ?? "active") === "active");
			}

			const vectorScores: Map<string, number> = new Map();
			const bm25Scores: Map<string, number> = new Map();
			const entityBonuses: Map<string, number> = new Map();

			let bm25Instance: BM25 | null = null;
			if (useBM25) {
			        bm25Instance = new BM25();
			        const docMap = new Map<string, string>();
			        for (const f of allFacts) {
			                docMap.set(f.id, [f.content, ...f.entities, ...f.topics].join(" "));
			        }
			        bm25Instance.index(docMap);
			}

			for (const fact of allFacts) {
			        const factVec = host.factEmbeddings?.[fact.id];
			        const vs = factVec && queryVec ? cosineSimilarity(queryVec, factVec) : 0;
			        vectorScores.set(fact.id, vs);

			        if (bm25Instance) {
			                const bs = bm25Instance.score(query, fact.id);
			                bm25Scores.set(fact.id, bs);
			        }

			        let eb = 0;
			        for (const qt of queryTokens) {
			                if (fact.entities.some((e) => e.toLowerCase().includes(qt))) {
			                        eb += 0.3;
			                }
			        }
			        // R4 #220 — KG spreading activation bonus.
			        for (const ent of fact.entities) {
			                const act = activationMap.get(ent.toLowerCase());
			                if (act && act > 0.01) {
			                        eb += act * 2.0;
			                }
			        }
			        entityBonuses.set(fact.id, eb);			        }

			        const byVector = [...allFacts].sort((a, b) => (vectorScores.get(b.id) ?? 0) - (vectorScores.get(a.id) ?? 0));
			        const vectorRank = new Map<string, number>();
			        for (let i = 0; i < byVector.length; i++) vectorRank.set(byVector[i].id, i + 1);

			        let bm25Rank: Map<string, number> | null = null;
			        if (useBM25) {
			        const byBM25 = [...allFacts].sort((a, b) => (bm25Scores.get(b.id) ?? 0) - (bm25Scores.get(a.id) ?? 0));
			        bm25Rank = new Map<string, number>();
			        for (let i = 0; i < byBM25.length; i++) bm25Rank.set(byBM25[i].id, i + 1);
			        }

				const rrfScore = (factId: string) =>
					1 / (RRF_K + (vectorRank.get(factId) ?? allFacts.length)) +
					1 / (RRF_K + (bm25Rank?.get(factId) ?? allFacts.length));
				let compositeRank: Map<string, number> | null = null;
				if (searchMode === "vector-head-rrf-tail") {
					const protectedHead = byVector.slice(0, Math.min(10, topK));
					const byRrf = [...allFacts].sort(
						(a, b) => rrfScore(b.id) - rrfScore(a.id),
					);
					const ordered: Fact[] = [];
					const included = new Set<string>();
					for (const fact of [...protectedHead, ...byRrf, ...byVector]) {
						if (included.has(fact.id)) continue;
						included.add(fact.id);
						ordered.push(fact);
					}
					compositeRank = new Map(ordered.map((fact, index) => [fact.id, index + 1]));
				}

			        const candidates = allFacts
			        .map((fact) => {
			                const vs = vectorScores.get(fact.id) ?? 0;
			                const bs = bm25Scores.get(fact.id) ?? 0;
			                const eb = entityBonuses.get(fact.id) ?? 0;

			                // Flashbulb = strong emotional AROUSAL in EITHER valence (grief flashbulbs too),
			                // not positive valence only. arousal = |valence-0.5|*2; threshold 0.6 is the
			                // symmetric form of the previous positive-only 0.8 valence cut (|v-0.5|>=0.3),
			                // so positive behavior is unchanged and strong-negative reactions now qualify.
			                // Default 0.5 (neutral, arousal 0) when maxEmotion absent — NOT 0 (which would
			                // read as max-negative and false-flashbulb an emotionless memory).
			                const isFlashbulb = Math.abs((fact.maxEmotion ?? 0.5) - 0.5) * 2 >= 0.6;
			                const relevanceThreshold = epochRange ? 0.0 : 0.12;

			                const isRelevant = vs >= relevanceThreshold || bs > 0 || eb > 0 || isFlashbulb;

			                if (!isRelevant && !deepRecall) return null;					let relevanceScore: number;
					if (searchMode === "vector-head-rrf-tail") {
						relevanceScore =
							1 / (compositeRank?.get(fact.id) ?? allFacts.length + 1);
					} else if (searchMode === "vector-only") {
				        relevanceScore = vs + eb;
					} else if (searchMode === "bm25-only") {
						relevanceScore =
							1 / (RRF_K + (bm25Rank?.get(fact.id) ?? allFacts.length)) + eb;
					} else {
					        // RRF fusion of the vector + BM25 rank streams. The
					        // entity/KG bonus (eb) MUST also be added here — it is a
					        // strong exact-match / spreading-activation signal and was
					        // previously dropped in RRF mode (only used by vector-only),
					        // so exact entity matches got no credit and RRF ranked below
					        // raw vector similarity. eb lives on the raw score scale
					        // (0.3 per exact entity match) which intentionally dominates
					        // the compressed RRF base (~1/RRF_K) for confident matches.
					        relevanceScore =
					                1 / (RRF_K + (vectorRank.get(fact.id) ?? allFacts.length)) +
					                1 / (RRF_K + (bm25Rank!.get(fact.id) ?? allFacts.length)) +
					                eb;
					}
					if (
						searchMode !== "vector-head-rrf-tail" &&
						structuredQuery &&
						fact.structured &&
						sameStructuredIdentity(structuredQuery, fact.structured)
					)
						relevanceScore += 1;

					// Apply boost to Flashbulb memories to ensure they survive slice(0, broadK)
					if (isFlashbulb && searchMode !== "vector-head-rrf-tail")
						relevanceScore += 0.5;

					return { fact, relevanceScore, vectorScore: vs };
					})				.filter((x): x is NonNullable<typeof x> => x !== null)
				.sort((a, b) => b.relevanceScore - a.relevanceScore)
				.slice(0, broadK);

			// Stage 2: Re-rank with importance/strength only among candidates
			let scored = candidates
				.map(({ fact, relevanceScore, vectorScore }) => {
					const strength = calculateStrength(
						fact.importance,
						fact.createdAt,
						fact.recallCount,
						fact.lastAccessed,
						now,
					);

					const finalScore = deepRecall
						? relevanceScore
						: relevanceScore * 0.7 + strength * 0.3;

					return { fact, score: finalScore, strength, vectorScore };
				})
				.filter((x) => x.score > 0)
				.sort((a, b) => b.score - a.score);

			// R2.5 v2 mode handling. backward compat:
			//  - deepRecall=true 그대로 superseded 포함 (기존 동작)
			//  - mode='latest' (default): only status === 'active' (archived
			//    fact 도 hide — adversarial review fix #2)
			//  - mode='history': superseded 도 포함 — chain 회상
			//  - mode='at-time': atT 가 set 된 path (이미 위 factsValidAtTime 처리)
			if (!includeSuperseded && atT === undefined) {
			        if (deepRecall) {
			                // deepRecall + latest mode: 기존 동작 — superseded 만 제외 (loose).
			                scored = scored.filter((f) => f.fact.status !== "superseded");
			        } else {
			                // latest 명시 mode: status === 'active' 만 (strict, archived 제외).
			                scored = scored.filter((f) => (f.fact.status ?? "active") === "active");
			        }
			}
			// #27 confidence threshold — preservation-first 의 짝.
			// score 가 minConfidence 미만인 fact 는 제외. 사용자 directive
			// A09 + mem0 "97.8% junk" 회피.
			//
			// Adversarial review fix: deepRecall=true 시 cutoff 를 0.5배
			// — "오래된 기억 회상" 의도와 충돌 방지. deepRecall 자체가 이미
			// strict mode (decay 무시) 라 추가 strict 는 over-filter.
			let minConfidence = context?.minConfidence ?? 0;
			if (deepRecall && minConfidence > 0) minConfidence *= 0.5;
			if (minConfidence > 0) {
				scored = scored.filter((f) => f.score >= minConfidence);
			}

			// R5 #28 Part 2 — Intent penalty: query 의 intent category 와 fact
			// 의 category 가 mismatch 시 score 감소 (×0.7). irrelevant_isolation
			// 효과 — \"업무 query\" 시 \"개인 fact\" 노출 줄임.
			const queryIntent = (context as any)?.queryIntent;
			if (queryIntent) {
				for (const s of scored) {
					const factCategory = s.fact.encodingContext?.category;
					if (factCategory && factCategory !== queryIntent) {
						s.score *= 0.7;
					}
				}
				scored.sort((a, b) => b.score - a.score);
			}

			// #27 Step 3 — Cross-encoder reranker (caller-injected, optional).
			// final ranking 후 (cosine + BM25 + KG + threshold 모두 적용 후)
			// query-fact relevance 재평가. 진짜 ranking 강화.
			if (host.reranker && scored.length > 0) {
				const reranked = await host.reranker.rerank(
					query,
					scored.map((s) => ({ ...s, content: s.fact.content })),
					Math.min(scored.length, topK * 2),
				);
				const orderMap = new Map(reranked.map((r, i) => [r.fact.id, i]));
				scored.sort((a, b) => {
					const ra = orderMap.get(a.fact.id) ?? scored.length;
					const rb = orderMap.get(b.fact.id) ?? scored.length;
					return ra - rb;
				});
				scored = scored.slice(0, topK * 2); // reranker 가 본 candidate set
			}

			// #27 MMR (Maximal Marginal Relevance) — top-K 의 *유사 fact 중복*
			// 줄임. 같은 attribute key 또는 매우 유사한 content 의 fact 가
			// top-K 에 모두 들어가는 것 방지. λ=0.7 (relevance 우선, diversity
			// 30%).
			const useMMR = process.env.NAIA_MMR !== "off";
			if (useMMR && scored.length > topK) {
				const lambda = 0.7;
				const selected: typeof scored = [];
				const remaining = [...scored];
				while (selected.length < topK && remaining.length > 0) {
					let bestIdx = 0;
					let bestScore = -Infinity;
					for (let i = 0; i < remaining.length; i++) {
						const cand = remaining[i];
						let maxSim = 0;
						for (const s of selected) {
							// Use attribute-key prefix as cheap diversity signal.
							const candKey = cand.fact.content.split(":")[0]?.trim() ?? "";
							const selKey = s.fact.content.split(":")[0]?.trim() ?? "";
							if (candKey && candKey === selKey) maxSim = Math.max(maxSim, 0.8);
						}
						const mmrScore = lambda * cand.score - (1 - lambda) * maxSim;
						if (mmrScore > bestScore) {
							bestScore = mmrScore;
							bestIdx = i;
						}
					}
					selected.push(remaining[bestIdx]);
					remaining.splice(bestIdx, 1);
				}
				scored = selected;
			} else {
				scored = scored.slice(0, topK);
			}

			// History recall is about an attribute's change chain, not merely a
			// wider semantic candidate pool. Once a relevant anchor is ranked,
			// keep its predecessor/successor facts adjacent so callers can observe
			// the actual transition. `allFacts` is already project-scoped above,
			// therefore following these links cannot bypass strict scope filtering.
			if (mode === "history" && scored.length > 0) {
				const scopedById = new Map(allFacts.map((fact) => [fact.id, fact]));
				const rankedById = new Map(scored.map((entry) => [entry.fact.id, entry]));
				const expanded: typeof scored = [];
				const included = new Set<string>();

				const append = (fact: Fact, fallbackScore = 0) => {
					if (included.has(fact.id) || expanded.length >= topK) return;
					included.add(fact.id);
					expanded.push(
						rankedById.get(fact.id) ?? {
							fact,
							score: fallbackScore,
							strength: fact.strength,
							vectorScore: 0,
						},
					);
				};

				// Preserve every semantically ranked anchor. Linked rows only use
				// spare capacity and never inherit an anchor's relevance score.
				for (const anchor of scored) append(anchor.fact, anchor.score);
				for (const anchor of [...scored]) {

					let predecessorId = anchor.fact.supersedes;
					while (predecessorId && expanded.length < topK) {
						const predecessor = scopedById.get(predecessorId);
						if (!predecessor || included.has(predecessor.id)) break;
						append(predecessor);
						predecessorId = predecessor.supersedes;
					}

					let successorId = anchor.fact.successorId;
					while (successorId && expanded.length < topK) {
						const successor = scopedById.get(successorId);
						if (!successor || included.has(successor.id)) break;
						append(successor);
						successorId = successor.successorId;
					}
				}
				scored = expanded;
			}

			// Update recall counts
			for (const { fact } of scored) {
			        fact.recallCount++;
			        fact.lastAccessed = now;
			        fact.strength = calculateStrength(
			                fact.importance,
			                fact.createdAt,
			                fact.recallCount,
			                fact.lastAccessed,
			                now,
			        );
			}

			if (epochRange) {
			    console.log(`[LocalAdapter] Final scored count for epoch: ${scored.length}`);
			}

			if (scored.length > 0) {
			        host.markDirty();
			        host.save();
			}

			return scored.map((s) => {
			        s.fact.relevanceScore = s.score;
			        return s.fact;
				});
}
