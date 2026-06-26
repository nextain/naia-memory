/**
 * Negative-capture filter for fact extraction (hermes-derived).
 *
 * hermes-agent's background-review encodes a hard-won policy: do NOT memorize
 * transient / environment-dependent failures as durable facts. If you do, they
 * "harden into refusals the agent cites against itself for months after the
 * actual problem was fixed." This module ports that policy to naia-memory's
 * consolidation step.
 *
 * Placement: applied to the output of `factExtractor` inside `consolidateNow`
 * (single chokepoint — covers both the heuristic and the LLM extractor). The
 * LLM extractor's PROMPT carries the same policy as the *primary* semantic
 * lever (so transient failures are never distilled in the first place); this
 * deterministic filter is a narrow BACKSTOP.
 *
 * Design (two codex adversarial rounds): false-POSITIVES (killing a legitimate
 * durable fact) are worse than false-negatives (the LLM prompt catches those).
 * So the deterministic filter matches ONLY unambiguous error SIGNATURES that do
 * not occur in durable config/policy facts. Value-laden vocabulary that the LLM
 * must judge in context is deliberately LEFT to the prompt:
 *  - NOT matched here (prompt's job): bare "timeout"/"rate limit", HTTP status
 *    codes (429/50x/401/403), token/key *absence-handling policy* ("토큰 없으면
 *    생성"), generic "실패"/"failed" events, "권한 없음" (could be a real access
 *    fact). These collide with legitimate operational knowledge.
 *  - Matched here (safe signatures): "command not found", "ModuleNotFoundError",
 *    "ECONNREFUSED", "ENOENT", "permission denied", "X tool is broken", etc.
 *
 * Korean note: JS `\b` does not work around Hangul (Korean chars are non-word),
 * so word boundaries are used ONLY around ASCII tokens; Korean alternatives are
 * bare or guarded with `(?![가-힣])` lookahead.
 *
 * Pure + unit-testable: no I/O, no LLM, no state.
 */

export interface DroppedFact {
	readonly content: string;
	/** Which negative-capture category triggered the drop (for logging/audit). */
	readonly reason: string;
}

export interface NegativeCaptureResult<T> {
	readonly kept: T[];
	readonly dropped: DroppedFact[];
}

interface NegPattern {
	readonly reason: string;
	readonly re: RegExp;
}

/**
 * "Capture the FIX, never the failure." A drop-candidate is rescued when it is
 * shaped as a solution: a labeled fix ("해결책:", "수정:"), a fix-COMPLETION
 * verb ("수정됨", "해결했다", "fixed", "resolved", "...로 해결"), or a how-to
 * label ("설치 방법"). Mere presence of the noun 수정 ("수정 도구") does NOT
 * exempt — so "수정 도구가 고장남" is still dropped.
 */
const FIX_RE =
	/^\s*(fix|fixed|해결|수정|고침)\s*[:：]|해결(책|됨|했|함|돼)|수정(됨|했|함|돼)|\bfixed\b|\bresolved\b|fix(ed)? by|resolved by|로 ?(해결|수정)|to (fix|resolve)|설치 ?방법|설정 ?방법/i;

/**
 * Unambiguous transient / environment-dependent error SIGNATURES (KO + EN).
 * Intentionally narrow — see module header for what is deliberately excluded.
 */
const PATTERNS: readonly NegPattern[] = [
	{ reason: "env:command-not-found", re: /\bcommand not found\b|is not recognized as the name of|찾을 수 ?없는 명령|명령.{0,4}찾을 수 ?없/i },
	{ reason: "env:not-installed", re: /\bnot installed\b|cannot find module|module not found|modulenotfounderror|no module named|\bimporterror\b|missing (binary|module|package|dependency)|모듈.{0,3}찾을 수 ?없/i },
	{ reason: "env:credential-missing", re: /\b(no|missing|unconfigured|invalid) (api ?key|credential|token|secret)\b|(api ?key|credential|token|secret|인증 ?키|api ?키|토큰).{0,4}(없음|없다|없습니다|missing|absent|not set|미설정)/i },
	{ reason: "env:access-denied", re: /\bpermission denied\b|\baccess denied\b/i },
	{ reason: "env:path-enoent", re: /\benoent\b|no such file or directory/i },
	{ reason: "tool-broken-claim", re: /(\btool\b|도구|툴).{0,20}(is broken|doesn'?t work|does not work|not working|작동.{0,4}안|고장|먹통)|(broken|먹통|고장).{0,12}(\btool\b|도구|툴)|cannot use .{1,30}(tool|from)/i },
	{ reason: "transient-error", re: /\beconnrefused\b|\betimedout\b|connection refused|socket hang ?up|dns lookup failed/i },
	{ reason: "one-off-task", re: /^(summari[sz]ed?|analy[sz]ed?)\b|(요약|정리|분석)\s*(했(다|어|음)?|함)(?![가-힣])/i },
];

/**
 * Classify a candidate fact. Returns the negative-capture reason if it should
 * be dropped, or `null` if it should be kept. Patterns are checked first; a
 * matched drop-candidate is rescued only by the FIX exemption.
 */
export function classifyNegativeCapture(content: string): string | null {
	const s = String(content ?? "");
	if (!s.trim()) return null;
	let matched: string | null = null;
	for (const p of PATTERNS) {
		if (p.re.test(s)) { matched = p.reason; break; }
	}
	if (!matched) return null;
	if (FIX_RE.test(s)) return null; // capture-the-FIX exemption → keep
	return matched;
}

/**
 * Partition facts into kept / dropped by the negative-capture policy.
 * Generic over any object carrying a `content` string (e.g. ExtractedFact).
 */
export function filterNegativeCapture<T extends { content: string }>(
	facts: readonly T[] | null | undefined,
): NegativeCaptureResult<T> {
	const kept: T[] = [];
	const dropped: DroppedFact[] = [];
	for (const f of facts ?? []) {
		const reason = classifyNegativeCapture(f?.content ?? "");
		if (reason) dropped.push({ content: f.content, reason });
		else kept.push(f);
	}
	return { kept, dropped };
}
