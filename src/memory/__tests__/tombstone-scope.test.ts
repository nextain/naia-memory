import { expect, it } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalAdapter, MemorySystem } from "../index.js";
import { isTombstoned, isUserSubject } from "../delete-tombstone.js";

async function setup(vector = false) {
 const dir = await mkdtemp(join(tmpdir(), "tombstone-scope-"));
 const embeddingProvider = { name: "test", dims: 2, embeddingSpaceId: "scope-test", embed: async (_s: string) => [1, 0], embedBatch: async (texts: string[]) => texts.map(() => [1, 0]) };
 const adapter = new LocalAdapter(vector ? {storePath: join(dir, "store.json"), embeddingProvider} : join(dir, "store.json"));
 const memory = new MemorySystem({adapter});
 await memory.init();
 const say = async (content: string, project?: string) => { await memory.encode({role: "user", content}, project ? {project} : {}); await memory.consolidateNow(true); };
 const close = async () => { await memory.close(); await rm(dir, {recursive: true, force: true}); };
 return {adapter, memory, say, close};
}

it("does not match serialized field names", async () => {
 const {adapter, say, close} = await setup();
 try {
  await say("내 물건은 id야."); await say("내 물건은 노란등불이야."); await say("id를 잊어줘");
  expect(JSON.stringify(await adapter.semantic.search("노란등불", 100, true))).toContain("노란등불");
  expect(JSON.stringify(await adapter.episode.recall("노란등불", {topK: 100, deepRecall: true}))).toContain("노란등불");
  expect(JSON.stringify(await adapter.episode.getRecent(100))).toContain("노란등불");
 } finally { await close(); }
});

it("selects the user's fact and fails closed when multiple user facts match", async () => {
 for (const ambiguous of [false, true]) {
  const {adapter, say, close} = await setup();
  try {
   await say("나는 서울에 살아."); await say(ambiguous ? "나는 서울에서 일해." : "친구는 서울에서 일해."); await say("서울을 잊어줘");
   const facts = await adapter.semantic.getAll();
   expect(facts.find(f => f.content.includes("서울에 살아"))?.status).toBe("archived");
   expect(facts.find(f => f.content.includes("서울에서 일해"))?.status).toBe("active");
   expect(adapter.getStore().scopedTombstones ?? []).toHaveLength(1);
  } finally { await close(); }
 }
});

it("keeps projects isolated during filtering and reassertion", async () => {
 const {adapter, say, close} = await setup();
 try {
  await say("내 물건은 청동나침반이야.", "A"); await say("내 물건은 청동나침반이야.", "B"); await say("청동나침반을 잊어줘", "A");
  expect(JSON.stringify(await adapter.semantic.search("청동나침반", 100, true, {project: "B"}))).toContain("청동나침반");
  expect(JSON.stringify(await adapter.episode.recall("물건", {project: "B", topK: 100, deepRecall: true}))).toContain("청동나침반");
  await say("내 새 물건은 청동나침반이야.", "B");
  expect(JSON.stringify(await adapter.semantic.search("청동나침반", 100, true, {project: "A", mode: "history"}))).not.toContain("청동나침반");
 } finally { await close(); }
});

it("does not archive multiple embedding-only matches", async () => {
 const {adapter, say, close} = await setup(true);
 try {
  await say("나는 빨간별을 좋아해."); await say("나는 파란달을 좋아해."); await say("가상의대상을 잊어줘");
  const facts = await adapter.semantic.getAll();
  expect(facts.filter(f => f.content.includes("빨간별") || f.content.includes("파란달")).map(f => f.status)).toEqual(["active", "active"]);
  expect(adapter.getStore().scopedTombstones ?? []).toHaveLength(0);
 } finally { await close(); }
});

