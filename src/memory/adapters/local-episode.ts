import { calculateStrength } from "../decay.js";
import type { Episode, MemoryAdapter, RecallContext } from "../types.js";
import type { MemoryStore } from "./local-model.js";
import { cosineSimilarity, keywordScore } from "./local-search.js";

interface LocalEpisodeHost {
	getStore(): MemoryStore;
	embedQuery(text: string): Promise<number[] | null>;
	embedDocument(text: string): Promise<number[] | null>;
	markDirty(): void;
	save(): void;
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
			const minStrength = context.minStrength ?? 0.05;
			const deepRecall = context.deepRecall ?? false;
			const queryVec = await host.embedQuery(query);
			const store = host.getStore();
			const epScopeMode = context.scopeMode ?? "soft";
			const epCrossProject = context.crossProject ?? false;
			const epProj = context.project;
			const eligibleEpisodes =
				epScopeMode === "strict" && !epCrossProject
					? epProj
						? store.episodes.filter(
								(ep) => ep.encodingContext?.project === epProj,
							)
						: store.episodes.filter((ep) => !ep.encodingContext?.project)
					: store.episodes;
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
					if (!deepRecall && strength < minStrength) return null;
					const epVec = queryVec ? store.episodeEmbeddings?.[ep.id] : null;
					const textScore =
						epVec && queryVec
							? cosineSimilarity(queryVec, epVec)
							: keywordScore(query, `${ep.content} ${ep.summary}`);
					let contextBonus = 0;
					if (context.project && ep.encodingContext.project === context.project)
						contextBonus += 0.2;
					if (
						context.activeFile &&
						ep.encodingContext.activeFile === context.activeFile
					)
						contextBonus += 0.1;
					const finalScore = deepRecall
						? textScore + contextBonus
						: textScore * strength + contextBonus;
					return { episode: ep, score: finalScore, strength };
				})
				.filter((x): x is NonNullable<typeof x> => x !== null && x.score > 0)
				.sort((a, b) => b.score - a.score)
				.slice(0, topK);

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
			return scored.map((s) => s.episode);
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
