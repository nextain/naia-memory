import { calculateStrength, shouldPrune } from "../decay.js";
import type { KnowledgeGraph } from "../knowledge-graph.js";
import type { Fact, MemoryAdapter } from "../types.js";
import type { MemoryStore } from "./local-model.js";
import { assocKey } from "./local-search.js";
import type { SemanticSearchContext } from "./local-semantic-search.js";

interface LocalSemanticHost {
	getStore(): MemoryStore;
	getKnowledgeGraph(): KnowledgeGraph;
	embedDocument(text: string): Promise<number[] | null>;
	search(
		query: string,
		topK: number,
		deepRecall: boolean,
		context?: SemanticSearchContext,
	): Promise<Fact[]>;
	markDirty(): void;
	save(): void;
}

export function createLocalSemanticMemory(
	host: LocalSemanticHost,
): MemoryAdapter["semantic"] {
	const pendingWrites = new Map<string, Promise<void>>();
	const enqueueWrite = (ids: string[], operation: () => Promise<void>) => {
		const uniqueIds = [...new Set(ids)].sort();
		const previous = Promise.all(
			uniqueIds.map((id) => pendingWrites.get(id)?.catch(() => undefined)),
		);
		const current = previous.then(operation);
		for (const id of uniqueIds) pendingWrites.set(id, current);
		return current.finally(() => {
			for (const id of uniqueIds) {
				if (pendingWrites.get(id) === current) pendingWrites.delete(id);
			}
		});
	};
	const upsertMany = async (facts: Fact[]): Promise<void> => {
		if (facts.length === 0) return;
		const incomingFacts = facts.map((fact) => structuredClone(fact));
		if (
			new Set(incomingFacts.map((fact) => fact.id)).size !==
			incomingFacts.length
		)
			throw new Error("Semantic batch upsert requires unique fact IDs");
		const invocationStore = host.getStore();
		return enqueueWrite(
			incomingFacts.map((fact) => fact.id),
			async () => {
				if (host.getStore() !== invocationStore)
					throw new Error(
						"Memory store changed while embedding semantic facts",
					);
				const store = invocationStore;
				const prepared: Array<{
					incoming: Fact;
					needsEmbedding: boolean;
					vector: number[] | null;
				}> = [];
				// Keep provider calls sequential, matching the pre-batch upsert path.
				// Every async operation still finishes before the mutation section.
				for (const incoming of incomingFacts) {
					const existing = store.facts.find((fact) => fact.id === incoming.id);
					const needsEmbedding =
						!existing ||
						existing.content !== incoming.content ||
						!store.factEmbeddings?.[incoming.id];
					prepared.push({
						incoming,
						needsEmbedding,
						vector: needsEmbedding
							? await host.embedDocument(incoming.content)
							: null,
					});
				}
				if (host.getStore() !== store)
					throw new Error(
						"Memory store changed while embedding semantic facts",
					);
				const now = Date.now();
				const touchedEntities: string[][] = [];
				for (const { incoming, needsEmbedding, vector } of prepared) {
					const existing = store.facts.find((fact) => fact.id === incoming.id);
					if (existing) {
						existing.content = incoming.content;
						existing.entities = [
							...new Set([...existing.entities, ...incoming.entities]),
						];
						existing.topics = [
							...new Set([...existing.topics, ...incoming.topics]),
						];
						existing.updatedAt = incoming.updatedAt;
						existing.importance = Math.max(
							existing.importance,
							incoming.importance,
						);
						existing.sourceEpisodes = [
							...new Set([
								...existing.sourceEpisodes,
								...incoming.sourceEpisodes,
							]),
						];
						existing.status = incoming.status ?? existing.status;
						existing.maxEmotion = incoming.maxEmotion ?? existing.maxEmotion;
						existing.strength = incoming.strength;
						existing.lastAccessed = incoming.lastAccessed;
						existing.recallCount = incoming.recallCount;
						if ("validFrom" in incoming)
							existing.validFrom = incoming.validFrom;
						if ("validTo" in incoming) existing.validTo = incoming.validTo;
						if ("successorId" in incoming)
							existing.successorId = incoming.successorId;
						if ("supersedes" in incoming)
							existing.supersedes = incoming.supersedes;
						existing.encodingContext =
							incoming.encodingContext ?? existing.encodingContext;
						existing.structured = incoming.structured ?? existing.structured;
					} else store.facts.push(incoming);
					touchedEntities.push(existing?.entities ?? incoming.entities);
					if (vector) {
						store.factEmbeddings ??= {};
						store.factEmbeddings[incoming.id] = vector;
					} else if (needsEmbedding) delete store.factEmbeddings?.[incoming.id];
				}
				const kg = host.getKnowledgeGraph();
				for (const entities of touchedEntities) {
					for (const entity of entities) kg.touchNode(entity, now);
					for (let i = 0; i < entities.length; i++)
						for (let j = i + 1; j < entities.length; j++)
							kg.strengthen(entities[i], entities[j], 0.05, now);
				}
				host.markDirty();
				host.save();
			},
		);
	};
	return {
		upsert: async (fact: Fact): Promise<void> => upsertMany([fact]),
		upsertMany,

		search: (
			query,
			topK,
			deepRecall = false,
			context?: SemanticSearchContext,
		) => host.search(query, topK, deepRecall, context),

		decay: async (now: number): Promise<number> => {
			const store = host.getStore();
			let archivedCount = 0;
			for (const fact of store.facts) {
				const strength = calculateStrength(
					fact.importance,
					fact.createdAt,
					fact.recallCount,
					fact.lastAccessed,
					now,
				);
				fact.strength = strength;
				if (shouldPrune(strength) && fact.status === "active") {
					fact.status = "archived";
					archivedCount++;
				}
			}
			for (const episode of store.episodes) {
				const strength = calculateStrength(
					episode.importance.utility,
					episode.timestamp,
					episode.recallCount,
					episode.lastAccessed,
					now,
				);
				episode.strength = strength;
				if (
					shouldPrune(strength) &&
					!episode.consolidated &&
					episode.status !== "archived"
				) {
					episode.status = "archived";
					archivedCount++;
				}
			}
			if (archivedCount > 0) {
				host.markDirty();
				host.save();
			}
			return archivedCount;
		},

		associate: async (
			entityA: string,
			entityB: string,
			weight = 0.1,
		): Promise<void> => {
			const store = host.getStore();
			const key = assocKey(entityA, entityB);
			store.associations[key] = Math.min(
				1.0,
				(store.associations[key] ?? 0) + weight,
			);
			host.getKnowledgeGraph().strengthen(entityA, entityB, weight);
			host.markDirty();
			host.save();
		},

		getAll: async (): Promise<Fact[]> => [...host.getStore().facts],

		delete: async (id: string): Promise<boolean> => {
			const fact = host
				.getStore()
				.facts.find((candidate) => candidate.id === id);
			if (!fact) return false;
			fact.status = "archived";
			host.markDirty();
			host.save();
			return true;
		},
	};
}
