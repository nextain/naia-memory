/** Normalize deletion targets and searchable text consistently. */
export function normalizeDeletionText(text: string): string {
 return text.toLocaleLowerCase().normalize("NFKC").replace(/[\s\p{P}\p{S}]+/gu, "");
}
export function normalizeDeletionTarget(text: string): string {
 return normalizeDeletionText(text).replace(/(?:을|를|은|는)$/, "");
}
export function deletionTarget(text: string): string | null {
 const match = text.match(/(?:지워줘|지워|잊어줘|잊어|삭제해줘|기억하지\s*마|\bforget\b|\bdelete\b|\bremove\s+that\b)/i);
 if (!match || match.index === undefined) return null;
 const before = text.slice(0, match.index).trim();
 const after = text.slice(match.index + match[0].length).trim();
 const quoted = (before + " " + after).match(/["“'‘]([^"”'’]+)["”'’]/);
 if (quoted) return quoted[1].trim() || null;
 const korean = before.match(/(?:^|\s)([^\s,]+(?:\s+[^\s,]+)*?)(?:을|를|는)\s*$/);
 if (korean) return korean[1].trim();
 if (/^(?:forget|delete)\b/i.test(match[0])) return after.replace(/[.!?]+$/, "").trim() || null;
 return null;
}
export function isTombstoned(text: string, tombstones: readonly string[] = []): boolean {
 const normalized = normalizeDeletionText(text);
 return tombstones.some((t) => t.length > 0 && normalized.includes(t));
}

export interface ScopedTombstone { target: string; project: string | null; factIds: string[] }
export function applicableTombstones(store: { tombstones?: string[]; tombstoneFactIds?: Record<string, string[]>; scopedTombstones?: ScopedTombstone[] }, project?: string) {
 const scoped = (store.scopedTombstones ?? []).filter(t => t.project === (project ?? null));
 return {
  targets: [...(store.tombstones ?? []), ...scoped.map(t => t.target)],
  ids: new Set([...Object.values(store.tombstoneFactIds ?? {}).flat(), ...scoped.flatMap(t => t.factIds)]),
 };
}
