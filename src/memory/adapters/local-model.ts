/** Shared JSON-store model and temporal fact selection for LocalAdapter. */

import type {
	Episode,
	Fact,
	Reflection,
	Skill,
} from "../types.js";
import type { KGState } from "../knowledge-graph.js";

/** On-disk schema for JSON persistence. */
export interface MemoryStore {
	version: 1;
	episodes: Episode[];
	facts: Fact[];
	epochs?: import("../types.js").Epoch[];
	skills: Skill[];
	reflections: Reflection[];
	associations: Record<string, number>;
	knowledgeGraph?: KGState;
	factEmbeddings?: Record<string, number[]>;
	episodeEmbeddings?: Record<string, number[]>;
	/** Vector-space identity; dimensions alone cannot detect equal-width model changes. */
	embeddingSpaceId?: string;
}

export function emptyStore(): MemoryStore {
	return {
		version: 1,
		episodes: [],
		facts: [],
		skills: [],
		reflections: [],
		associations: {},
		factEmbeddings: {},
		episodeEmbeddings: {},
	};
}

function baseIdOf(id: string): string {
	return id.replace(/(-v\d+)+$/, "");
}

/** Facts whose validity interval overlaps the requested time range. */
export function factsInTimeRange(
	facts: Fact[],
	start: number,
	end: number | null,
): Fact[] {
	const actualEnd = end ?? Date.now();
	const groups = new Map<string, Fact[]>();
	for (const fact of facts) {
		const base = baseIdOf(fact.id);
		const group = groups.get(base);
		if (group) group.push(fact);
		else groups.set(base, [fact]);
	}

	const valid: Fact[] = [];
	for (const group of groups.values()) {
		const sorted = [...group].sort((a, b) => b.createdAt - a.createdAt);
		for (const fact of sorted) {
			const factStart = fact.validFrom ?? fact.createdAt;
			const factEnd = fact.validTo ?? Infinity;
			if (factStart <= actualEnd && factEnd >= start) {
				valid.push(fact);
				break;
			}
		}
	}
	return valid;
}

export function factsValidAtTime(facts: Fact[], timestamp: number): Fact[] {
	return factsInTimeRange(facts, timestamp, timestamp);
}