it("only archives user facts and ignores requests naming another person", async () => {
 for (const [fact, request, status] of [
  ["친구는 서울에서 일해.", "서울을 잊어줘", "active"],
  ["나는 서울에 살아.", "서울을 잊어줘", "archived"],
  ["나는 서울에 살아.", "친구 회사 기억 지워줘", "active"],
 ] as const) {
  const {adapter, say, close} = await setup();
  try {
   await say(fact); await say(request);
   expect((await adapter.semantic.getAll()).find(f => f.content === fact)?.status).toBe(status);
   if (status === "active") expect(adapter.getStore().scopedTombstones ?? []).toHaveLength(0);
  } finally { await close(); }
 }
});

it("keeps another person's matching fact and episode searchable", async () => {
 const {adapter, say, close} = await setup();
 try {
  await say("나는 서울에 살아.", "A");
  await say("친구는 서울에서 일해.", "A");
  await say("서울을 잊어줘", "A");
  expect((await adapter.semantic.getAll()).find(f => f.content === "나는 서울에 살아.")?.status).toBe("archived");
  for (const deep of [false, true]) {
   expect(JSON.stringify(await adapter.semantic.search("서울", 100, deep, {project: "A"}))).toContain("친구는 서울에서 일해.");
   expect(JSON.stringify(await adapter.episode.recall("서울", {project: "A", topK: 100, deepRecall: deep}))).toContain("친구는 서울에서 일해.");
  }
  expect(JSON.stringify(await adapter.episode.getRecent(100))).toContain("친구는 서울에서 일해.");
 } finally { await close(); }
});

it("only releases a tombstone for a user reassertion with the same attribute", async () => {
 const {adapter, say, close} = await setup();
 try {
  await say("내 물건은 청동나침반이야.", "A");
  await say("청동나침반을 잊어줘", "A");
  await say("친구가 청동나침반을 샀어.", "A");
  expect(adapter.getStore().scopedTombstones).toHaveLength(1);
  expect(JSON.stringify(await adapter.semantic.search("청동나침반", 100, true, {project: "A", mode: "history"}))).not.toContain("내 물건은 청동나침반이야.");
  await say("나는 청동나침반으로 일해.", "A");
  expect(adapter.getStore().scopedTombstones).toHaveLength(1);
  await say("내 물건은 청동나침반이야.", "A");
  expect(adapter.getStore().scopedTombstones).toHaveLength(0);
 } finally { await close(); }
});

for (const [userPlace, relativePlace, relativeWork, forgetPlace, place, userObject, relativeObject, forgetObject, object] of [
 ["I live in Seoul.", "My brother lives in Seoul.", "My brother works in Seoul.", "Forget Seoul.", "Seoul", "My thing is a bronze compass.", "My brother owns a bronze compass.", "Forget bronze compass.", "bronze compass"],
 ["나는 서울에 살아.", "내 동생은 서울에 살아.", "내 동생은 서울에서 일해.", "서울을 잊어줘", "서울", "내 물건은 청동나침반이야.", "내 동생의 물건은 청동나침반이야.", "청동나침반을 잊어줘", "청동나침반"],
] as const) {
 it(`preserves a relative's facts and tombstones (${place})`, async () => {
  const first = await setup();
  try {
   await first.say(relativePlace); await first.say(forgetPlace);
   expect((await first.adapter.semantic.getAll()).find(f => f.content === relativePlace)?.status).toBe("active");
   expect(first.adapter.getStore().scopedTombstones ?? []).toHaveLength(0);
  } finally { await first.close(); }
  const second = await setup();
  try {
   await second.say(userPlace); await second.say(forgetPlace); await second.say(relativeWork);
   for (const deep of [false, true]) {
    expect(JSON.stringify(await second.adapter.semantic.search(place, 100, deep))).toContain(relativeWork);
    expect(JSON.stringify(await second.adapter.episode.recall(place, {topK: 100, deepRecall: deep}))).toContain(relativeWork);
   }
  } finally { await second.close(); }
  const third = await setup();
  try {
   await third.say(userObject); await third.say(forgetObject); await third.say(relativeObject);
   expect(third.adapter.getStore().scopedTombstones).toHaveLength(1);
   expect(JSON.stringify(await third.adapter.semantic.search(object, 100, true, {mode: "history"}))).not.toContain(userObject);
  } finally { await third.close(); }
 });
}

