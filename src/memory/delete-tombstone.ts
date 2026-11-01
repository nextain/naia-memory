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
 if (/[?？]/u.test(input) || /(?:지우지|잊지|삭제하지|말고)|\b(?:don['’]t|do\s+not|never|not)\b/i.test(input.replace(/^(?:please\s+)?(?:don['’]t|do\s+not)\s+remember\s+/i, ''))) return null;
 const english = input.match(/^(?:please\s+)?(?:delete|forget|remove|erase|don['’]t\s+remember|do\s+not\s+remember)\s+(.+?)[.!\s]*$/i);
 if (english) {
  const target = english[1].replace(/^that\s+/i, "").trim();
  const quoted = target.match(/^["“'‘]([^"”'’]+)["”'’]$/u);
  const value = (quoted ? quoted[1] : target).trim();
  return /[\p{L}\p{N}]/u.test(value) ? value : null;
 }
 const korean = input.match(/^(.+?)\s*(?:지워(?:줘|주세요|줄래)?|잊어(?:줘|주세요|버려)|삭제해(?:줘|\s+줘|주세요)?|기억하지\s*(?:마|말아줘)|기억\s+안\s+해도\s+돼)[.!！\s]*$/u);
 if (!korean) return null;
 const before = korean[1].trim();
 const quoted = before.match(/^["“'‘]([^"”'’]+)["”'’](?:을|를|은|는)?$/u);
 if (quoted) return quoted[1].trim() || null;
 const target = before.match(/^(.*?)(?:을|를|는)?$/u)?.[1].trim();
 return target || null;
}
export function isTombstoned(text: string, tombstones: readonly string[] = []): boolean {
 const normalized = text.toLocaleLowerCase().normalize("NFKC");
 return tombstones.some((t) => {
  const target = normalizeDeletionText(t);
  if ([...target].length < 2) return false;
  const pattern = [...target].map(c => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\p{P}\\p{S}]*");
  const ending = /[가-힣]$/u.test(target)
   ? "(?:에서|에게|으로|까지|부터|처럼|하고|이야|이에요|입니다|이다|이|가|은|는|을|를|에|의|와|과|도|만|로)?(?![\\p{L}\\p{N}])"
   : "(?![\\p{L}\\p{N}])";
  return new RegExp(`(?<![\\p{L}\\p{N}])${pattern}${ending}`, "u").test(normalized);
 });
}

/** Require first-person evidence and reject explicit references to other people. */
export function isUserSubject(text: string): boolean {
 const firstPerson = /(?:^|[\s,])(?:(?:나는|내가|내|저는|제가|제|우리)(?=$|[\s,])|I\b|my\b)/i;
 const otherPerson = /(?:친구|그\s*사람|엄마|아빠|어머니|아버지|동료|형제|자매|동생|형|누나|언니|오빠|남편|아내|아들|딸|상사|그녀|그들|\b(?:friend|mother|father|mom|dad|brother|sister|wife|husband|son|daughter|boss|coworker|co-worker|colleague|cousin|uncle|aunt|parent|child|partner|teacher|he|she|they|their)\b)/i;
 return firstPerson.test(text) && !otherPerson.test(text);
}

export interface ScopedTombstone { target: string; project: string | null; factIds: string[]; episodeIds?: string[] }
export function applicableTombstones(store: { tombstones?: string[]; tombstoneFactIds?: Record<string, string[]>; scopedTombstones?: ScopedTombstone[] }, project?: string) {
 const scoped = (store.scopedTombstones ?? []).filter(t => t.project === (project ?? null));
 return {
  targets: [...(store.tombstones ?? []), ...scoped.map(t => t.target)],
  episodeIds: new Set(scoped.flatMap(t => t.episodeIds ?? [])),
  ids: new Set([...Object.values(store.tombstoneFactIds ?? {}).flat(), ...scoped.flatMap(t => t.factIds)]),
 };
}
