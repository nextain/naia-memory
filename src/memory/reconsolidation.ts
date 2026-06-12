/**
 * Memory Reconsolidation — update memories when recalled.
 *
 * Neuroscience basis (Nader et al. 2000):
 * When a consolidated memory is reactivated (recalled), it enters a
 * temporarily labile state. During this window, the memory can be
 * strengthened, weakened, or updated with new information.
 *
 * Implementation:
 * - On retrieval, compare existing fact against current context
 * - Detect contradictions using keyword overlap + negation patterns
 * - Update (reconsolidate) or flag for review
 *
 * Also inspired by:
 * - Zep bi-temporal model (invalidate, don't delete)
 * - mem0 ADD/UPDATE/DELETE/NOOP pipeline
 */

import type { ContradictionFilterProvider } from "./contradiction-filter.js";
import { stripKoreanParticle } from "./index.js";
import type { Fact } from "./types.js";

/** Result of a reconsolidation check */
export interface ReconsolidationResult {
	/** What action to take */
	action: "keep" | "update" | "flag_contradiction";
	/** If update: the updated fact content */
	updatedContent?: string;
	/** Human-readable reason for the action */
	reason: string;
}

/** Negation patterns that signal a contradiction */
const NEGATION_PATTERNS = [
	// English
	/\bnot\b/i,
	/\bno longer\b/i,
	/\bdon't\b/i,
	/\bdoesn't\b/i,
	/\bstopped\b/i,
	/\bswitched\b/i,
	/\bchanged\b/i,
	/\binstead\b/i,
	/\breplaced\b/i,
	/\bactually\b/i,
	// Korean
	/아니[라고]/,
	/않/,
	// Standalone 안 negator (whitespace-bounded to avoid matching 안녕, 안나, 안철수 …)
	/(^|\s)안(\s|$)/,
	/바꿨/,
	/변경/,
	/대신/,
	/그만/,
];

/** Value-replacement overlap threshold — tighter than negation branch (0.3).
 *  Without negation cues, we need stronger positive evidence. */
const VALUE_REPLACEMENT_OVERLAP = 0.5;

/** Preference/state verbs that indicate updatable facts.
 *  D.2: added 3rd-person singular forms (prefers/uses/lives in) so
 *  substring matching catches natural-language facts like "Luke lives in Seoul"
 *  (previous list had only "live in" which failed to match "lives in"). */
const STATE_VERBS = [
	"prefer",
	"prefers",
	"use",
	"uses",
	"like",
	"likes",
	"want",
	"wants",
	"work with",
	"works with",
	"live in",
	"lives in",
	"work at",
	"works at",
	"좋아",
	"사용",
	"쓰",
	"원",
	"살",
	"일하",
];

/**
 * Check if a new piece of information contradicts an existing fact.
 * Uses heuristic detection (no LLM needed).
 *
 * @param existingFact - The stored fact
 * @param newInfo - The new information to compare against
 * @returns Reconsolidation action
 */
