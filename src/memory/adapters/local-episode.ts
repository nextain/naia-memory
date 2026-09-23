import { calculateStrength, compareByRelevanceThenStrength } from "../decay.js";
import type { Episode, MemoryAdapter, RecallContext } from "../types.js";
import type { MemoryStore } from "./local-model.js";
import {
	compactKeywordScore,
	cosineSimilarity,
	keywordScore,
} from "./local-search.js";

interface LocalEpisodeHost {
	getStore(): MemoryStore;
	embedQuery(text: string): Promise<number[] | null>;
	embedDocument(text: string): Promise<number[] | null>;
	markDirty(): void;
	save(): void;
}

function isSyntheticSystemEcho(episode: Episode): boolean {
	return (
		episode.role === "assistant" &&
		episode.content.trimStart().startsWith("SYSTEM_ECHO:")
	);
}

export function createLocalEpisodeMemory(
	host: LocalEpisodeHost,
): MemoryAdapter["episode"] {
	const pendingWrites = new Map<string, Promise<void>>();
	const enqueueWrite = (id: string, operation: () => Promise<void>) => {
		const previous = pendingWrites.get(id) ?? Promise.resolve();
		const current = previous.catch(() => undefined).then(operation);
		pendingWrites.set(id, current);
		return current.finally(() => {
			if (pendingWrites.get(id) === current) pendingWrites.delete(id);
		});
	};
	return {
		store: async (event: Episode): Promise<void> => {
			const incoming = structuredClone(event);
			// #51 — query-time scores from a recalled copy must never be persisted.
			delete incoming.relevanceScore;
			delete incoming.vectorScore;
			const invocationStore = host.getStore();
			return enqueueWrite(incoming.id, async () => {
				if (host.getStore() !== invocationStore) {
					throw new Error("Memory store changed while embedding episode");
				}
				const store = invocationStore;
				const epVec = await host.embedDocument(incoming.content);
				if (host.getStore() !== store) {
					throw new Error("Memory store changed while embedding episode");
				}
				const existing = store.episodes.findIndex(
					(episode) => episode.id === incoming.id,
				);
				if (existing >= 0) store.episodes[existing] = incoming;
				else store.episodes.push(incoming);
				if (epVec) {
					store.episodeEmbeddings ??= {};
					store.episodeEmbeddings[incoming.id] = epVec;
				} else {
					delete store.episodeEmbeddings?.[incoming.id];
				}
				host.markDirty();
				host.save();
			});
		},

		recall: async (
			query: string,
			context: RecallContext,
		): Promise<Episode[]> => {
			const now = Date.now();
			const topK = context.topK ?? 5;
			// #51 — strength is a retention signal, not a retrieval gate (default 0).
			const minStrength = context.minStrength ?? 0;
			const deepRecall = context.deepRecall ?? false;
			const touch = context.touch ?? true;
			const queryVec = await host.embedQuery(query);
			const store = host.getStore();
			const epScopeMode = context.scopeMode ?? "soft";
			const epCrossProject = context.crossProject ?? false;
			const epProj = context.project;
			const projectEpisodes =
				epScopeMode === "strict" && !epCrossProject
					? epProj
						? store.episodes.filter(
								(ep) => ep.encodingContext?.project === epProj,
							)
						: store.episodes.filter((ep) => !ep.encodingContext?.project)
					: store.episodes;
			const eligibleEpisodes = projectEpisodes.filter(
				(episode) =>
					!isSyntheticSystemEcho(episode) &&
					episode.content.trim() !== query.trim(),
			);
			const episodeLexicalScores = new Map<string, number>();
			let maxEpisodeLexical = 0;
			for (const ep of eligibleEpisodes) {
				const score = compactKeywordScore(query, ep.content);
				episodeLexicalScores.set(ep.id, score);
				maxEpisodeLexical = Math.max(maxEpisodeLexical, score);
			}
			const scored = eligibleEpisodes
				.map((ep) => {
					if (!deepRecall && ep.status === "archived") return null;
					const strength = calculateStrength(
						ep.importance.utility,
						ep.timestamp,
						ep.recallCount,
						ep.lastAccessed,
						now,
					);
					if (!deepRecall && minStrength > 0 && strength < minStrength) return null;
					const epVec = queryVec ? store.episodeEmbeddings?.[ep.id] : null;
					// #51 — keep the raw cosine for the caller; undefined (not 0) when either
					// vector is missing so a caller can fail closed on a missing embedder.
					const vectorScore =
						epVec && queryVec
							? Math.max(0, cosineSimilarity(queryVec, epVec))
							: undefined;
					const keyword = keywordScore(query, `${ep.content} ${ep.summary}`);
					const lexicalScore =
						maxEpisodeLexical > 0
							? (episodeLexicalScores.get(ep.id) ?? 0) / maxEpisodeLexical
							: keyword;
					const textScore =
						vectorScore !== undefined
							? vectorScore * 0.65 + lexicalScore * 0.35
							: keyword;
					let contextBonus = 0;
					if (context.project && ep.encodingContext.project === context.project)
						contextBonus += 0.2;
					if (
						context.activeFile &&
						ep.encodingContext.activeFile === context.activeFile
					)
						contextBonus += 0.1;
					// #51 — strength is not part of the score (it only breaks ties, below).
					// deepRecall differs only in including archived episodes and skipping
					// the minStrength gate.
					const finalScore = textScore + contextBonus;
					return { episode: ep, score: finalScore, strength, vectorScore };
				})
				.filter((x): x is NonNullable<typeof x> => x !== null && x.score > 0)
				.sort(compareByRelevanceThenStrength)
				.slice(0, topK);

			// #51 — `touch: false` reads without reinforcing and without a store write.
			if (touch) {
				for (const { episode } of scored) {
					episode.recallCount++;
					episode.lastAccessed = now;
					episode.strength = calculateStrength(
						episode.importance.utility,
						episode.timestamp,
						episode.recallCount,
						episode.lastAccessed,
						now,
					);
				}
				if (scored.length > 0) {
					host.markDirty();
					host.save();
				}
			}
			// #51 — return copies: the scored rows hold the stored objects, and attaching
			// per-query scores to them would persist a query artifact on the next save.
			// Copy after the touch block so the returned counters are current.
			return scored.map(({ episode, score, vectorScore }) => ({
				...episode,
				...(vectorScore === undefined ? {} : { vectorScore }),
				relevanceScore: score,
			}));
		},

		getRecent: async (n: number): Promise<Episode[]> =>
			host
				.getStore()
				.episodes.filter((ep) => ep.status !== "archived")
				.sort((a, b) => b.timestamp - a.timestamp)
				.slice(0, n),

		getUnconsolidated: async (): Promise<Episode[]> =>
			host.getStore().episodes.filter((ep) => !ep.consolidated),

		markConsolidated: async (ids: string[]): Promise<void> => {
			const idSet = new Set(ids);
			for (const ep of host.getStore().episodes) {
				if (idSet.has(ep.id)) ep.consolidated = true;
			}
			host.markDirty();
			host.save();
		},
	};
}
