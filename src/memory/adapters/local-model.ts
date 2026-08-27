/** Shared JSON-store model and temporal fact selection for LocalAdapter. */

import type { Episode, Fact, Reflection, Skill } from "../types.js";
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumberRecord(value: unknown): boolean {
	return (
		isRecord(value) &&
		Object.values(value).every(
			(entry) => typeof entry === "number" && Number.isFinite(entry),
		)
	);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((entry) => typeof entry === "string")
	);
}

function isOptionalString(value: unknown): boolean {
	return value === undefined || typeof value === "string";
}

function isEncodingContext(value: unknown): boolean {
	return (
		isRecord(value) &&
		["project", "activeFile", "taskDescription", "sessionId", "category"].every(
			(key) => isOptionalString(value[key]),
		)
	);
}

function isStructuredFact(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.subject === "string" &&
		typeof value.property === "string" &&
		typeof value.value === "string" &&
		["affirmed", "negated"].includes(value.polarity as string) &&
		["single", "multi"].includes(value.cardinality as string) &&
		isOptionalString(value.subjectId) &&
		isOptionalString(value.propertyId) &&
		(value.provenance === undefined ||
			["extractor", "caller", "heuristic"].includes(value.provenance as string))
	);
}

function isEpisode(value: unknown): value is Episode {
	if (!isRecord(value) || !isRecord(value.importance)) return false;
	const importance = value.importance;
	return (
		typeof value.id === "string" &&
		typeof value.content === "string" &&
		typeof value.summary === "string" &&
		isFiniteNumber(value.timestamp) &&
		["importance", "surprise", "emotion", "utility"].every((key) =>
			isFiniteNumber(importance[key]),
		) &&
		isEncodingContext(value.encodingContext) &&
		typeof value.consolidated === "boolean" &&
		isFiniteNumber(value.recallCount) &&
		isFiniteNumber(value.lastAccessed) &&
		isFiniteNumber(value.strength) &&
		(value.role === undefined ||
			["user", "assistant", "tool"].includes(value.role as string)) &&
		(value.status === undefined ||
			["active", "archived"].includes(value.status as string))
	);
}

function isFact(value: unknown): value is Fact {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === "string" &&
		typeof value.content === "string" &&
		isStringArray(value.entities) &&
		isStringArray(value.topics) &&
		isFiniteNumber(value.createdAt) &&
		isFiniteNumber(value.updatedAt) &&
		isFiniteNumber(value.importance) &&
		isFiniteNumber(value.recallCount) &&
		isFiniteNumber(value.lastAccessed) &&
		isFiniteNumber(value.strength) &&
		["active", "superseded", "archived"].includes(value.status as string) &&
		isStringArray(value.sourceEpisodes) &&
		(value.validTo === undefined ||
			value.validTo === null ||
			isFiniteNumber(value.validTo)) &&
		["maxEmotion", "validFrom", "relevanceScore"].every(
			(key) => value[key] === undefined || isFiniteNumber(value[key]),
		) &&
		["supersedes", "successorId"].every(
			(key) =>
				value[key] === undefined ||
				value[key] === null ||
				typeof value[key] === "string",
		) &&
		(value.encodingContext === undefined ||
			isEncodingContext(value.encodingContext)) &&
		(value.structured === undefined || isStructuredFact(value.structured))
	);
}

function isEpoch(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.name === "string" &&
		isFiniteNumber(value.start) &&
		(value.end === null || isFiniteNumber(value.end)) &&
		isOptionalString(value.description) &&
		isOptionalString(value.sourceEpisodeId)
	);
}

function isSkill(value: unknown): value is Skill {
	return (
		isRecord(value) &&
		["id", "name", "description"].every(
			(key) => typeof value[key] === "string",
		) &&
		["learnedAt", "successCount", "failureCount", "confidence"].every((key) =>
			isFiniteNumber(value[key]),
		)
	);
}

function isReflection(value: unknown): value is Reflection {
	return (
		isRecord(value) &&
		["task", "failure", "analysis", "correction"].every(
			(key) => typeof value[key] === "string",
		) &&
		isFiniteNumber(value.timestamp)
	);
}

function isEmbeddingRecord(value: unknown): boolean {
	return (
		isRecord(value) &&
		Object.values(value).every(
			(vector) =>
				Array.isArray(vector) &&
				vector.length > 0 &&
				vector.every(
					(component) =>
						typeof component === "number" && Number.isFinite(component),
				),
		)
	);
}

function isKnowledgeGraphState(value: unknown): boolean {
	return (
		isRecord(value) &&
		isRecord(value.nodes) &&
		Object.values(value.nodes).every(
			(node) =>
				isRecord(node) &&
				typeof node.name === "string" &&
				isFiniteNumber(node.frequency) &&
				isFiniteNumber(node.lastSeen),
		) &&
		isRecord(value.edges) &&
		Object.values(value.edges).every(
			(edge) =>
				isRecord(edge) &&
				typeof edge.from === "string" &&
				typeof edge.to === "string" &&
				isFiniteNumber(edge.weight) &&
				isFiniteNumber(edge.coOccurrences),
		)
	);
}

/** Runtime-safe structural validation for untrusted persisted JSON. */
export function isMemoryStore(value: unknown): value is MemoryStore {
	if (!isRecord(value) || value.version !== 1) return false;
	if (
		!Array.isArray(value.episodes) ||
		!value.episodes.every(isEpisode) ||
		!Array.isArray(value.facts) ||
		!value.facts.every(isFact) ||
		!Array.isArray(value.skills) ||
		!value.skills.every(isSkill) ||
		!Array.isArray(value.reflections) ||
		!value.reflections.every(isReflection) ||
		!isFiniteNumberRecord(value.associations)
	) {
		return false;
	}
	if (
		value.epochs !== undefined &&
		(!Array.isArray(value.epochs) || !value.epochs.every(isEpoch))
	)
		return false;
	if (
		value.knowledgeGraph !== undefined &&
		!isKnowledgeGraphState(value.knowledgeGraph)
	) {
		return false;
	}
	if (
		value.factEmbeddings !== undefined &&
		!isEmbeddingRecord(value.factEmbeddings)
	) {
		return false;
	}
	if (
		value.episodeEmbeddings !== undefined &&
		!isEmbeddingRecord(value.episodeEmbeddings)
	) {
		return false;
	}
	return (
		value.embeddingSpaceId === undefined ||
		typeof value.embeddingSpaceId === "string"
	);
}

/** Apply v1 compatibility defaults before validating persisted data. */
export function normalizeMemoryStore(value: unknown): MemoryStore | null {
	if (isRecord(value) && Array.isArray(value.facts)) {
		for (const fact of value.facts) {
			if (isRecord(fact) && fact.status === undefined) fact.status = "active";
		}
	}
	return isMemoryStore(value) ? value : null;
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
