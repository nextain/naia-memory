/** Normalize deletion targets and searchable text consistently. */
export function normalizeDeletionText(text: string): string {
 return text.toLocaleLowerCase().normalize("NFKC").replace(/[\s\p{P}\p{S}]+/gu, "");
}
export function normalizeDeletionTarget(text: string): string {
 return normalizeDeletionText(text).replace(/(?:을|를|은|는)$/, "");
}
export function deletionTarget(text: string): string | null {
 const input = text.trim();
 // A quoted target is allowed, but the command itself must be outside quotation marks.
 if (/[?？]/u.test(input) || /(?:지우지|잊지|삭제하지|말고)|\b(?:don['’]t|do\s+not|never|not)\b/i.test(input)) return null;
 const english = input.match(/^(?:please\s+)?(?:delete|forget|remove|erase)\s+(.+?)[.!\s]*$/i);
 if (english) {
  const target = english[1].replace(/^that\s+/i, "").trim();
  const quoted = target.match(/^["“'‘]([^"”'’]+)["”'’]$/u);
  const value = (quoted ? quoted[1] : target).trim();
  return /[\p{L}\p{N}]/u.test(value) ? value : null;
 }
 const korean = input.match(/^(.+?)\s*(?:지워(?:줘|주세요|줄래)?|잊어(?:줘|주세요|버려)|삭제해(?:줘|\s+줘|주세요)?)[.!！\s]*$/u);
 if (!korean) return null;
 const before = korean[1].trim();
 const quoted = before.match(/^["“'‘]([^"”'’]+)["”'’](?:을|를|은|는)?$/u);
 if (quoted) return quoted[1].trim() || null;
 const target = before.match(/^(.*?)(?:을|를|는)?$/u)?.[1].trim();
 return target || null;
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
