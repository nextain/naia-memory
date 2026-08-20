/**
 * Per-process usage tracker — counts LLM/embedding API calls and tokens
 * during a benchmark run. Reset between runs.
 *
 * NOT thread-safe (Node single-thread is fine). Module-level singleton —
 * one instance per Node process.
 */

export interface UsageStats {
	llmCalls: number;
	llmPromptTokens: number;
	llmCompletionTokens: number;
	embedCalls: number;
	embedTokens: number;
	/** R4 #26 — spike emit counts by reason (Step 4-5). */
	spikeEmits?: Record<string, number>;
	/** R4 #26 — replay boost count (Step 4). */
	replayBoosted?: number;
	deleteOutcomes?: Record<DeleteOutcome, number>;
	mutationOutcomes?: Record<MutationOutcome, number>;
}

export type DeleteOutcome =
	| "authorized"
	| "denied"
	| "verifier_failed"
	| "oversized";

export type MutationOutcome = "untrusted_contradiction_denied";

const _stats: UsageStats = {
	llmCalls: 0,
	llmPromptTokens: 0,
	llmCompletionTokens: 0,
	embedCalls: 0,
	embedTokens: 0,
	spikeEmits: {},
	replayBoosted: 0,
	deleteOutcomes: {
		authorized: 0,
		denied: 0,
		verifier_failed: 0,
		oversized: 0,
	},
	mutationOutcomes: { untrusted_contradiction_denied: 0 },
};

export function resetUsage(): void {
	_stats.llmCalls = 0;
	_stats.llmPromptTokens = 0;
	_stats.llmCompletionTokens = 0;
	_stats.embedCalls = 0;
	_stats.embedTokens = 0;
	_stats.spikeEmits = {};
	_stats.replayBoosted = 0;
	_stats.deleteOutcomes = {
		authorized: 0,
		denied: 0,
		verifier_failed: 0,
		oversized: 0,
	};
	_stats.mutationOutcomes = { untrusted_contradiction_denied: 0 };
}

export function recordMutationOutcome(outcome: MutationOutcome): void {
	if (!_stats.mutationOutcomes) {
		_stats.mutationOutcomes = { untrusted_contradiction_denied: 0 };
	}
	_stats.mutationOutcomes[outcome]++;
}

export function recordDeleteOutcome(outcome: DeleteOutcome): void {
	if (!_stats.deleteOutcomes) {
		_stats.deleteOutcomes = {
			authorized: 0,
			denied: 0,
			verifier_failed: 0,
			oversized: 0,
		};
	}
	_stats.deleteOutcomes[outcome]++;
}

/** R4 #26 — record spike emit for measurement framework. */
export function recordSpike(reason: string): void {
	if (!_stats.spikeEmits) _stats.spikeEmits = {};
	_stats.spikeEmits[reason] = (_stats.spikeEmits[reason] ?? 0) + 1;
}

/** R4 #26 — record replay boost for measurement framework. */
export function recordReplayBoost(count: number): void {
	_stats.replayBoosted = (_stats.replayBoosted ?? 0) + count;
}

export function recordLLM(
	promptTokens: number,
	completionTokens: number,
): void {
	_stats.llmCalls++;
	_stats.llmPromptTokens += promptTokens || 0;
	_stats.llmCompletionTokens += completionTokens || 0;
}

export function recordEmbedding(tokens: number): void {
	_stats.embedCalls++;
	_stats.embedTokens += tokens || 0;
}

export function getUsage(): UsageStats {
	return { ..._stats };
}

/**
 * Estimate cost in USD given 4 pricing rates ($/M tokens).
 * Rates can be overridden via env:
 *   NAIA_PRICE_LLM_IN, NAIA_PRICE_LLM_OUT, NAIA_PRICE_EMBED
 *
 * Defaults match Gemini 2.5 Flash Lite + gemini-embedding-001 (AI Studio
 * tier, 2026-05). Vertex AI tier may differ — check actual billing.
 */
export interface PricingRates {
	llmInputPerM: number; // $/M input tokens
	llmOutputPerM: number; // $/M output tokens
	embedPerM: number; // $/M embedding tokens
}

export function getPricingFromEnv(): PricingRates {
	return {
		llmInputPerM: Number.parseFloat(process.env.NAIA_PRICE_LLM_IN ?? "0.10"),
		llmOutputPerM: Number.parseFloat(process.env.NAIA_PRICE_LLM_OUT ?? "0.40"),
		embedPerM: Number.parseFloat(process.env.NAIA_PRICE_EMBED ?? "0.15"),
	};
}

export function estimateCostUSD(
	stats: UsageStats,
	rates: PricingRates,
): number {
	const llmIn = (stats.llmPromptTokens / 1_000_000) * rates.llmInputPerM;
	const llmOut = (stats.llmCompletionTokens / 1_000_000) * rates.llmOutputPerM;
	const emb = (stats.embedTokens / 1_000_000) * rates.embedPerM;
	return llmIn + llmOut + emb;
}
