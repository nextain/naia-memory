import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalAdapter, MemorySystem } from "../index.js";

it("forgets four values across recall paths and restores a repeated value", async () => {
 const dir = await mkdtemp(join(tmpdir(), "delete-default-"));
 const adapter = new LocalAdapter(join(dir, "store.json"));
 const memory = new MemorySystem({ adapter });
 const values = ["청동나침반", "은빛망원경", "푸른수첩", "붉은지도", "노란등불", "초록화분"];
 try {
  await memory.init();
  for (const value of values) { await memory.encode({role: "user", content: `내 물건은 ${value}이야.`}, {}); await memory.consolidateNow(true); }
  for (const value of values.slice(0, 4)) { await memory.encode({role: "user", content: `${value}을 지워줘`}, {}); await memory.consolidateNow(true); }
  for (const context of [{}, {deepRecall: true}, {mode: "history" as const}]) {
   const result = await memory.recall("물건", {...context, topK: 100});
   const text = JSON.stringify(result);
   for (const value of values.slice(0, 4)) expect(text).not.toContain(value);
   for (const value of values.slice(4)) expect(text).toContain(value);
  }
  const before = (await adapter.semantic.getAll()).filter(f => f.status === "active").length;
  await memory.encode({role: "user", content: "없는물건을 잊어줘"}, {}); await memory.consolidateNow(true);
  expect((await adapter.semantic.getAll()).filter(f => f.status === "active")).toHaveLength(before);
  await memory.encode({role: "user", content: "내 물건은 청동나침반이야."}, {}); await memory.consolidateNow(true);
  expect(JSON.stringify(await memory.recall("청동나침반", {topK: 100}))).toContain("청동나침반");
 } finally { await memory.close(); await rm(dir, {recursive: true, force: true}); }
});

it("recognizes each explicit expression and quoted targets", async () => {
 const { heuristicFactExtractor } = await import("../memory-system-api.js");
 const forms = ["청동나침반을 지워줘", "청동나침반을 지워", "청동나침반을 지워주세요", "청동나침반을 지워줄래", "청동나침반을 잊어줘", "청동나침반을 잊어주세요", "청동나침반을 잊어버려", "청동나침반을 삭제해줘", "청동나침반을 삭제해 줘", "청동나침반을 삭제해주세요", "청동나침반을 삭제해", "forget 'bronze compass'", "delete 'bronze compass'", "remove that 'bronze compass'", "please erase 'bronze compass'!"];
 for (const content of forms) {
  const ep = { id: "a", role: "user" as const, content, summary: content, timestamp: 1, importance: { importance: 1, surprise: 0, emotion: 0.5, utility: 1 }, encodingContext: {}, consolidated: false, recallCount: 0, lastAccessed: 1, strength: 1 };
  const result = await heuristicFactExtractor([ep]);
  expect(result[0].operation).toBe("delete");
  expect(result[0].deleteEvidence?.targetQuote).toBe(content.includes("bronze") ? "bronze compass" : "청동나침반");
 }
});

it("persists tombstones, preserves other subjects, and exposes removal", async () => {
 const dir = await mkdtemp(join(tmpdir(), "delete-persist-"));
 const path = join(dir, "store.json");
 let adapter = new LocalAdapter(path);
 let memory = new MemorySystem({adapter});
 try {
  await memory.init();
  await memory.encode({role: "user", content: "내 물건은 청동나침반이야."}, {}); await memory.consolidateNow(true);
  const mixed = await memory.encode({role: "user", content: "청동나침반과 노란등불이 같이 있다."}, {}); await memory.consolidateNow(true);
  await memory.encode({role: "user", content: "청동나침반을 잊어줘"}, {}); await memory.consolidateNow(true);
  expect((await adapter.episode.recall("노란등불", {deepRecall: true, topK: 100})).map(e => e.id)).toContain(mixed.id);
  await memory.close();
  adapter = new LocalAdapter(path); memory = new MemorySystem({adapter}); await memory.init();
  expect(JSON.stringify(await memory.recall("청동나침반", {deepRecall: true, mode: "history"}))).not.toContain("내 물건은 청동나침반이야.");
  await memory.removeTombstone("청동나침반");
  expect(JSON.stringify(await memory.recall("청동나침반", {deepRecall: true, mode: "history", topK: 100}))).toContain("내 물건은 청동나침반이야.");
 } finally { await memory.close(); await rm(dir, {recursive: true, force: true}); }
});

