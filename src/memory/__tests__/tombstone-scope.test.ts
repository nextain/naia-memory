import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalAdapter, MemorySystem } from "../index.js";

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
   expect(facts.find(f => f.content.includes("서울에 살아"))?.status).toBe(ambiguous ? "active" : "archived");
   expect(facts.find(f => f.content.includes("서울에서 일해"))?.status).toBe("active");
   if (ambiguous) expect(adapter.getStore().scopedTombstones ?? []).toHaveLength(0);
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
  await say("나는 청동나침반을 갖고 있어.", "A");
  expect(adapter.getStore().scopedTombstones).toHaveLength(0);
 } finally { await close(); }
});
