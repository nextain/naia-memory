/**
 * MemoryProvider interface — local definition.
 *
 * TODO: Swap to @nextain/agent-types when published (plan §3.8).
 * This file mirrors the interface defined in naia-agent/packages/types/src/memory.ts.
 * When @nextain/agent-types is available, replace this file with a re-export:
 *   export type { MemoryProvider, ... } from "@nextain/agent-types/memory";
 */

export interface MemoryProviderInput {
	content: string;
	role: "user" | "assistant" | "tool";
	timestamp?: number;
	context?: string;
	/** First-class REACTION signal — emotional valence 0..1 (0.5 = neutral).
	 *  Overrides the keyword-heuristic emotion so a caller can mark a memory as
	 *  emotionally reacted-to → higher salience → flashbulb recall boost. */
	emotion?: number;
	/** Optional importance override 0..1 (goal-relevance). */
	importance?: number;
}

export interface MemoryHit {
	id: string;
	content: string;
	score: number;
	createdAt: number;
	updatedAt?: number;
	metadata?: Record<string, unknown>;
}

export interface RecallOptions {
	project?: string;
	topK?: number;
	sessionId?: string;
}

export interface ConsolidationSummary {
	factsCreated: number;
	factsUpdated: number;
	episodesProcessed: number;
	durationMs: number;
}

export interface MemoryProvider {
	encode(input: MemoryProviderInput, opts?: { project?: string }): Promise<void>;
	recall(query: string, opts?: RecallOptions): Promise<MemoryHit[]>;
	consolidate(): Promise<ConsolidationSummary>;
	close(): Promise<void>;
}

// ─── Capability interfaces (optional, detected via isCapable<>) ────────────

export interface BackupCapableProvider {
	exportBackup(password: string): Promise<Uint8Array>;
	importBackup(blob: Uint8Array, password: string): Promise<void>;
}

export interface ImportanceScoringCapable {
	scoreImportance(text: string): { importance: number; surprise: number; emotion: number; utility: number };
}

export interface ReconsolidationCapableProvider {
	findContradictions(
		newContent: string,
		existingIds?: string[],
	): Promise<{ conflictingId: string; conflictType: "direct" | "indirect"; reason: string }[]>;
}

export interface TemporalCapableProvider {
	applyDecay(): Promise<number>;
	recallWithHistory(query: string, atTimestamp: number, opts?: RecallOptions): Promise<MemoryHit[]>;
}

export interface CompactableCapableProvider {
	compact(input: {
		messages: readonly { role: string; content: string; timestamp?: number }[];
		keepTail: number;
		targetTokens: number;
		sessionId?: string;
	}): Promise<{
		summary: { role: "assistant"; content: string; timestamp?: number };
		droppedCount: number;
		realtime?: boolean;
	}>;
}

export type AnyCapability =
	| BackupCapableProvider
	| ImportanceScoringCapable
	| ReconsolidationCapableProvider
	| TemporalCapableProvider
	| CompactableCapableProvider;

const CAPABILITY_METHODS: Record<string, string[]> = {
	BackupCapableProvider: ["exportBackup", "importBackup"],
	ImportanceScoringCapable: ["scoreImportance"],
	ReconsolidationCapableProvider: ["findContradictions"],
	TemporalCapableProvider: ["applyDecay", "recallWithHistory"],
	CompactableCapableProvider: ["compact"],
};

export function isCapable(
	provider: MemoryProvider & Partial<AnyCapability>,
	capName: string,
): boolean {
	const methods = CAPABILITY_METHODS[capName];
	if (!methods) return false;
	return methods.every((m) => typeof (provider as any)[m] === "function");
}
