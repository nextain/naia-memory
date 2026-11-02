import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalAdapter, MemorySystem } from "../index.js";

async function scenario(facts: string[], request: string, deleted: string[], retained: string[] = [], reassert?: string) {
 const dir = await mkdtemp(join(tmpdir(), "named-delete-"));
 const adapter = new LocalAdapter(join(dir, "store.json"));
 const memory = new MemorySystem({adapter});
 const say = async (content: string) => { await memory.encode({role: "user", content}, {}); await memory.consolidateNow(true); };
 try {
  await memory.init();
  for (const fact of facts) await say(fact);
  await say(request);
  const stored = await adapter.semantic.getAll();
  for (const value of deleted) expect(stored.find(f => f.content.includes(value))?.status, value).toBe("archived");
  for (const value of retained) expect(stored.find(f => f.content.includes(value))?.status, value).toBe("active");
  for (const context of [{}, {deepRecall: true}, {deepRecall: true, mode: "history" as const}]) {
   const text = JSON.stringify(await memory.recall("이름 주소 직장 모임 애칭", {...context, topK: 100}));
   for (const value of deleted) expect(text).not.toContain(value);
  }
  const recent = JSON.stringify(await adapter.episode.getRecent(100));
  for (const value of deleted) expect(recent).not.toContain(value);
  if (reassert) { await say(reassert); expect(JSON.stringify(await memory.recall(reassert, {deepRecall: true, topK: 100}))).toContain(reassert); }
 } finally { await memory.close(); await rm(dir, {recursive: true, force: true}); }
}

it.each([
 ["예전에는 별무리 서점에서 일했어.", "예전 직장 이름을 지워줘.", "별무리"],
 ["주소는 강변로 15이야.", "주소를 지워줘.", "강변로 15"],
 ["예전 주소는 바람로 42이야.", "예전 주소를 지워줘.", "바람로 42"],
 ["지난달 산책로 이름은 달구름길이야.", "전에 말한 산책로 이름은 잊어줘.", "달구름길"],
 ["예전 공방 별칭은 작은별이야.", "예전 공방 별칭은 지워줘.", "작은별"],
 ["예전에는 구름모임에 다녔어.", "전에 말한 모임 이름을 지워줘.", "구름모임"],
 ["내 우산 애칭은 초록밤이야.", "내 우산 애칭을 지워줘.", "초록밤"],
 ["My garden nickname is silverleaf.", "Forget the garden nickname I told you.", "silverleaf"],
 ["I used to work at Blue Harbor.", "Forget previous workplace name.", "Blue Harbor"],
])("deletes named attribute: %s", async (fact, request, value) => scenario([fact], request, [value]));

it("handles two targets and permits a new declaration", async () => scenario(["예전에는 별무리 서점에서 일했어.", "예전 주소는 바람로 42이야."], "예전 직장 이름과 예전 주소를 지워줘.", ["별무리", "바람로 42"], [], "예전 주소는 해님로 7이야."));
it.each([
 [["내 주소는 해님로 7이야."], "예전 주소를 지워줘.", ["해님로 7"]],
 [["지난달 북쪽 산책로 이름은 꽃길이야.", "지난달 남쪽 산책로 이름은 돌길이야."], "산책로 이름을 지워줘.", ["꽃길", "돌길"]],
 [["예전에는 별무리 서점에서 일했어.", "예전에는 구름 서점에서 일했어."], "예전 직장 이름을 지워줘.", ["별무리", "구름 서점"]],
 [["내 사촌 별명은 은하수야."], "내 사촌 별명을 지워줘.", ["은하수"]],
 [["내 우산 색상은 보라색이야."], "내 우산 색상을 지워줘.", ["보라색"]],
])("fails closed: %s", async (facts, request, retained) => scenario(facts, request, [], retained));

it("shows a new value for the same named attribute while preserving the tombstone", async () => scenario(["내 우산 애칭은 초록밤이야."], "내 우산 애칭을 지워줘.", ["초록밤"], [], "내 우산 애칭은 하얀밤이야."));
it("keeps the same value under a different key and handles a value containing a conjunction syllable", async () => scenario(["내 물건은 사과야.", "내 주소는 사과야."], "사과를 지워줘.", [], ["사과"]));

it("deletes all versions of one named key and retains other keys", async () => {
 const dir = await mkdtemp(join(tmpdir(), "named-versions-"));
 const adapter = new LocalAdapter(join(dir, "store.json"));
 const memory = new MemorySystem({adapter});
 try {
  await memory.init();
  await memory.encode({role: "user", content: "내 우산 애칭은 잎새야."}, {}); await memory.consolidateNow(true);
  const original = (await adapter.semantic.getAll()).find(f => f.content.includes("잎새"))!;
  const correction = {...original, id: "correction", content: "내 우산 애칭은 구슬이야."};
  const other = {...original, id: "other", content: "내 자전거 애칭은 보석이야."};
  await adapter.semantic.upsert(correction); await adapter.semantic.upsert(other);
  await memory.encode({role: "user", content: "내 우산 애칭을 지워줘."}, {}); await memory.consolidateNow(true);
  const facts = await adapter.semantic.getAll();
  expect(facts.find(f => f.id === original.id)?.status).toBe("archived");
  expect(facts.find(f => f.id === correction.id)?.status).toBe("archived");
  expect(facts.find(f => f.id === other.id)?.status).toBe("active");
 } finally { await memory.close(); await rm(dir, {recursive: true, force: true}); }
});

it("retains attribute tombstones on reload while allowing a new value", async () => {
 const dir = await mkdtemp(join(tmpdir(), "named-reload-"));
 const path = join(dir, "store.json");
 let adapter = new LocalAdapter(path), memory = new MemorySystem({adapter});
 try {
  await memory.init();
  for (const content of ["내 우산 애칭은 잎새야.", "내 우산 애칭을 지워줘."]) { await memory.encode({role: "user", content}, {}); await memory.consolidateNow(true); }
  await memory.close();
  adapter = new LocalAdapter(path); memory = new MemorySystem({adapter}); await memory.init();
  await memory.encode({role: "user", content: "내 우산 애칭은 구슬이야."}, {}); await memory.consolidateNow(true);
  const text = JSON.stringify(await memory.recall("우산 애칭", {deepRecall: true, mode: "history", topK: 100}));
  expect(text).not.toContain("잎새"); expect(text).toContain("구슬");
  expect(JSON.stringify(await adapter.episode.getRecent(100))).toContain("구슬");
  expect(adapter.getStore().scopedTombstones).toHaveLength(1);
 } finally { await memory.close(); await rm(dir, {recursive: true, force: true}); }
});