it("requires word boundaries without an embedder", async () => {
 for (const [fact, request, status] of [
  ["My email address is stored.", "Forget AI.", "active"],
  ["I use AI every day.", "Forget AI.", "active"],
  ["I use A every day.", "Forget A.", "active"],
  ["나는 서울에서 살아.", "울을 잊어줘", "active"],
 ] as const) {
  const {adapter, say, close} = await setup();
  try {
   await say(fact); await say(request);
   expect((await adapter.semantic.getAll()).find(f => f.content === fact)?.status).toBe(status);
   expect(adapter.getStore().scopedTombstones ?? []).toHaveLength(0);
  } finally { await close(); }
 }
});

it("treats family and relationship expressions as non-user subjects", () => {
 for (const person of ["brother", "sister", "mom", "mother", "dad", "father", "friend", "wife", "husband", "son", "daughter", "boss", "coworker"]) {
  expect(isUserSubject(`My ${person} lives in Seoul.`), person).toBe(false);
 }
 for (const person of ["동생", "형", "누나", "언니", "오빠", "엄마", "아빠", "어머니", "아버지", "친구", "아내", "남편", "아들", "딸", "상사", "동료"]) {
  expect(isUserSubject(`우리 ${person}은 서울에 살아.`), person).toBe(false);
 }
 expect(isUserSubject("내일 서울에 가.")).toBe(false);
});

it("matches Korean word starts and particles, and rejects embedded fragments", () => {
 expect(isTombstoned("나는 서울에서 살아.", ["서울"])).toBe(true);
 expect(isTombstoned("나는 서울역에 가.", ["서울"])).toBe(false);
 expect(isTombstoned("I use AI every day.", ["ai"])).toBe(true);
 expect(isTombstoned("My email address is stored.", ["ai"])).toBe(false);
});

for (const relative of ["사촌", "삼촌", "이모", "조카"]) {
 it(`preserves ${relative} facts and tombstones`, async () => {
  const {adapter, say, close} = await setup();
  try {
   await say(`내 ${relative}은 서울에 살아.`); await say("서울을 잊어줘");
   expect((await adapter.semantic.getAll()).find(f => f.content.includes("서울"))?.status).toBe("active");
   expect(adapter.getStore().scopedTombstones ?? []).toHaveLength(0);
   await say("내 물건은 청동나침반이야."); await say("청동나침반을 잊어줘");
   await say(`내 ${relative} 물건은 청동나침반이야.`);
   expect(adapter.getStore().scopedTombstones).toHaveLength(1);
   const history = JSON.stringify(await adapter.semantic.search("청동나침반", 100, true, {mode: "history"}));
   expect(history).not.toContain("내 물건은 청동나침반이야.");
   expect(JSON.stringify(await adapter.episode.recall("청동나침반", {deepRecall: true, mode: "history", topK: 100}))).not.toContain("청동나침반을 잊어줘");
  } finally { await close(); }
 });
}
it("rejects cousin subjects and accepts explicit user subjects", () => {
 expect(isUserSubject("My cousin lives in Seoul.")).toBe(false);
 expect(isUserSubject("내 사촌 물건은 청동나침반이야.")).toBe(false);
 expect(isUserSubject("내 물건은 청동나침반이야.")).toBe(true);
 expect(isUserSubject("나는 서울에 살아.")).toBe(true);
 expect(isUserSubject("서울에 살아.")).toBe(false);
});

