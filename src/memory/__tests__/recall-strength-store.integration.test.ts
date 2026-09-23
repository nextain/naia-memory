import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LocalAdapter } from "../adapters/local.js";
import { calculateStrength } from "../decay.js";
import type { EmbeddingProvider } from "../embeddings.js";
import type { Episode } from "../types.js";

const FIXTURE = process.env.NAIA_MEM51_FIXTURE;
// Folder with store.copy.json (a copy of a real naia-settings memory store),
// query-vectors.json (the 45 nextain/naia-shell#693 Korean queries embedded with
// Xenova/multilingual-e5-large q8 on CPU) and queries.json (the labelled query set).
// Not committed: it contains user data.
const ready =
	Boolean(FIXTURE) &&
	["store.copy.json", "query-vectors.json", "queries.json"].every((f) =>
		existsSync(join(FIXTURE!, f)),
	);
if (!ready) {
	console.warn(
		"[#51] NAIA_MEM51_FIXTURE not set or incomplete — real-store replay skipped",
	);
}

interface QueryVectorFile {
	model?: string;
	dtype?: string;
	device?: string;
	revision?: string;
	prefix?: string;
	dims: number;
	vectors: Record<string, number[]>;
}

interface QueryItem {
	id: string;
	text: string;
	category?: string;
	memRelevant?: string[];
	memNeutral?: string[];
}

interface QueriesFile {
	queries: QueryItem[];
}

function matchesSubstrings(text: string, substrings: string[]): boolean {
	if (!text || substrings.length === 0) return false;
	const lower = text.toLowerCase();
	return substrings.some((sub) => lower.includes(sub));
}

