import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalAdapter, MemorySystem, heuristicFactExtractor } from "../index.js";
import type { Episode } from "../types.js";

function episode(content: string): Episode {
 return { id: "one", content, role: "user", summary: content, timestamp: Date.now(), importance: { importance: 0, surprise: 0, emotion: 0, utility: 0 }, encodingContext: {}, consolidated: false, recallCount: 0, lastAccessed: Date.now(), strength: 0 };
}

describe("heuristic proposition extraction", () => {
 it("splits Korean residence, occupation and past workplace", async () => {
  const facts = await heuristicFactExtractor([episode("나는 가상시에 살아. 지도 복원가이고, 예전에는 가상서점에서 일했어.")]);
  expect(facts.map(f => f.content)).toHaveLength(3);
  expect(facts.map(f => f.attribute)).toEqual(["residence", "occupation", "past_workplace"]);
 });
 it("splits English clauses and retains incomplete fragments", async () => {
  const facts = await heuristicFactExtractor([episode("I live in Imaginary City and I work as a map restorer. Blue.")]);
  expect(facts).toHaveLength(2);
  expect(facts[0].attribute).toBe("residence");
  expect(facts[1].content).toContain("Blue.");
 });
 it("replaces only residence after a move", async () => {
  const dir = await mkdtemp(join(tmpdir(), "split-facts-"));
  const adapter = new LocalAdapter(join(dir, "store.json"));
  const memory = new MemorySystem({ adapter, consolidationIntervalMs: 0 });
  try {
   await memory.init();
   await memory.encode({ role: "user", content: "나는 가상시에 살아. 지도 복원가이고, 예전에는 가상서점에서 일했어. 친구는 별빛시에 살아." }, {});
   await memory.consolidateNow(true);
   await memory.encode({ role: "user", content: "나 다른시로 이사했어." }, {});
   await memory.consolidateNow(true);
   const facts = await adapter.semantic.getAll();
   expect(facts.find(f => f.content.includes("가상시에"))?.status).toBe("superseded");
   const active = facts.filter(f => f.status === "active");
   expect(active.some(f => f.content.includes("다른시"))).toBe(true);
   expect(active.some(f => f.content.includes("복원가"))).toBe(true);
   expect(active.some(f => f.content.includes("가상서점"))).toBe(true);
   expect(active.some(f => f.content.includes("별빛시"))).toBe(true);
  } finally { await memory.close(); await rm(dir, { recursive: true, force: true }); }
 });
});