it("fails closed for unlisted possessors and nested ownership", async () => {
 for (const fact of ["My ex lives in Seoul.", "내 룸메이트는 서울에 살아."]) {
  const {adapter, say, close} = await setup();
  try {
   await say(fact); await say(fact.startsWith("My") ? "Forget Seoul." : "서울을 잊어줘");
   expect((await adapter.semantic.getAll()).find(f => f.content === fact)?.status).toBe("active");
   expect(adapter.getStore().scopedTombstones ?? []).toHaveLength(0);
  } finally { await close(); }
 }
 for (const fact of ["my ex's thing is a bronze compass", "내 룸메이트 물건은 청동나침반이야."]) {
  const {adapter, say, close} = await setup();
  try {
   const english = fact.startsWith("my");
   await say(english ? "my thing is a bronze compass" : "내 물건은 청동나침반이야.");
   await say(english ? "Forget bronze compass" : "청동나침반을 잊어줘");
   await say(fact);
   expect(adapter.getStore().scopedTombstones).toHaveLength(1);
  } finally { await close(); }
 }
 for (const fact of ["I live in Seoul", "my job is a teacher", "난 서울에 살아", "전 서울에 살아"]) expect(isUserSubject(fact)).toBe(true);
});

it.each([
 ["I am a teacher.", "Forget teacher."],
 ["My job is a teacher.", "Forget teacher."],
 ["나는 팀장이야.", "팀장을 잊어줘"],
])("archives and releases an explicit first-person occupation: %s", async (fact, request) => {
 const {adapter, say, close} = await setup();
 try {
  expect(isUserSubject(fact)).toBe(true);
  await say(fact); await say(request);
  expect((await adapter.semantic.getAll()).find(f => f.content === fact)?.status).toBe("archived");
  expect(adapter.getStore().scopedTombstones).toHaveLength(1);
  await say(fact);
  expect(adapter.getStore().scopedTombstones).toHaveLength(0);
  expect((await adapter.semantic.getAll()).filter(f => f.content === fact).map(f => f.status)).toContain("active");
 } finally { await close(); }
});

it.each([
 ["My teacher lives in Seoul.", "Forget Seoul."],
 ["The teacher lives in Seoul.", "Forget Seoul."],
 ["I met the manager in Seoul.", "Forget Seoul."],
 ["내 팀장은 서울에 살아.", "서울을 잊어줘"],
 ["I know my cousin lives in Seoul.", "Forget Seoul."],
 ["I am a teacher and my cousin lives in Seoul.", "Forget Seoul."],
])("preserves other-person facts: %s", async (fact, request) => {
 const {adapter, say, close} = await setup();
 try {
  expect(isUserSubject(fact)).toBe(false);
  await say(fact); await say(request);
  expect((await adapter.semantic.getAll()).find(f => f.content.includes(fact.includes(" and ") ? "my cousin lives in Seoul" : fact))?.status).toBe("active");
  expect(adapter.getStore().scopedTombstones ?? []).toHaveLength(0);
 } finally { await close(); }
});

it("limits occupation exceptions to the specified sentence forms", () => {
 for (const fact of [" I'm a teacher! ", "I work as the manager", "my work is boss", "저는 팀장님입니다.", "내 직업은 선배예요", "내 직업은팀장이다"]) expect(isUserSubject(fact), fact).toBe(true);
 for (const fact of ["I am a teacher in Seoul.", "I met the manager", "팀장은 서울에 살아.", "I am a teacher and my cousin lives in Seoul."]) expect(isUserSubject(fact), fact).toBe(false);
});

it.each([["I am a teacher.", "Forget my teacher."], ["나는 팀장이야.", "내 팀장을 잊어줘"]])("does not treat a possessive title request as the user's occupation", async (fact, request) => {
 const {adapter, say, close} = await setup();
 try {
  await say(fact); await say(request);
  expect((await adapter.semantic.getAll()).find(f => f.content === fact)?.status).toBe("active");
  expect(adapter.getStore().scopedTombstones ?? []).toHaveLength(0);
 } finally { await close(); }
});

