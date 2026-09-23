/**
 * Ebbinghaus Forgetting Curve Implementation
 *
 * Models memory strength decay over time:
 *   strength = importance × e^(-λ_eff × days) × min(1 + recallCount × RECALL_BOOST, MAX_RECALL_MULTIPLIER)
 *
 * Where λ_eff = BASE_DECAY × (1 - importance × IMPORTANCE_DAMPING)
 * High-importance memories decay slower; frequently recalled memories persist longer.
 * Repetition is bounded (#51); strength is a retention signal and only a tie-breaker in ranking.
 *
 * Based on: Ebbinghaus (1885), YourMemory implementation, FOREVER (2025)
 */

/** Base decay rate per day (λ). Higher = faster forgetting.
 * 0.08: high-importance (0.7+) memories survive 60+ days without recall.
 * Previous value 0.16 was too aggressive — user's name forgotten in 2 months. */
export const BASE_DECAY = 0.08;

/** How much importance slows decay (0–1). At 0.85, max-importance decays at 23.5% of base rate.
 * Higher damping = important memories decay much slower than trivial ones. */
export const IMPORTANCE_DAMPING = 0.85;

/** Strength boost per recall event. Each recall adds this fraction to the multiplier. */
const RECALL_BOOST = 0.2;

/** Upper bound on the recall multiplier (nextain/naia-memory#51).
 *
 * The boost used to be unbounded: on the real store an episode recalled 259 times
 * reached strength 11.53 and won every query. Ranking no longer adds strength at all
 * (see compareByRelevanceThenStrength), so this cap bounds the remaining consumers
 * that still read strength as a magnitude — context-budget, the mem0 adapter's
 * ranking, the sqlite hot tier and decay/archival.
 *
 * 2.0 is measured: on a copy of the real store (635 episodes, 45 Korean queries,
 * multilingual-e5-large q8 CPU) with the previous 0.05 ranking weight, caps of 1.5 and
 * 2 matched the strength-free ranking on every relevance metric while 3 and 5 each lost
 * a rank-1 hit; 2.0 is the largest cap with no loss. With RECALL_BOOST 0.2 it saturates
 * at recallCount 5. */
export const MAX_RECALL_MULTIPLIER = 2.0;

/** Below this strength, memories are candidates for pruning. */
export const PRUNE_THRESHOLD = 0.05;

/** Minimum strength floor — prevents instant pruning of just-created memories */
const MIN_STRENGTH = 0.01;

/**
 * Calculate current memory strength using Ebbinghaus forgetting curve.
 *
 * @param importance - Base importance score (0.0–1.0)
 * @param createdAt - Timestamp when memory was created (ms)
 * @param recallCount - Number of times memory has been recalled
 * @param lastAccessed - Timestamp of most recent access (ms)
 * @param now - Current timestamp (ms)
 * @returns Current memory strength (0.01 – importance × MAX_RECALL_MULTIPLIER, i.e. at most 2.0)
 */
export function calculateStrength(
	importance: number,
	createdAt: number,
	recallCount: number,
	lastAccessed: number,
	now: number,
): number {
	// D.4 DC-15: non-finite input guard. NaN / ±Infinity silently propagate
	// through Math.max and land as NaN in downstream callers (benchmark
	// pipeline, memory.recall()). Fail safe: clamp to MIN_STRENGTH.
	if (
		!Number.isFinite(importance) ||
		!Number.isFinite(recallCount) ||
		!Number.isFinite(lastAccessed) ||
		!Number.isFinite(now)
	) {
		return MIN_STRENGTH;
	}

	// Use time since last access (not creation) — each recall resets the decay clock
	const daysSinceAccess = Math.max(
		0,
		(now - lastAccessed) / (1000 * 60 * 60 * 24),
	);

	// Effective decay rate: high importance → slower decay
	const lambdaEff = BASE_DECAY * (1 - importance * IMPORTANCE_DAMPING);

	// Core Ebbinghaus formula with recall boost
	const decayFactor = Math.exp(-lambdaEff * daysSinceAccess);
	const recallMultiplier = Math.min(
		1 + recallCount * RECALL_BOOST,
		MAX_RECALL_MULTIPLIER,
	);

	const strength = importance * decayFactor * recallMultiplier;

	return Math.max(MIN_STRENGTH, strength);
}

/**
 * Calculate time-weighted prune score for L1 tool output pruning.
 * Older items get higher scores (pruned first).
 *
 * @param tokenSize - Number of tokens in this item
 * @param hoursSince - Hours since the item was created
 * @returns Prune priority score (higher = prune first)
 */
export function calculatePruneScore(
	tokenSize: number,
	hoursSince: number,
): number {
	const ageWeight = 1 + Math.log(Math.max(1, hoursSince));
	return tokenSize * ageWeight;
}

/**
 * Determine if a memory should be pruned based on its current strength.
 *
 * R3 보존 우선 (사용자 directive 2026-05-08): caller 가 *splice* 대신
 * `status: 'archived'` 로 변경하는 게 권장. 이 함수는 그 *판단* 만 — 실제
 * splice 동작 X. `shouldArchive` 는 의도 명확 alias (deprecated 표시 X,
 * 두 이름 모두 유효).
 */
export function shouldPrune(strength: number): boolean {
	return strength < PRUNE_THRESHOLD;
}

/** R3 의도 명확 alias for `shouldPrune`. caller 는 splice X, status 변경만. */
export function shouldArchive(strength: number): boolean {
	return strength < PRUNE_THRESHOLD;
}

/**
 * Ranking rule shared by every LocalAdapter recall path (nextain/naia-memory#51):
 * relevance first; strength only breaks exact ties.
 *
 * Strength is an Ebbinghaus *retention* signal. Adding it to a relevance score let a
 * frequently recalled item outrank better matches, and every recall raised it further.
 * Measured on the real store and on the repo fact benchmark, every additive strength
 * weight tried (0.3 down to 0.01) ranked worse than using strength as a tie-breaker only.
 *
 * Use as an Array.prototype.sort comparator (descending by score, then by strength).
 */
export function compareByRelevanceThenStrength(
	a: { score: number; strength: number },
	b: { score: number; strength: number },
): number {
	return b.score - a.score || b.strength - a.strength;
}

