/** Normalize deletion targets and searchable text consistently. */
export function normalizeDeletionText(text: string): string {
 return text.toLocaleLowerCase().normalize("NFKC").replace(/[\s\p{P}\p{S}]+/gu, "");
}
export function normalizeDeletionTarget(text: string): string {
 return normalizeDeletionText(text).replace(/(?:을|를|이|가|은|는)$/, "");
}
const VAGUE_TARGETS = new Set(["it", "that", "this", "these", "those", "them", "everything", "all", "something", "anything", "stuff", "thing", "그거", "그것", "이거", "이것", "저거", "저것", "그", "이", "저", "다", "전부", "모두", "뭐", "무언가", "그런 거", "그 얘기", "아까 거"].map(normalizeDeletionTarget));
function concreteTarget(text: string): string | null {
 let value = text.trim();
 let normalized = normalizeDeletionTarget(value);
 if (VAGUE_TARGETS.has(normalized)) return null;
 value = value.replace(/^(?:that|this|these|those)\s+/i, "").replace(/^(?:그|이|저)\s+/u, "").trim();
 normalized = normalizeDeletionTarget(value);
 if (!normalized || VAGUE_TARGETS.has(normalized) || /^[가-힣]$/u.test(normalized) || /^[a-z]{1,2}$/i.test(normalized)) return null;
 return /[\p{L}\p{N}]/u.test(value) ? value : null;
}
export function deletionTarget(text: string): string | null {
 const input = text.trim();
 // A quoted target is allowed, but the command itself must be outside quotation marks.
 if (/[?？]/u.test(input) || /(?:지우지|잊지|삭제하지|말고|안\s+잊어|안\s+지워|안\s+삭제해)|\b(?:don['’]t|do\s+not|never|not)\b/i.test(input.replace(/^(?:please\s+)?(?:don['’]t|do\s+not)\s+remember\s+/i, ''))) return null;
 const english = input.match(/^(?:please\s+)?(?:delete|forget|remove|erase|don['’]t\s+remember|do\s+not\s+remember)\s+(.+?)[.!\s]*$/i);
 if (english) {
  const target = english[1].trim().replace(/^(?:that|this|these|those)\s+/i, "");
  const quoted = target.match(/^["“'‘]([^"”'’]+)["”'’]$/u);
  const value = (quoted ? quoted[1] : target).trim();
  return concreteTarget(value);
 }
 const korean = input.match(/^(.+?)\s*(?:지워(?:줘|주세요|줄래)?|잊어(?:줘|주세요|버려)?|삭제해(?:줘|\s+줘|주세요)?|기억하지\s*(?:마|말아줘)|기억\s+안\s+해도\s+돼)[.!！~～\s]*$/u);
 if (!korean) return null;
 const before = korean[1].trim();
 const quoted = before.match(/^["“'‘]([^"”'’]+)["”'’](?:을|를|은|는)?$/u);
 if (quoted) return concreteTarget(quoted[1]);
 const target = before.match(/^(.*?)(?:을|를|는)?$/u)?.[1].trim();
 return concreteTarget(target ?? "");
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
const OTHER_RELATION = /(?:사촌|삼촌|외삼촌|이모|이모부|고모|고모부|숙모|조카|친척|형제|자매|형|오빠|누나|언니|동생|남동생|여동생|아버지|아빠|어머니|엄마|부모|할아버지|할머니|아들|딸|자식|아내|남편|와이프|배우자|애인|여자친구|남자친구|친구|동료|이웃|그\s*사람|그녀|그들|\b(?:cousin|uncle|aunt|nephew|niece|relative|brother|sister|sibling|father|dad|mother|mom|parent|grandfather|grandmother|son|daughter|child|wife|husband|spouse|partner|girlfriend|boyfriend|friend|colleague|coworker|co-worker|neighbor|he|she|they|their)\b)/i;
const OTHER_TITLE = /(?:상사|선배|후배|사장|팀장|\b(?:boss|manager|teacher)\b)/i;
export function isTitleDeletionTarget(text: string): boolean { return /^(?:상사|선배|후배|사장|팀장|boss|manager|teacher)$/i.test(text.trim()); }
const USER_TITLE_STATEMENT = /^\s*(?:(?:I am|I'm|I work as|my job is|my work is)\s+(?:a|an|the)?\s*(?:boss|manager|teacher)|(?:나는|난|저는|전|내 직업은|제 직업은)\s*(?:상사|선배|후배|사장|팀장)(?:님)?(?:이야|야|이에요|예요|입니다|이다|다)?)\s*[.!]?\s*$/i;
export function mentionsOtherPerson(text: string): boolean { return OTHER_RELATION.test(text) || OTHER_TITLE.test(text); }
const USER_POSSESSIONS = {
 ko: ["물건", "집", "주소", "직업", "일", "회사", "직장", "학교", "전공", "취미", "이름", "별명", "생일", "나이", "차", "자동차", "휴대폰", "폰", "노트북", "컴퓨터", "가방", "지갑", "좋아하는 것", "싫어하는 것", "목표", "계획", "일정", "습관", "혈액형", "키", "몸무게"],
 en: ["thing", "stuff", "home", "house", "address", "job", "work", "company", "school", "major", "hobby", "name", "nickname", "birthday", "age", "car", "phone", "laptop", "computer", "bag", "wallet", "favorite", "goal", "plan", "schedule", "habit"],
} as const;
/** Inspect the original request before demonstratives or punctuation are removed. */
export function hasUnsafeDeletionTarget(request: string): boolean {
 if (OTHER_RELATION.test(request) || /['’]s\b|의/u.test(request.replace(/나의(?=\s)/gu, "내"))) return true;
 for (const match of request.matchAll(/\bmy\s+([a-z]+)\b/gi)) {
  if (!(USER_POSSESSIONS.en as readonly string[]).includes(match[1].toLowerCase()) && !/\bmy\s+(?:[a-z]+\s+)*(?:name|nickname|address)\b/i.test(request)) return true;
 }
 return false;
}
function hasAllowedSubject(text: string): boolean {
 const input = text.trim();
 const userTitleStatement = USER_TITLE_STATEMENT.test(input);
 if (OTHER_RELATION.test(input) || (OTHER_TITLE.test(input) && !userTitleStatement)) return false;
 for (const match of input.matchAll(/\bmy\s+([a-z]+)\b/gi)) {
  if (!(USER_POSSESSIONS.en as readonly string[]).includes(match[1].toLowerCase())) return false;
 }
 const possessiveInput = userTitleStatement ? input.replace(/^((?:내|제) 직업은)(?=\S)/u, "$1 ") : input;
 for (const match of possessiveInput.matchAll(/(?:^|\s)(?:내|제|나의|저의)\s+([가-힣]+)/gu)) {
  if (!(USER_POSSESSIONS.ko as readonly string[]).some(word => match[1] === word || new RegExp(`^${word}(?:은|는|이|가|을|를|의|에|도|만)$`, "u").test(match[1]))) return false;
 }
 if (userTitleStatement || /^(?:나는|난|내가|저는|전|제가)(?:\s|$)|^I(?:\b|['’]m\b)/i.test(input)) return true;
 const ko = input.match(/^(?:내|제|나의|저의)\s+(.+?)(?:은|는|이|가)(?:\s|$)/u);
 if (ko) return (USER_POSSESSIONS.ko as readonly string[]).includes(ko[1]);
 const en = input.match(/^my\s+([a-z]+)\s+(?:is|are|was|were|has|have|does|can|will)\b/i);
 return !!en && (USER_POSSESSIONS.en as readonly string[]).includes(en[1].toLowerCase());
}

type AttributeKey = { head: string; modifiers: string[]; past: boolean };
const PAST = /^(?:예전|전|옛|지난|지난달|지난해|작년|old|previous|former)$/i;
const HEADS = /^(?:이름|별칭|애칭|별명|주소|nickname|name|address)$/i;
const WORK = /^(?:직장|회사|일터|workplace|company|job)$/i;
const GROUP = /^(?:모임|동호회|학원|학교|소속|단체|club|group)$/i;
function attributeKey(phrase: string): AttributeKey | null {
 const words = phrase.toLowerCase().trim().replace(/^(?:내|나의|my|the)\s+/i, "").split(/\s+/u).filter(Boolean);
 const head = words.pop();
 if (!head || !HEADS.test(head)) return null;
 const past = words.some(w => PAST.test(w));
 return {head, past, modifiers: [...new Set(words.filter(w => !PAST.test(w)))].sort()};
}
function serializeAttribute(key: AttributeKey): string {
 if (!key.past && !key.modifiers.length && ["주소", "이름", "별명", "address", "name", "nickname"].includes(key.head)) return key.head;
 return `named:${JSON.stringify(key)}`;
}
function parseAttribute(key: string): AttributeKey | null {
 if (!key.startsWith("named:")) return HEADS.test(key) ? {head: key, modifiers: [], past: false} : null;
 return JSON.parse(key.slice(6)) as AttributeKey;
}
export function splitDeletionTargets(target: string): string[] {
 return target.split(/\s*,\s*|\s+and\s+|(?:하고|랑|과|와)\s+/iu).map(s => s.trim()).filter(Boolean);
}
export function matchesNamedDeletionTarget(target: string, key: string): boolean {
 const cleaned = target.trim().replace(/^(?:(?:전에|아까|내가)\s*말한)\s*/u, "")
  .replace(/\s+(?:that I mentioned|I told you)$/i, "").replace(/(?:을|를|은|는)$/u, "").trim();
 const words = cleaned.toLowerCase().replace(/^(?:내|나의|my|the)\s+/i, "").split(/\s+/u).filter(Boolean);
 const past = words.some(w => PAST.test(w));
 const branch = key.match(/^(workplace|membership):(past|current)$/);
 if (branch) {
  const withoutName = words.at(-1) === "이름" || words.at(-1) === "name" ? words.slice(0, -1) : words;
  const head = withoutName.at(-1) ?? "";
  return (!past || branch[2] === "past") && (branch[1] === "workplace" ? WORK.test(head) : GROUP.test(head));
 }
 const fact = parseAttribute(key), wanted = attributeKey(cleaned);
 return !!fact && !!wanted && fact.head === wanted.head && (!wanted.past || fact.past) && wanted.modifiers.every(w => fact.modifiers.includes(w));
}

/** Extract only explicitly supported user attribute statements. */
export function extractUserFactValue(content: string): {key: string; value: string} | null {
 const input = content.trim();
 if (!OTHER_RELATION.test(input) && !OTHER_TITLE.test(input)) {
  const namedKo = input.match(/^(?:(?:내|나의)\s+)?(.*?(?:이름|별칭|애칭|별명|주소))(?:은|는|이|가)\s*(.+?)(?:이야|야|이에요|예요|입니다|이다)[.!]?$/u);
  const namedEn = input.match(/^my\s+(.+?\b(?:nickname|name|address)|nickname|name|address)\s+is\s+(.+?)[.!]?$/i);
  const named = namedKo ?? namedEn;
  if (named) {
   const key = attributeKey(named[1]), value = named[2].trim();
   if (key && value && !OTHER_RELATION.test(value) && !/['’]s\b|의/u.test(value)) return {key: serializeAttribute(key), value};
   return null;
  }
  const workKo = input.match(/^(?:(예전에는|전에는)\s+)?(.+?)에서\s*(?:일했어|일해)[.!]?$/u);
  const groupKo = input.match(/^(?:(예전에는)\s+)?(.+?)에\s*(?:다녔어|다녀)[.!]?$/u);
  const workEn = input.match(/^I\s+(?:(used to)\s+)?work(?:ed)?\s+at\s+(.+?)[.!]?$/i);
  const verb = workKo ?? groupKo ?? workEn;
  if (verb && !OTHER_RELATION.test(verb[2]) && !/['’]s\b|의/u.test(verb[2])) return {key: `${groupKo ? "membership" : "workplace"}:${verb[1] || (workEn && /\bworked\b/i.test(input)) ? "past" : "current"}`, value: verb[2].trim()};
 }
 if (!hasAllowedSubject(input)) return null;
 let key: string | undefined, value: string | undefined;
 const ko = input.match(/^(?:내|제|나의|저의)\s+(.+?)(?:은|는|이|가)\s*(.+?)(?:이야|야|이에요|예요|입니다|이다|다)?[.!]?$/u);
 const en = input.match(/^my\s+([a-z]+)\s+(?:is|are|was|were)\s+(.+?)[.!]?$/i);
 const residenceEn = input.match(/^I live in\s+(.+?)[.!]?$/i);
 const residenceKo = input.match(/^(?:나는|저는|난|전)\s+(.+?)에\s*(?:살아|살아요|삽니다|산다)[.!]?$/u);
 const occupationEn = input.match(/^(?:I am|I'm|I work as)\s+(?:(?:a|an|the)\s+)?(.+?)[.!]?$/i);
 const occupationKo = input.match(/^(?:나는|저는|난|전)\s*(.+?)(?:이야|야|이에요|예요|입니다|이다)[.!]?$/u);
 if (ko && (USER_POSSESSIONS.ko as readonly string[]).includes(ko[1])) { key = ko[1]; value = ko[2]; }
 else if (en && (USER_POSSESSIONS.en as readonly string[]).includes(en[1].toLowerCase())) { key = en[1].toLowerCase(); value = en[2].replace(/^(?:a|an|the)\s+/i, ""); }
 else if (residenceEn || residenceKo) { key = "residence"; value = (residenceEn ?? residenceKo)![1]; }
 else if (occupationEn || occupationKo) { key = "occupation"; value = (occupationEn ?? occupationKo)![1]; }
 value = value?.trim();
 if (!key || !value || OTHER_RELATION.test(value) || /['’]s\b|의/u.test(value)) return null;
 return {key, value};
}
export function isUserSubject(text: string): boolean { return extractUserFactValue(text) !== null; }
export function deletionFactValue(content: string): string { return extractUserFactValue(content)?.value ?? content; }

export interface DeletedFact { id: string; value: string; key?: string; attribute: import("./types.js").FactAttribute; identity?: Pick<import("./types.js").StructuredFact, "subject" | "property" | "subjectId" | "propertyId"> }
export interface ScopedTombstone { target: string; project: string | null; factIds: string[]; episodeIds: string[]; deletedFacts: DeletedFact[]; attributeTarget?: boolean }
export function applicableTombstones(store: { tombstones?: string[]; tombstoneFactIds?: Record<string, string[]>; scopedTombstones?: ScopedTombstone[] }, project?: string) {
 const scoped = (store.scopedTombstones ?? []).filter(t => t.project === (project ?? null));
 return {
  targets: [...(store.tombstones ?? []), ...scoped.filter(t => !t.attributeTarget).map(t => t.target)],
  episodeIds: new Set(scoped.flatMap(t => t.episodeIds)),
  ids: new Set([...Object.values(store.tombstoneFactIds ?? {}).flat(), ...scoped.flatMap(t => t.factIds)]),
 };
}
