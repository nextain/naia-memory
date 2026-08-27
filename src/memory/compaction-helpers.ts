export function truncateForRecap(s: string, max: number): string {
	const trimmed = s.trim().replace(/\s+/g, " ");
	if (trimmed.length <= max) return trimmed;
	return `${trimmed.slice(0, max - 1)}…`;
}

/**
 * Build the deterministic recap used when no summarizer is injected, and
 * as the fallback seed passed to an injected summarizer.
 */
export function buildDeterministicRecap(
	msgs: readonly { role: string; content: string; timestamp?: number }[],
	keepTail: number,
): string {
	let userCount = 0;
	let assistantCount = 0;
	let toolCount = 0;
	const topics = new Set<string>();
	for (const m of msgs) {
		if (m.role === "user") userCount++;
		else if (m.role === "assistant") assistantCount++;
		else if (m.role === "tool") toolCount++;
		for (const match of m.content.matchAll(/\b[A-Z][\w-]{2,}\b/g)) {
			topics.add(match[0]);
			if (topics.size >= 8) break;
		}
	}

	const first = msgs[0];
	const last = msgs[msgs.length - 1];

	const lines: string[] = [
		`[Conversation recap — ${msgs.length} earlier messages compacted]`,
		`Turns: ${userCount} user · ${assistantCount} assistant · ${toolCount} tool`,
	];
	if (topics.size > 0) {
		lines.push(`Topics mentioned: ${Array.from(topics).join(", ")}`);
	}
	if (first) lines.push(`Started with: "${truncateForRecap(first.content, 120)}"`);
	if (last && last !== first) {
		lines.push(`Most recent before recap: "${truncateForRecap(last.content, 120)}"`);
	}
	lines.push(`(Follow-up context continues in the ${keepTail} messages after this recap.)`);

	return lines.join("\n");
}

/** Rolling summary internal shape (lives in memory, not persisted). */
export interface RollingSummary {
	sessionId: string;
	started: number;
	updated: number;
	/** Raw recent messages up to `rollingHeadroom`. */
	recent: { role: string; content: string; timestamp: number }[];
	/** Compressed stem — stats + quotes from evicted older messages. */
	compressed: string;
	userCount: number;
	assistantCount: number;
	toolCount: number;
	/** LRU topic → last-seen timestamp. Map preserves insertion order so
	 *  the oldest entry is evicted when the cap is reached. */
	topics: Map<string, number>;
	firstUser?: string;
	/** Aggregate count of messages evicted past the headroom. The compressed
	 *  stem is a bounded digest of this count (+ the oldest evicted quote),
	 *  NOT a per-eviction log — see updateRollingSummary. */
	evictedCount?: number;
	/** Oldest evicted message content (the true start of the compacted tail). */
	evictedFirst?: string;
}

/** Serializable snapshot of a RollingSummary. */
export interface RollingSummarySnapshot {
	sessionId: string;
	started: number;
	updated: number;
	recent: readonly { role: string; content: string; timestamp: number }[];
	compressed: string;
	userCount: number;
	assistantCount: number;
	toolCount: number;
	topics: readonly string[];
	firstUser?: string;
}

/**
 * v3 structured 5-section markdown sections (opencode/openclaw pattern,
 * Slice 3-XR-Compact #47 §6.1). Appended after the legacy header line so
 * existing assertions ("[Conversation recap …]") survive.
 *
 * Sections (omitted when empty):
 * - `## Prior recap (anchored)` — when `priorRecap` provided (Factory.ai
 *   anchored iterative pattern — Q7 lock).
 * - `## Goal` — first user message (intent).
 * - `## Instructions` — system-role messages in the window.
 * - `## Tool calls made` — distinct tool messages (Microsoft pattern via
 *   caller-side preprocessing; we list names/targets here).
 * - `## Discoveries` — fact-shaped assistant lines (heuristic).
 * - `## Relevant files / URLs` — strict-preserve identifiers (paths, URLs).
 */