describe.skipIf(!ready)("recall on a real store copy (#51)", { timeout: 180_000 }, () => {
	it("3-round replay preserves high relevance and bounds repetition", async () => {
		const tempStorePath = join(tmpdir(), `naia-mem51-real-${randomUUID()}.json`);
		copyFileSync(join(FIXTURE!, "store.copy.json"), tempStorePath);

		const rawStore = readFileSync(tempStorePath, "utf-8");
		const parsedStore = JSON.parse(rawStore) as {
			embeddingSpaceId?: string;
			episodes: Episode[];
		};
		const embeddingSpaceId =
			parsedStore.embeddingSpaceId ?? "xenova/multilingual-e5-large-q8";

		const queryVectors: QueryVectorFile = JSON.parse(
			readFileSync(join(FIXTURE!, "query-vectors.json"), "utf-8"),
		);
		const queriesData: QueriesFile = JSON.parse(
			readFileSync(join(FIXTURE!, "queries.json"), "utf-8"),
		);

		const stubEmbedder: EmbeddingProvider = {
			dims: queryVectors.dims ?? 1024,
			name: "stub-real-store-query-embedder",
			embeddingSpaceId,
			async embed(text: string): Promise<number[]> {
				const vec = queryVectors.vectors[text];
				if (!vec) throw new Error(`Query text missing in vectors: ${text}`);
				return vec;
			},
			async embedBatch(): Promise<number[][]> {
				throw new Error("documents must not be re-embedded");
			},
		};

		const adapter = new LocalAdapter({
			storePath: tempStorePath,
			embeddingProvider: stubEmbedder,
			reindexEmbeddingsOnMismatch: false,
		});

		try {
			// Find project with the most episodes
			const projectCounts = new Map<string, number>();
			for (const ep of parsedStore.episodes) {
				const proj = ep.encodingContext?.project;
				if (proj) projectCounts.set(proj, (projectCounts.get(proj) ?? 0) + 1);
			}
			let maxCount = -1;
			let targetProject = "";
			for (const [proj, count] of projectCounts) {
				if (count > maxCount) {
					maxCount = count;
					targetProject = proj;
				}
			}

			// Predecessor map in timestamp order over all store episodes
			const sortedEpisodes = [...parsedStore.episodes].sort(
				(a, b) => a.timestamp - b.timestamp,
			);
			const prevMap = new Map<string, Episode>();
			for (let i = 1; i < sortedEpisodes.length; i++) {
				prevMap.set(sortedEpisodes[i].id, sortedEpisodes[i - 1]);
			}

			const isRel = (ep: Episode, relSubs: string[]) => {
				if (matchesSubstrings(ep.content, relSubs)) return true;
				if (ep.role === "assistant") {
					const prev = prevMap.get(ep.id);
					if (prev && prev.role === "user" && matchesSubstrings(prev.content, relSubs)) {
						return true;
					}
				}
				return false;
			};

			const isNeu = (ep: Episode, neuSubs: string[]) => {
				if (matchesSubstrings(ep.content, neuSubs)) return true;
				if (ep.role === "assistant") {
					const prev = prevMap.get(ep.id);
					if (prev && prev.role === "user" && matchesSubstrings(prev.content, neuSubs)) {
						return true;
					}
				}
				return false;
			};

			const projectEpisodes = parsedStore.episodes.filter(
				(ep) => ep.encodingContext?.project === targetProject,
			);

			// Identify labelled queries: non-empty memRelevant and at least one rel episode in target project
			const labelledQueries = queriesData.queries.filter((q) => {
				const relSubs = (q.memRelevant ?? []).map((s) => s.toLowerCase());
				if (relSubs.length === 0) return false;
				return projectEpisodes.some((ep) => isRel(ep, relSubs));
			});

			interface RoundStats {
				relInTop5: number;
				relAtRank1: number;
				irrelevantCount: number;
				distinctIds: number;
			}

			const roundResults: RoundStats[] = [];

			for (let round = 1; round <= 3; round++) {
				let relInTop5 = 0;
				let relAtRank1 = 0;
				let irrelevantCount = 0;
				const distinctIdSet = new Set<string>();

				for (const q of queriesData.queries) {
					const relSubs = (q.memRelevant ?? []).map((s) => s.toLowerCase());
					const neuSubs = (q.memNeutral ?? []).map((s) => s.toLowerCase());
					const isLabelled = labelledQueries.some((lq) => lq.id === q.id);

					const recalled = await adapter.episode.recall(q.text, {
						topK: 5,
						project: targetProject,
						scopeMode: "strict",
					});

					for (const ep of recalled) {
						distinctIdSet.add(ep.id);
					}

					let foundRelInTop5 = false;
					recalled.forEach((ep, idx) => {
						if (isRel(ep, relSubs)) {
							foundRelInTop5 = true;
							if (idx === 0 && isLabelled) {
								relAtRank1++;
							}
						} else if (!isNeu(ep, neuSubs)) {
							irrelevantCount++;
						}
					});

					if (isLabelled && foundRelInTop5) {
						relInTop5++;
					}
				}

				roundResults.push({
					relInTop5,
					relAtRank1,
					irrelevantCount,
					distinctIds: distinctIdSet.size,
				});
			}

			// Assertions on Round 1 and Round 3
			for (const r of [roundResults[0], roundResults[2]]) {
				expect(r.relInTop5).toBeGreaterThanOrEqual(16);
				expect(r.relAtRank1).toBeGreaterThanOrEqual(12);
				expect(r.irrelevantCount).toBeLessThanOrEqual(160);
				expect(r.distinctIds).toBeGreaterThanOrEqual(120);
			}
		} finally {
			await adapter.close();
			await rm(tempStorePath, { force: true });
		}
	});

	it("strength gate is gone on real data (decayed Busan memory recalled)", async () => {
		const tempStorePath = join(tmpdir(), `naia-mem51-busan-${randomUUID()}.json`);
		copyFileSync(join(FIXTURE!, "store.copy.json"), tempStorePath);

		const rawStore = readFileSync(tempStorePath, "utf-8");
		const parsedStore = JSON.parse(rawStore) as {
			embeddingSpaceId?: string;
			episodes: Episode[];
		};
		const embeddingSpaceId =
			parsedStore.embeddingSpaceId ?? "xenova/multilingual-e5-large-q8";

		const queryVectors: QueryVectorFile = JSON.parse(
			readFileSync(join(FIXTURE!, "query-vectors.json"), "utf-8"),
		);
		const queriesData: QueriesFile = JSON.parse(
			readFileSync(join(FIXTURE!, "queries.json"), "utf-8"),
		);

		const stubEmbedder: EmbeddingProvider = {
			dims: queryVectors.dims ?? 1024,
			name: "stub-real-store-query-embedder",
			embeddingSpaceId,
			async embed(text: string): Promise<number[]> {
				const vec = queryVectors.vectors[text];
				if (!vec) throw new Error(`Query text missing in vectors: ${text}`);
				return vec;
			},
			async embedBatch(): Promise<number[][]> {
				throw new Error("documents must not be re-embedded");
			},
		};

		const adapter = new LocalAdapter({
			storePath: tempStorePath,
			embeddingProvider: stubEmbedder,
			reindexEmbeddingsOnMismatch: false,
		});

		try {
			const projectCounts = new Map<string, number>();
			for (const ep of parsedStore.episodes) {
				const proj = ep.encodingContext?.project;
				if (proj) projectCounts.set(proj, (projectCounts.get(proj) ?? 0) + 1);
			}
			let maxCount = -1;
			let targetProject = "";
			for (const [proj, count] of projectCounts) {
				if (count > maxCount) {
					maxCount = count;
					targetProject = proj;
				}
			}

			const queryA1 = queriesData.queries.find((q) => q.id === "A1");
			const queryText = queryA1?.text ?? "내 고향이 어디라고 했지?";

			const recalled = await adapter.episode.recall(queryText, {
				topK: 5,
				project: targetProject,
				scopeMode: "strict",
				touch: false,
			});

			const now = Date.now();
			const busanEp = recalled.find((ep) => ep.content.includes("부산"));
			expect(busanEp).toBeDefined();

			const strength = calculateStrength(
				busanEp!.importance.utility,
				busanEp!.timestamp,
				busanEp!.recallCount,
				busanEp!.lastAccessed,
				now,
			);
			expect(strength).toBeLessThan(0.05);
		} finally {
			await adapter.close();
			await rm(tempStorePath, { force: true });
		}
	});
});