export function checkContradiction(
	existingFact: Fact,
	newInfo: string,
): ReconsolidationResult {
	const existingLower = existingFact.content.toLowerCase();
	const newLower = newInfo.toLowerCase();

	// 1. Check for shared entities — only compare if they're about the same thing
	const sharedEntities = existingFact.entities.filter((e) =>
		newLower.includes(e.toLowerCase()),
	);

	// Also check for significant content keyword overlap (catches cases where
	// the new info doesn't mention the old entity, e.g., "에디터 Cursor로 바꿨어"
	// without repeating "Neovim")
	// Uses substring matching to handle Korean particles (는, 을, 로, etc.)
	// Min token length 3 to avoid false positives like "use" in "because"
	const existingContentTokens = tokenizeSimple(existingLower);
	const newContentTokens = tokenizeSimple(newLower);
	let contentOverlapCount = 0;
	for (const nt of newContentTokens) {
		if (nt.length < 3) continue; // Skip very short tokens to prevent false positive substrings
		const hasMatch = existingContentTokens.some((et) => {
			if (et.length < 3) return false;
			// Exact match
			if (et === nt) return true;
			// Substring match only if the shorter token is at least 3 chars
			// and at least 60% of the longer token (avoids "port" in "important")
			const shorter = et.length < nt.length ? et : nt;
			const longer = et.length < nt.length ? nt : et;
			return longer.includes(shorter) && shorter.length / longer.length >= 0.6;
		});
		if (hasMatch) contentOverlapCount++;
	}
	// Require at least 2 overlapping tokens, or 1 if tokens are few
	const minOverlap = Math.max(
		1,
		Math.min(2, Math.floor(newContentTokens.length * 0.15)),
	);
	const hasContentOverlap =
		contentOverlapCount >= minOverlap && newContentTokens.length > 0;

	if (sharedEntities.length === 0 && !hasContentOverlap) {
		return {
			action: "keep",
			reason: "No shared entities or content overlap — unrelated",
		};
	}

	// 2. Check for negation patterns in new info that reference the existing fact
	const hasNegation = NEGATION_PATTERNS.some((pattern) =>
		pattern.test(newLower),
	);

	// 3. Check for state verb overlap (preference/state facts are update candidates)
	const isStateFact = STATE_VERBS.some(
		(verb) => existingLower.includes(verb) || newLower.includes(verb),
	);

	// 4. High keyword overlap + negation = likely contradiction
	const existingTokens = new Set(tokenizeSimple(existingLower));
	const newTokens = tokenizeSimple(newLower);
	let overlapCount = 0;
	for (const token of newTokens) {
		if (existingTokens.has(token)) overlapCount++;
	}
	const overlapRatio =
		newTokens.length > 0 ? overlapCount / newTokens.length : 0;

	if (hasNegation && overlapRatio > 0.3) {
		return {
			action: "update",
			updatedContent: newInfo,
			reason: `Contradiction detected: negation pattern with ${Math.round(overlapRatio * 100)}% topic overlap${sharedEntities.length > 0 ? ` on entities [${sharedEntities.join(", ")}]` : " (content overlap)"}`,
		};
	}

	if (isStateFact && hasNegation) {
		return {
			action: "update",
			updatedContent: newInfo,
			reason: `State change detected: preference/state fact with negation${sharedEntities.length > 0 ? ` on entities [${sharedEntities.join(", ")}]` : " (content overlap)"}`,
		};
	}

	// Value replacement — state-verb fact with shared entity and content
	// differs. No negation cue required; the overlap threshold is tighter
	// (VALUE_REPLACEMENT_OVERLAP = 0.5) to compensate.
	// Substantive-new-info guard: require ≥ 3 new tokens so entity-only inputs
	// (RC-18 "Luke") don't collapse the overlap ratio to 1.0 on one token.
	if (
		sharedEntities.length > 0 &&
		isStateFact &&
		overlapRatio >= VALUE_REPLACEMENT_OVERLAP &&
		existingLower !== newLower &&
		newTokens.length >= 3
	) {
		return {
			action: "update",
			updatedContent: newInfo,
			reason: `Value replacement detected: state-fact with shared entity [${sharedEntities.join(", ")}], new value supersedes`,
		};
	}

	// Note: "flag_contradiction" for high overlap without state verb is subsumed by
	// the overlapRatio > 0.3 check above. If future logic changes the threshold,
	// re-evaluate whether a separate flag_contradiction branch is needed.

	return { action: "keep", reason: "No contradiction detected" };
}

/**
 * Find facts that may conflict with new information.
 *
 * @param facts - All stored facts
 * @param newInfo - New information to check against
 * @returns Facts that have potential contradictions
 */
export function findContradictions(
	facts: Fact[],
	newInfo: string,
): Array<{ fact: Fact; result: ReconsolidationResult }> {
	return facts
		.map((fact) => ({
			fact,
			result: checkContradiction(fact, newInfo),
		}))
		.filter(({ result }) => result.action !== "keep");
}