export function buildStructuredSections(
	msgs: readonly { role: string; content: string; timestamp?: number }[],
	priorRecap?: { role: string; content: string; timestamp?: number },
): string {
	const sections: string[] = [];

	if (priorRecap && priorRecap.content.trim().length > 0) {
		sections.push("## Prior recap (anchored)", priorRecap.content.trim());
	}

	const firstUser = msgs.find((m) => m.role === "user");
	if (firstUser) {
		sections.push("## Goal", truncateForRecap(firstUser.content, 240));
	}

	const systemMsgs = msgs.filter((m) => m.role === "system");
	if (systemMsgs.length > 0) {
		const lines = ["## Instructions"];
		for (const sm of systemMsgs.slice(0, 3)) {
			lines.push(`- ${truncateForRecap(sm.content, 160)}`);
		}
		sections.push(lines.join("\n"));
	}

	const toolMsgs = msgs.filter((m) => m.role === "tool");
	if (toolMsgs.length > 0) {
		const lines = ["## Tool calls made"];
		const seen = new Set<string>();
		let shown = 0;
		for (const tm of toolMsgs) {
			const key = truncateForRecap(tm.content, 80);
			if (seen.has(key)) continue;
			seen.add(key);
			lines.push(`- ${truncateForRecap(tm.content, 120)}`);
			shown++;
			if (shown >= 10) {
				if (toolMsgs.length > shown) {
					lines.push(`- … (${toolMsgs.length - shown} more tool messages)`);
				}
				break;
			}
		}
		sections.push(lines.join("\n"));
	}

	const assistantMsgs = msgs.filter((m) => m.role === "assistant");
	if (assistantMsgs.length > 0) {
		const lines = ["## Discoveries"];
		let added = 0;
		outer: for (const am of assistantMsgs) {
			const factLines = am.content
				.split("\n")
				.map((l) => l.trim())
				.filter((l) => l.length >= 40 && l.length <= 200);
			for (const line of factLines.slice(0, 2)) {
				lines.push(`- ${line}`);
				added++;
				if (added >= 5) break outer;
			}
		}
		if (added > 0) {
			sections.push(lines.join("\n"));
		}
	}

	// Identifier strict-preserve: file-path-like + URLs verbatim. Used as
	// "## Relevant files / URLs" — recall pin for later reference.
	const pathRe = /(?:^|\s|`)([/\w][\w./\-]*\.[a-z]{1,6})(?=\s|`|$|[,.;:!?])/gim;
	const urlRe = /https?:\/\/[^\s)`'"<>]+/g;
	const files = new Set<string>();
	for (const m of msgs) {
		for (const match of m.content.matchAll(pathRe)) {
			const p = match[1];
			if (p && p.length >= 3) files.add(p);
			if (files.size >= 15) break;
		}
		if (files.size >= 15) break;
		for (const match of m.content.matchAll(urlRe)) {
			files.add(match[0]);
			if (files.size >= 15) break;
		}
		if (files.size >= 15) break;
	}
	if (files.size > 0) {
		const lines = ["## Relevant files / URLs"];
		for (const f of [...files].slice(0, 15)) {
			lines.push(`- \`${f}\``);
		}
		sections.push(lines.join("\n"));
	}

	return sections.join("\n\n");
}

export function buildRecapFromRollingSummary(
	rs: RollingSummary,
	windowSize: number,
	keepTail: number,
): string {
	const lines: string[] = [
		`[Conversation recap (rolling) — ${windowSize} messages in the caller's compaction window]`,
		`Session turns tracked so far: ${rs.userCount} user · ${rs.assistantCount} assistant · ${rs.toolCount} tool`,
	];
	if (rs.topics.size > 0) {
		lines.push(`Topics: ${Array.from(rs.topics.keys()).join(", ")}`);
	}
	if (rs.firstUser) lines.push(`Session started with: "${rs.firstUser}"`);
	if (rs.compressed) lines.push(`Earlier: ${rs.compressed}`);
	lines.push(`(Follow-up context continues in the ${keepTail} messages after this recap.)`);
	return lines.join("\n");
}

/** Host-supplied summarizer. Receives the original messages plus the
 *  deterministic recap seed and returns either a plain polished summary
 *  string (simple shape) or a structured result that can additionally
 *  declare `realtime: true` when the summary was already precomputed
 *  (e.g. from a rolling summary maintained during encode()). */
export type CompactionSummarizer = (input: {
	messages: readonly { role: string; content: string; timestamp?: number }[];
	keepTail: number;
	targetTokens: number;
	sessionId?: string;
	seedSummary: string;
	signal?: AbortSignal;
}) => Promise<string | CompactionSummarizerResult>;

export interface CompactionSummarizerResult {
	content: string;
	/** Mark true when the summary was precomputed/cached (no fresh LLM call). */
	realtime?: boolean;
}