it("uses the embedding threshold and hides matched source episodes", async () => {
 const dir = await mkdtemp(join(tmpdir(), "delete-vector-"));
 const vector = (s: string) => s.includes("금빛별") || s.includes("가상의대상") ? [1, 0] : [0, 1];
 const embedder = { name: "test", dims: 2, embeddingSpaceId: "test-v1", embed: async (s: string) => vector(s), embedBatch: async (texts: string[]) => texts.map(vector) };
 const adapter = new LocalAdapter({storePath: join(dir, "store.json"), embeddingProvider: embedder});
 const memory = new MemorySystem({adapter});
 try {
  await memory.init();
  await memory.encode({role: "user", content: "내 물건은 금빛별이야."}, {}); await memory.consolidateNow(true);
  await memory.encode({role: "user", content: "내 물건은 파란달이야."}, {}); await memory.consolidateNow(true);
  await memory.encode({role: "user", content: "가상의대상을 지워줘"}, {}); await memory.consolidateNow(true);
  const facts = await adapter.semantic.getAll();
  expect(facts.find(f => f.content.includes("금빛별"))?.status).toBe("archived");
  expect(facts.find(f => f.content.includes("파란달"))?.status).toBe("active");
  expect(JSON.stringify(await memory.recall("금빛별", {deepRecall: true, mode: "history", topK: 100}))).not.toContain("금빛별");
  await memory.removeTombstone("가상의대상");
  expect(JSON.stringify(await memory.recall("금빛별", {deepRecall: true, topK: 100}))).toContain("금빛별");
 } finally { await memory.close(); await rm(dir, {recursive: true, force: true}); }
});

 it("rejects negation, questions, descriptions, and quoted commands", async () => {
 const { heuristicFactExtractor } = await import("../memory-system-api.js");
 const forms = ["delete.", "forget!", "Do not delete my backup.", "Don't forget my address.", "서울을 지우지 마", "서울을 지워야 할까?", "어제 서울 기억을 지웠어", "서울을 잊지 마", "서울을 삭제하지 마", "서울 말고 부산을 지워줘", "Never delete my address", "Please do not delete my address", "How do I delete my address?", '"서울을 지워줘"', '"delete my address"'];
 for (const content of forms) {
  const ep = { id: "a", role: "user" as const, content, summary: content, timestamp: 1, importance: { importance: 1, surprise: 0, emotion: 0.5, utility: 1 }, encodingContext: {}, consolidated: false, recallCount: 0, lastAccessed: 1, strength: 1 };
  expect((await heuristicFactExtractor([ep])).every(f => f.operation !== "delete"), content).toBe(true);
 }
});

it("keeps existing facts active for rejected requests", async () => {
 const dir = await mkdtemp(join(tmpdir(), "delete-negative-"));
 const adapter = new LocalAdapter(join(dir, "store.json"));
 const memory = new MemorySystem({adapter});
 try {
  await memory.init();
  for (const content of ["I keep my backup locally.", "My address is Seoul.", "나는 서울에 살아."]) { await memory.encode({role: "user", content}, {}); await memory.consolidateNow(true); }
  const ids = (await adapter.semantic.getAll()).filter(f => f.status === "active").map(f => f.id);
  for (const content of ["Do not delete my backup.", "Don't forget my address.", "서울을 지우지 마", "서울을 지워야 할까?", "어제 서울 기억을 지웠어"]) {
   await memory.encode({role: "user", content}, {}); await memory.consolidateNow(true);
   const facts = await adapter.semantic.getAll();
   expect(ids.every(id => facts.find(f => f.id === id)?.status === "active"), content).toBe(true);
   expect(adapter.getStore().scopedTombstones ?? []).toHaveLength(0);
  }
 } finally { await memory.close(); await rm(dir, {recursive: true, force: true}); }
});
