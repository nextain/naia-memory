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

/** Conservative shared subject check for deletion and tombstone release. */
const OTHER_PERSON = /(?:사촌|삼촌|외삼촌|이모|이모부|고모|고모부|숙모|조카|친척|형제|자매|형|오빠|누나|언니|동생|남동생|여동생|아버지|아빠|어머니|엄마|부모|할아버지|할머니|아들|딸|자식|아내|남편|와이프|배우자|애인|여자친구|남자친구|친구|동료|상사|선배|후배|이웃|사장|팀장|그\s*사람|그녀|그들|\b(?:cousin|uncle|aunt|nephew|niece|relative|brother|sister|sibling|father|dad|mother|mom|parent|grandfather|grandmother|son|daughter|child|wife|husband|spouse|partner|girlfriend|boyfriend|friend|colleague|coworker|co-worker|boss|manager|neighbor|teacher|he|she|they|their)\b)/i;
export function mentionsOtherPerson(text: string): boolean { return OTHER_PERSON.test(text); }
const USER_POSSESSIONS = {
 ko: ["물건", "집", "주소", "직업", "일", "회사", "직장", "학교", "전공", "취미", "이름", "별명", "생일", "나이", "차", "자동차", "휴대폰", "폰", "노트북", "컴퓨터", "가방", "지갑", "좋아하는 것", "싫어하는 것", "목표", "계획", "일정", "습관", "혈액형", "키", "몸무게"],
 en: ["thing", "stuff", "home", "house", "address", "job", "work", "company", "school", "major", "hobby", "name", "nickname", "birthday", "age", "car", "phone", "laptop", "computer", "bag", "wallet", "favorite", "goal", "plan", "schedule", "habit"],
} as const;
export function isUserSubject(text: string): boolean {
 const input = text.trim();
 if (/^(?:나는|난|내가|저는|전|제가)(?:\s|$)|^I(?:\b|['’]m\b)/i.test(input)) return true;
 const ko = input.match(/^(?:내|제|나의|저의)\s+(.+?)(?:은|는|이|가)(?:\s|$)/u);
 if (ko) return (USER_POSSESSIONS.ko as readonly string[]).includes(ko[1]);
 const en = input.match(/^my\s+([a-z]+)\s+(?:is|are|was|were|has|have|does|can|will)\b/i);
 return !!en && (USER_POSSESSIONS.en as readonly string[]).includes(en[1].toLowerCase());
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