/**
 * 1차 candidate gate for contradiction detection (R2.5).
 *
 * Cheap, broad-recall filter that decides which facts are *worth showing* to
 * the 2차 reasoning provider. We accept some false positives here — the LLM
 * filter will discard them. We tolerate some false negatives too: completely
 * unrelated facts must NOT pollute the candidate set or the API cost
 * explodes.
 *
 * Heuristic: shared entity OR ≥2 substantial token overlap. Mirrors the
 * `sharedEntities || hasContentOverlap` first-stage logic of
 * `checkContradiction`, but with no negation/state-verb requirement so
 * `이사` / `이제 X 쓰기로` style updates also pass to the LLM stage.
 */
export function isContradictionCandidate(
	existing: Fact,
	newInfo: string,
): boolean {
	const newLower = newInfo.toLowerCase();
	const existingLower = existing.content.toLowerCase();

	if (existing.entities.some((e) => newLower.includes(e.toLowerCase()))) {
		return true;
	}

	// Hangul stems are routinely 2 chars after particle stripping (루크/가장/색상),
	// so the Latin-oriented length>=3 filter dropped them and a 2-char Korean
	// "same subject+attribute, different value" contradiction fell below the >=2
	// overlap gate. Pure-Hangul tokens → ≥2; everything else keeps ≥3.
	const isTooShort = (t: string): boolean =>
		/^[가-힣]+$/u.test(t) ? t.length < 2 : t.length < 3;
	const existingTokens = tokenizeSimple(existingLower).filter(
		(t) => !isTooShort(t),
	);
	const newTokens = tokenizeSimple(newLower).filter((t) => !isTooShort(t));
	let overlap = 0;
	for (const nt of newTokens) {
		if (existingTokens.some((et) => et === nt || et.includes(nt) || nt.includes(et))) {
			overlap++;
			if (overlap >= 2) return true;
		}
	}
	return false;
}

/**
 * Async contradiction discovery using a pluggable filter provider (R2.5).
 *
 * Two stages:
 *   1차: `isContradictionCandidate` keeps only facts plausibly about the
 *        same entity/topic (cheap, in-process).
 *   2차: `filter.filter()` decides actual contradiction (small LLM by default,
 *        heuristic when CONTRADICTION_FILTER=heuristic).
 *
 * Returns the same shape as `findContradictions` so existing callers can
 * be migrated incrementally.
 */
export async function findContradictionsWith(
	facts: Fact[],
	newInfo: string,
	filter: ContradictionFilterProvider,
): Promise<Array<{ fact: Fact; result: ReconsolidationResult }>> {
	const candidates: Array<{ existing: Fact; newInfo: string }> = [];
	for (const f of facts) {
		if (isContradictionCandidate(f, newInfo)) {
			candidates.push({ existing: f, newInfo });
		}
	}

	const debug = process.env.NAIA_FILTER_DEBUG === "1";
	if (debug) {
		console.error(
			`[FILTER_DEBUG] newInfo="${newInfo.slice(0, 60)}" facts=${facts.length} candidates=${candidates.length}` +
				(candidates.length > 0
					? " | first 3: " +
						candidates
							.slice(0, 3)
							.map((c) => `"${c.existing.content.slice(0, 40)}"`)
							.join(" / ")
					: ""),
		);
	}

	if (candidates.length === 0) return [];

	const verdicts = await filter.filter(candidates);

	if (debug) {
		console.error(
			`[FILTER_DEBUG]   verdicts=${verdicts.length}` +
				(verdicts.length > 0
					? " | " +
						verdicts
							.map(
								(v) =>
									`idx=${v.index} action=${v.result.action} reason="${v.result.reason.slice(0, 50)}"`,
							)
							.join(" ; ")
					: " (LLM said no contradictions or all below threshold)"),
		);
	}

	return verdicts.map((v) => ({
		fact: candidates[v.index]!.existing,
		result: v.result,
	}));
}

/** Simple tokenizer for contradiction checking.
 *  D.2 RC-16c: apply stripKoreanParticle so particle-different tokens
 *  ("에디터를" vs "에디터로") lemmatize to the same stem and match. */
function tokenizeSimple(text: string): string[] {
	return text
		.replace(/[^\p{L}\p{N}\s]/gu, " ")
		.split(/\s+/)
		.filter((t) => t.length > 1)
		.map((t) => stripKoreanParticle(t));
}