it("releases normalized deletion only for the same project and value attribute", async () => {
 const {adapter, say, close} = await setup(true);
 try {
  await say("내 물건은 청동나침반이야.", "A");
  await say("청동 나침반을 잊어줘", "A");
  expect(adapter.getStore().scopedTombstones).toHaveLength(1);
  expect(adapter.getStore().scopedTombstones?.[0].deletedFacts?.[0].value).toContain("청동나침반");
  await say("내 물건은 청동나침반이야.", "B");
  await say("나는 청동나침반으로 일해.", "A");
  expect(adapter.getStore().scopedTombstones).toHaveLength(1);
  await say("내 물건은 청동나침반이야.", "A");
  expect(adapter.getStore().scopedTombstones).toHaveLength(0);
  expect((await adapter.semantic.getAll()).filter(f => f.content === "내 물건은 청동나침반이야." && f.encodingContext?.project === "A").map(f => f.status)).toContain("active");
 } finally { await close(); }
});

it("removes only the requested project or all projects by default", async () => {
 const {adapter, memory, say, close} = await setup();
 try {
  for (const project of ["A", "B"]) { await say("내 물건은 청동나침반이야.", project); await say("청동나침반을 잊어줘", project); }
  expect(adapter.getStore().scopedTombstones).toHaveLength(2);
  await memory.removeTombstone("청동나침반", {project: "A"});
  expect(adapter.getStore().scopedTombstones?.map(t => t.project)).toEqual(["B"]);
  await memory.removeTombstone("청동나침반");
  expect(adapter.getStore().scopedTombstones).toHaveLength(0);
 } finally { await close(); }
});

it("loads version one tombstones without deleted facts", async () => {
 const dir = await mkdtemp(join(tmpdir(), "legacy-tombstone-"));
 const path = join(dir, "store.json");
 let adapter = new LocalAdapter(path);
 let memory = new MemorySystem({adapter});
 try {
  await memory.init();
  for (const content of ["내 물건은 청동나침반이야.", "청동나침반을 잊어줘"]) { await memory.encode({role: "user", content}, {}); await memory.consolidateNow(true); }
  await memory.close();
  adapter = new LocalAdapter(path); memory = new MemorySystem({adapter}); await memory.init();
  expect(adapter.getStore().scopedTombstones?.[0].deletedFacts?.[0].value).toContain("청동나침반");
  await memory.close();
  const data = JSON.parse(await readFile(path, "utf8"));
  delete data.scopedTombstones[0].deletedFacts;
  await writeFile(path, JSON.stringify(data));
  adapter = new LocalAdapter(path); memory = new MemorySystem({adapter}); await memory.init();
  expect(adapter.getStore().scopedTombstones?.[0].deletedFacts).toBeUndefined();
  await memory.encode({role: "user", content: "내 물건은 청동나침반이야."}, {}); await memory.consolidateNow(true);
  expect(adapter.getStore().scopedTombstones).toHaveLength(1);
 } finally { await memory.close(); await rm(dir, {recursive: true, force: true}); }
});

it("excludes other people anywhere in a first-person fact from deletion and release", async () => {
 for (const [fact, request, place] of [
  ["I know my cousin lives in Seoul.", "Forget Seoul.", "Seoul"],
  ["나는 내 사촌이 서울에 사는 걸 알아.", "서울을 잊어", "서울"],
 ] as const) {
  const {adapter, say, close} = await setup();
  try {
   await say(fact); await say(request);
   expect((await adapter.semantic.getAll()).find(f => f.content === fact)?.status).toBe("active");
   expect(adapter.getStore().scopedTombstones ?? []).toHaveLength(0);
   expect(JSON.stringify(await adapter.semantic.search(place, 100, true))).toContain(fact);
  } finally { await close(); }
 }
 const {adapter, say, close} = await setup();
 try {
  await say("내 물건은 청동나침반이야."); await say("청동나침반을 잊어");
  await say("I know my cousin's thing is a bronze compass.");
  expect(adapter.getStore().scopedTombstones).toHaveLength(1);
  expect(isUserSubject("I know my roommate lives in Seoul.")).toBe(false);
 } finally { await close(); }
});

