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
 const forms = ["청동나침반을 지워줘", "청동나침반을 지워", "청동나침반을 지워주세요", "청동나침반을 지워줄래", "청동나침반을 잊어줘", "청동나침반을 잊어주세요", "청동나침반을 잊어버려", "청동나침반을 삭제해줘", "청동나침반을 삭제해 줘", "청동나침반을 삭제해주세요", "청동나침반을 삭제해", "forget 'bronze compass'", "delete 'bronze compass'", "remove that 'bronze compass'", "please erase 'bronze compass'!", "서울을 기억하지 마", "청동나침반을 기억하지 마", "청동나침반을 기억하지 말아줘", "청동나침반을 기억 안 해도 돼", "don't remember 'bronze compass'", "do not remember 'bronze compass'"];
 for (const content of forms) {
  const ep = { id: "a", role: "user" as const, content, summary: content, timestamp: 1, importance: { importance: 1, surprise: 0, emotion: 0.5, utility: 1 }, encodingContext: {}, consolidated: false, recallCount: 0, lastAccessed: 1, strength: 1 };
  const result = await heuristicFactExtractor([ep]);
  expect(result[0].operation).toBe("delete");
  expect(result[0].deleteEvidence?.targetQuote).toBe(content.includes("bronze") ? "bronze compass" : content.includes("서울") ? "서울" : "청동나침반");
 }
});

