import { describe, expect, it } from "vitest";
import { heuristicFactExtractor } from "../memory-system-api.js";
import type { Episode } from "../types.js";

function episode(content: string): Episode {
 return { id: "1", content, role: "user", summary: content, timestamp: Date.now(), importance: { importance: 0, surprise: 0, emotion: 0.5, utility: 0 }, encodingContext: {}, consolidated: false, recallCount: 0, lastAccessed: Date.now(), strength: 0 };
}
describe("default extraction", () => {
 it("retains dated experiences", async () => {
  const facts = await heuristicFactExtractor([episode("4월 10일에 내가 망원경 렌즈를 닦았어.")]);
  expect(facts.some(f => f.content.includes("렌즈"))).toBe(true);
 });
});

import { LocalAdapter } from "../adapters/local.js";
import { MemorySystem } from "../index.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
it("consolidates a dated first-person experience", async () => {
 const dir = await mkdtemp(join(tmpdir(), "default-path-"));
 const adapter = new LocalAdapter(join(dir, "store.json"));
 const memory = new MemorySystem({ adapter });
 try {
  await memory.init();
  await memory.encode({ role: "user", content: "4월 10일에 내가 현미경 렌즈를 닦았고, 4월 12일에 관찰 기록을 정리했어." }, {});
  await memory.consolidateNow(true);
  expect((await adapter.semantic.getAll()).some(f => f.status === "active" && f.content.includes("렌즈"))).toBe(true);
  expect((await adapter.semantic.getAll()).some(f => f.status === "active" && f.content.includes("관찰 기록"))).toBe(true);
 } finally { await memory.close(); await rm(dir, { recursive: true, force: true }); }
});

it("does not inherit the first person when the next clause names another subject", async () => {
 const dir = await mkdtemp(join(tmpdir(), "default-path-subject-"));
 const adapter = new LocalAdapter(join(dir, "store.json"));
 const memory = new MemorySystem({ adapter });
 try {
  await memory.init();
  await memory.encode({ role: "user", content: "4월 10일에 내가 현미경 렌즈를 닦았고, 친구는 4월 12일에 관찰 기록을 정리했어." }, {});
  await memory.consolidateNow(true);
  const active = (await adapter.semantic.getAll()).filter(f => f.status === "active");
  expect(active.some(f => f.content.includes("렌즈"))).toBe(true);
  expect(active.some(f => f.content.includes("관찰 기록"))).toBe(false);
 } finally { await memory.close(); await rm(dir, { recursive: true, force: true }); }
});