it("rejects vague deletion targets while accepting concrete demonstrative phrases", async () => {
 for (const request of ["Forget that.", "그거 잊어"]) {
  const {adapter, say, close} = await setup();
  try {
   const fact = "I remember that my first interview was in Seoul.";
   await say(fact); await say(request);
   expect((await adapter.semantic.getAll()).find(f => f.content === fact)?.status).toBe("active");
   expect(adapter.getStore().scopedTombstones ?? []).toHaveLength(0);
  } finally { await close(); }
 }
 for (const [fact, request] of [["my thing is a bronze compass", "Forget that bronze compass."], ["내 물건은 청동나침반이야.", "그 청동나침반 잊어"]]) {
  const {adapter, say, close} = await setup();
  try {
   await say(fact); await say(request);
   expect((await adapter.semantic.getAll()).find(f => f.content === fact)?.status).toBe("archived");
  } finally { await close(); }
 }
});


it("releases only the same extracted key and value", async () => {
 const {adapter, memory, say, close} = await setup();
 try {
  await say("내 주소는 서울이야."); await say("서울을 잊어줘.");
  expect(adapter.getStore().scopedTombstones).toHaveLength(1);
  await say("나는 2025년에 서울을 방문했어.");
  expect(adapter.getStore().scopedTombstones).toHaveLength(1);
  expect(JSON.stringify(await memory.recall("서울", {mode: "history", topK: 100}))).not.toContain("내 주소는 서울이야.");
  await say("내 물건은 서울이야.");
  expect(adapter.getStore().scopedTombstones).toHaveLength(1);
  await say("내 주소는 서울이야.");
  expect(adapter.getStore().scopedTombstones).toHaveLength(0);
 } finally { await close(); }
});


it("does not release a tombstone with a legacy deleted fact lacking a key", async () => {
 const {adapter, say, close} = await setup();
 try {
  await say("내 주소는 서울이야."); await say("서울을 잊어줘.");
  delete adapter.getStore().scopedTombstones![0].deletedFacts![0].key;
  await say("내 주소는 서울이야.");
  expect(adapter.getStore().scopedTombstones).toHaveLength(1);
 } finally { await close(); }
});

it("releases only the matching fact from a shared-target tombstone", async () => {
 const {adapter, memory, say, close} = await setup();
 try {
  await say("내 주소는 서울이야."); await say("서울을 잊어줘.");
  await say("내 물건은 서울이야."); await say("서울을 잊어줘.");
  const tombstone = adapter.getStore().scopedTombstones![0];
  expect(tombstone.deletedFacts?.map(f => f.key).sort()).toEqual(["물건", "주소"]);
  const addressId = tombstone.deletedFacts!.find(f => f.key === "주소")!.id;
  const thingId = tombstone.deletedFacts!.find(f => f.key === "물건")!.id;
  await say("내 주소는 서울이야.");
  expect(adapter.getStore().scopedTombstones).toHaveLength(1);
  expect(tombstone.deletedFacts?.map(f => f.key)).toEqual(["물건"]);
  expect(tombstone.factIds).toContain(thingId);
  expect(tombstone.factIds).not.toContain(addressId);
  expect(JSON.stringify(await adapter.semantic.search("서울", 100, true, {mode: "history"}))).not.toContain("내 물건은 서울이야.");
  expect(JSON.stringify(await memory.recall("서울", {mode: "history", topK: 100}))).not.toContain("내 물건은 서울이야.");
  expect(JSON.stringify(await adapter.episode.getRecent(100))).not.toContain("내 물건은 서울이야.");
  expect(JSON.stringify(await adapter.semantic.search("서울", 100, true, {mode: "history"}))).toContain("내 주소는 서울이야.");
  await say("내 물건은 서울이야.");
  expect(adapter.getStore().scopedTombstones).toHaveLength(0);
 } finally { await close(); }
});