it("classifies the deletion target attribute", async () => {
 const {heuristicFactExtractor} = await import("../memory-system-api.js");
 const content = "서울에 살아를 잊어줘";
 const episode = {id: "a", role: "user" as const, content, summary: content, timestamp: 1, importance: {importance: 1, surprise: 0, emotion: 0.5, utility: 1}, encodingContext: {}, consolidated: false, recallCount: 0, lastAccessed: 1, strength: 1};
 expect((await heuristicFactExtractor([episode]))[0].attribute).toBe("residence");
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

it("rejects a unique unrelated semantic candidate", async () => {
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
  expect(facts.find(f => f.content.includes("금빛별"))?.status).toBe("active");
  expect(facts.find(f => f.content.includes("파란달"))?.status).toBe("active");
  expect(adapter.getStore().scopedTombstones ?? []).toHaveLength(0);
 } finally { await memory.close(); await rm(dir, {recursive: true, force: true}); }
});

 it("rejects negation, questions, descriptions, and quoted commands", async () => {
 const { heuristicFactExtractor } = await import("../memory-system-api.js");
 const forms = ["delete.", "forget!", "Do not delete my backup.", "Don't forget my address.", "서울을 지우지 마", "서울을 지워야 할까?", "어제 서울 기억을 지웠어", "서울을 잊지 마", "don't forget Seoul", "기억하지 마가 무슨 뜻이야?", "서울을 기억하지 말라는 설명이야", '"서울을 기억하지 마"', "서울을 삭제하지 마", "서울 말고 부산을 지워줘", "Never delete my address", "Please do not delete my address", "How do I delete my address?", '"서울을 지워줘"', '"delete my address"'];
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

it("hides only processed deletion request episodes across retrieval paths", async () => {
 const dir = await mkdtemp(join(tmpdir(), "delete-request-"));
 let adapter = new LocalAdapter(join(dir, "store.json"));
 let memory = new MemorySystem({adapter});
 try {
  await memory.init();
  await memory.encode({role: "user", content: "내 물건은 청동나침반이야."}, {}); await memory.consolidateNow(true);
  const request = await memory.encode({role: "user", content: "청동나침반을 잊어줘"}, {}); await memory.consolidateNow(true);
  for (const context of [{}, {deepRecall: true}, {deepRecall: true, mode: "history" as const}]) {
   expect((await memory.recall("청동나침반", {...context, topK: 100})).episodes.map(e => e.id)).not.toContain(request.id);
   expect((await adapter.episode.recall("청동나침반", {...context, topK: 100})).map(e => e.id)).not.toContain(request.id);
  }
  expect((await adapter.episode.getRecent(100)).map(e => e.id)).not.toContain(request.id);
  const missing = await memory.encode({role: "user", content: "없는물건을 잊어줘"}, {}); await memory.consolidateNow(true);
  expect((await adapter.episode.getRecent(100)).map(e => e.id)).toContain(missing.id);
  await memory.close();
  adapter = new LocalAdapter(join(dir, "store.json")); memory = new MemorySystem({adapter}); await memory.init();
  expect((await adapter.episode.getRecent(100)).map(e => e.id)).not.toContain(request.id);
 } finally { await memory.close(); await rm(dir, {recursive: true, force: true}); }
});

for (const scenario of ["ambiguous", "project", "relative", "below", "literal", "error", "attribute"] as const) {
 it(`applies semantic deletion safeguards: ${scenario}`, async () => {
  const dir = await mkdtemp(join(tmpdir(), "delete-semantic-"));
  const embedder = {name: "test", dims: 2, embeddingSpaceId: "semantic-test", embed: async (s: string) => {
   if (scenario === "error" && s === "가상의대상") throw new Error("test");
   return [1, 0];
  }, embedBatch: async (texts: string[]) => texts.map(s => scenario === "below" && s.includes("금빛별") ? [0.84, Math.sqrt(1 - 0.84 ** 2)] : [1, 0])};
  const adapter = new LocalAdapter({storePath: join(dir, "store.json"), embeddingProvider: embedder});
  const memory = new MemorySystem({adapter});
  const say = async (content: string, project = "A") => { await memory.encode({role: "user", content}, {project}); await memory.consolidateNow(true); };
  try {
   await memory.init();
   await say(scenario === "relative" ? "내 사촌은 금빛별에 살아." : "내 물건은 금빛별이야.", scenario === "project" ? "B" : "A");
   if (scenario === "ambiguous") await say("내 물건은 파란달이야.");
   if (scenario === "literal") await say("내 물건은 가상대상이야.");
   if (scenario === "attribute") {
    const facts = await adapter.semantic.getAll();
    expect(await adapter.tombstones.match("가상의대상", facts, "잊어줘", "residence")).toHaveLength(0);
   } else {
    await say(scenario === "literal" ? "가상대상을 잊어줘" : "가상의대상을 잊어줘");
    const facts = await adapter.semantic.getAll();
    expect(facts.find(f => f.content.includes("금빛별"))?.status).toBe("active");
    if (scenario === "literal") expect(facts.find(f => f.content.includes("가상대상"))?.status).toBe("archived");
    else expect(adapter.getStore().scopedTombstones ?? []).toHaveLength(0);
   }
  } finally { await memory.close(); await rm(dir, {recursive: true, force: true}); }
 });
}

 it("does not delete a unique candidate with overlapping value spelling", async () => {
 const dir = await mkdtemp(join(tmpdir(), "delete-overlap-"));
 const embedder = {name: "test", dims: 2, embeddingSpaceId: "overlap", embed: async () => [1, 0], embedBatch: async (texts: string[]) => texts.map(() => [0.9, Math.sqrt(1 - 0.9 ** 2)])};
 const adapter = new LocalAdapter({storePath: join(dir, "store.json"), embeddingProvider: embedder});
 const memory = new MemorySystem({adapter});
 try {
  await memory.init();
  for (const content of ["내 물건은 청동나침반이야.", "청동나침바를 지워줘"]) { await memory.encode({role: "user", content}, {}); await memory.consolidateNow(true); }
  expect((await adapter.semantic.getAll()).find(f => f.content.includes("청동나침반"))?.status).toBe("active");
 } finally { await memory.close(); await rm(dir, {recursive: true, force: true}); }
});

it("recognizes bare Korean imperatives without accepting questions or negation", async () => {
 const {deletionTarget} = await import("../delete-tombstone.js");
 for (const command of ["청동나침반을 잊어", "청동나침반을 잊어버려~", "청동나침반을 지워!", "청동나침반을 삭제해."]) expect(deletionTarget(command), command).toBe("청동나침반");
 for (const text of ["청동나침반을 잊어?", "청동나침반을 잊어도 돼?", "청동나침반을 잊어버렸어", "청동나침반을 잊어서", "청동나침반을 잊어야 하나", "청동나침반 잊지 마", "청동나침반 안 잊어", '"잊어"라고 했어']) expect(deletionTarget(text), text).toBeNull();
 const dir = await mkdtemp(join(tmpdir(), "delete-bare-"));
 const adapter = new LocalAdapter(join(dir, "store.json"));
 const memory = new MemorySystem({adapter});
 try {
  await memory.init();
  for (const content of ["내 물건은 청동나침반이야.", "청동나침반을 잊어"]) { await memory.encode({role: "user", content}, {}); await memory.consolidateNow(true); }
  expect((await adapter.semantic.getAll()).find(f => f.content.includes("청동나침반이야"))?.status).toBe("archived");
 } finally { await memory.close(); await rm(dir, {recursive: true, force: true}); }
});

it("rejects standalone vague and short targets", async () => {
 const {deletionTarget} = await import("../delete-tombstone.js");
 for (const word of ["it", "that", "this", "these", "those", "them", "everything", "all", "something", "anything", "stuff", "thing", "AI"]) expect(deletionTarget(`Forget ${word}.`)).toBeNull();
 for (const word of ["그거", "그것", "이거", "이것", "저거", "저것", "그", "이", "저", "다", "전부", "모두", "뭐", "무언가", "그런 거", "그 얘기", "아까 거", "집"]) expect(deletionTarget(`${word} 잊어`)).toBeNull();
 expect(deletionTarget("Forget that bronze compass.")).toBe("bronze compass");
 expect(deletionTarget("그 청동나침반 잊어")).toBe("청동나침반");
});

it.each([["I hired a developer last year.", "Forget developer."], ["나는 2025년에 서울을 방문했어.", "서울을 잊어줘"]])("does not delete incidental mentions: %s", async (fact, request) => {
 const dir = await mkdtemp(join(tmpdir(), "delete-incidental-"));
 const adapter = new LocalAdapter(join(dir, "store.json"));
 const memory = new MemorySystem({adapter});
 try {
  await memory.init();
  await memory.encode({role: "user", content: fact}, {}); await memory.consolidateNow(true);
  const original = (await adapter.semantic.getAll()).find(f => f.content === fact)!;
  expect(original).toBeDefined();
  await memory.encode({role: "user", content: request}, {}); await memory.consolidateNow(true);
  expect((await adapter.semantic.getAll()).find(f => f.id === original.id)?.status).toBe("active");
  expect(adapter.getStore().scopedTombstones ?? []).toHaveLength(0);
 } finally { await memory.close(); await rm(dir, {recursive: true, force: true}); }
});

it("rejects a relative's target even with identical embeddings", async () => {
 const dir = await mkdtemp(join(tmpdir(), "delete-relative-target-"));
 const embeddingProvider = {name: "constant", dims: 2, embeddingSpaceId: "constant", embed: async () => [1, 0], embedBatch: async (texts: string[]) => texts.map(() => [1, 0])};
 const adapter = new LocalAdapter({storePath: join(dir, "store.json"), embeddingProvider});
 const memory = new MemorySystem({adapter});
 try {
  await memory.init();
  for (const content of ["I live in Seoul.", "Forget my cousin's Seoul."]) { await memory.encode({role: "user", content}, {}); await memory.consolidateNow(true); }
  expect((await adapter.semantic.getAll()).find(f => f.content === "I live in Seoul.")?.status).toBe("active");
  expect(adapter.getStore().scopedTombstones ?? []).toHaveLength(0);
 } finally { await memory.close(); await rm(dir, {recursive: true, force: true}); }
});

it.each([false, true])("requires a verifier for a spelling error: verifier=%s", async (verified) => {
 const dir = await mkdtemp(join(tmpdir(), "delete-typo-"));
 const embeddingProvider = {name: "constant", dims: 2, embeddingSpaceId: "constant", embed: async () => [1, 0], embedBatch: async (texts: string[]) => texts.map(() => [1, 0])};
 const adapter = new LocalAdapter({storePath: join(dir, "store.json"), embeddingProvider});
 const memory = new MemorySystem({adapter, ...(verified ? {
  deleteVerifier: async (_episode, _fact, candidates) => ({authorized: true as const, targetFactId: candidates[0].id}),
  factExtractor: async episodes => episodes.map(episode => {
   const deleting = episode.content.startsWith("Forget");
   return {content: episode.content, entities: [], topics: [], importance: 0.8, sourceEpisodeIds: [episode.id],
    structured: {subject: "user", subjectId: "person:self", property: "thing", propertyId: "possession:thing", value: deleting ? "bronze compas" : "bronze compass", polarity: "affirmed" as const, cardinality: "single" as const},
    operation: deleting ? "delete" as const : "upsert" as const,
    ...(deleting ? {deleteEvidence: {kind: "explicit_removal_request" as const, evidenceQuote: episode.content, targetQuote: "bronze compas"}} : {})};
  }),
 } : {})});
 try {
  await memory.init();
  for (const content of ["My thing is a bronze compass.", "Forget bronze compas."]) { await memory.encode({role: "user", content}, {}); await memory.consolidateNow(true); }
  expect((await adapter.semantic.getAll()).find(f => f.content === "My thing is a bronze compass.")?.status).toBe(verified ? "archived" : "active");
  expect(adapter.getStore().scopedTombstones ?? []).toHaveLength(verified ? 1 : 0);
 } finally { await memory.close(); await rm(dir, {recursive: true, force: true}); }
});


it.each([
 ["내 물건은 청동나침반이야.", "청동 나침반을 잊어줘"],
 ["My thing is a bronze-compass.", "Forget bronze compass."],
 ["I live in Seoul.", "Forget the Seoul."],
 ["나는 서울에 살아.", "서울을 잊어줘"],
])("deletes normalized values: %s", async (fact, request) => {
 const dir = await mkdtemp(join(tmpdir(), "delete-normalized-"));
 const adapter = new LocalAdapter(join(dir, "store.json"));
 const memory = new MemorySystem({adapter});
 try {
  await memory.init();
  for (const content of [fact, request]) { await memory.encode({role: "user", content}, {}); await memory.consolidateNow(true); }
  expect((await adapter.semantic.getAll()).find(f => f.content === fact)?.status).toBe("archived");
 } finally { await memory.close(); await rm(dir, {recursive: true, force: true}); }
});
