import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalAdapter } from "../adapters/local.js";
import { Mem0Adapter } from "../adapters/mem0.js";
import { MemorySystem } from "../index.js";
import type { Episode, Fact } from "../types.js";

const now = Date.now();
function episode(id: string): Episode {
 return { id, content: `apple ${id}`, summary: "apple", timestamp: now, importance: { importance: .5, surprise: 0, emotion: .5, utility: .5 }, encodingContext: {}, consolidated: false, recallCount: 0, lastAccessed: now, strength: .5 };
}
function fact(id: string): Fact {
 return { id, content: `apple ${id}`, entities: [], topics: [], importance: .5, maxEmotion: .5, strength: .5, status: "active", createdAt: now, updatedAt: now, lastAccessed: now, recallCount: 0, sourceEpisodes: [] };
}

describe("explicit memory use", () => {
 it("only reinforces selected local memories, with opt-in touch preserved", async () => {
  const path = join(tmpdir(), `mark-used-${randomUUID()}.json`);
  const adapter = new LocalAdapter(path);
  const memory = new MemorySystem({ adapter });
  try {
   await memory.init();
   for (const id of ["one", "two"]) { await adapter.episode.store(episode(id)); await adapter.semantic.upsert(fact(id)); }
   await memory.recall("apple", {}); await memory.recall("apple", {});
   expect((await adapter.episode.getRecent(10)).map(e => e.recallCount)).toEqual([0, 0]);
   expect((await adapter.semantic.getAll()).map(f => f.recallCount)).toEqual([0, 0]);
   await memory.markUsed({ episodeIds: ["one", "one"], factIds: ["two"] });
   expect((await adapter.episode.getRecent(10)).find(e => e.id === "one")?.recallCount).toBe(1);
   expect((await adapter.episode.getRecent(10)).find(e => e.id === "two")?.recallCount).toBe(0);
   expect((await adapter.semantic.getAll()).find(f => f.id === "two")?.recallCount).toBe(1);
   expect((await adapter.semantic.getAll()).find(f => f.id === "one")?.recallCount).toBe(0);
   await memory.recall("apple", { touch: true });
   expect((await adapter.episode.getRecent(10)).find(e => e.id === "two")?.recallCount).toBe(1);
   expect((await adapter.semantic.getAll()).find(f => f.id === "one")?.recallCount).toBe(1);
  } finally { await adapter.close(); await rm(path, { force: true }); }
 });
 it("tracks Mem0 results only when used or explicitly touched", async () => {
  const results = [{ id: "external", memory: "apple one", score: 1 }];
  const client = { getAll: async () => ({ results: [] }), add: async () => {}, search: async () => ({ results }) };
  const adapter = new Mem0Adapter({ mem0Config: { embedder: { provider: "test", config: {} }, vectorStore: { provider: "test", config: {} }, llm: { provider: "test", config: {} } }, memoryFactory: async () => client });
  await adapter.episode.store(episode("one"));
  expect((await adapter.episode.recall("apple", {}))[0].recallCount).toBe(0);
  expect((await adapter.episode.recall("apple", {}))[0].recallCount).toBe(0);
  expect((await adapter.semantic.search("apple", 5))[0].recallCount).toBe(0);
  await adapter.markUsed({ episodeIds: ["one"], factIds: ["external"] });
  expect((await adapter.episode.recall("apple", {}))[0].recallCount).toBe(1);
  expect((await adapter.semantic.search("apple", 5))[0].recallCount).toBe(1);
  expect((await adapter.episode.recall("apple", { touch: true }))[0].recallCount).toBe(2);
  expect((await adapter.semantic.search("apple", 5, false, { touch: true }))[0].recallCount).toBe(2);
  results[0].memory = "orange unknown";
  const synthetic = (await adapter.episode.recall("orange", {}))[0];
  expect(synthetic.recallCount).toBe(0);
  await adapter.markUsed({ episodeIds: [synthetic.id] });
  expect((await adapter.episode.recall("orange", {}))[0].recallCount).toBe(1);
 });
});
