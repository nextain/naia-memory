/** Placeholder shown in latest-mode recall where a deleted value was said. */
export const DELETED_VALUE_MARKER = "[deleted]";

export interface RedactionOutcome {
	content: string;
	/** Deleted values with at least one occurrence outside a live value. */
	redacted: number;
	/** Deleted values that never occur literally, so they cannot be masked. */
	missing: number;
}

type Span = [start: number, end: number];

function key(text: string): string {
	const normalized = text.normalize("NFC");
	const lower = normalized.toLocaleLowerCase();
	// Offsets found in the lowered text must be valid in the original.
	return lower.length === normalized.length ? lower : normalized;
}

function occurrences(haystack: string, needle: string): Span[] {
	const spans: Span[] = [];
	if (!needle) return spans;
	for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1))
		spans.push([at, at + needle.length]);
	return spans;
}

const overlaps = (a: Span, b: Span) => a[0] < b[1] && b[0] < a[1];

/**
 * Masks every literal occurrence of a deleted value in an utterance that must
 * stay visible because it also carries live facts. An occurrence that overlaps
 * a live value said in the same utterance is left alone: the user still holds
 * that value (it contains, or is restated as, the deleted one).
 */
export function redactDeletedValues(
	content: string,
	deletedValues: string[],
	liveValues: string[],
): RedactionOutcome {
	const text = content.normalize("NFC");
	const haystack = key(text);
	const kept = liveValues.flatMap((value) => occurrences(haystack, key(value.trim())));
	const masked: Span[] = [];
	let redacted = 0;
	let missing = 0;
	for (const value of new Set(deletedValues.map((v) => v.trim()).filter(Boolean))) {
		const found = occurrences(haystack, key(value));
		if (found.length === 0) {
			missing++;
			continue;
		}
		const free = found.filter((span) => !kept.some((live) => overlaps(span, live)));
		if (free.length > 0) redacted++;
		masked.push(...free);
	}
	if (masked.length === 0) return { content, redacted, missing };
	// Merge overlapping spans so one region becomes one marker.
	masked.sort((a, b) => a[0] - b[0]);
	const merged: Span[] = [];
	for (const span of masked) {
		const last = merged.at(-1);
		if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
		else merged.push([...span]);
	}
	let out = "";
	let cursor = 0;
	for (const [start, end] of merged) {
		out += text.slice(cursor, start) + DELETED_VALUE_MARKER;
		cursor = end;
	}
	return { content: out + text.slice(cursor), redacted, missing };
}
