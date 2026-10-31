import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalAdapter, MemorySystem, heuristicFactExtractor } from "../index.js";
import type { Episode, FactExtractor } from "../index.js";

const episode = { id: "ep", role: "user", content: "I prefer warm tea.", timestamp: 1, encodingContext: {}, importance: { utility: 0.7 } } as Episode;
const makeExtractor = (content: string): FactExtractor => vi.fn(async (episodes: Episode[]) => episodes.map((ep) => ({ content, entities: [], topics: [], importance: 0.7, sourceEpisodeIds: [ep.id] })));
const compactInput = { messages: [{ role: "user", content: "I like tea" }], keepTail: 0, targetTokens: 100 };

function bareSystem(defaultExtractor?: FactExtractor, summarizer?: (input: any) => Promise<string>) {
 const system = Object.create(MemorySystem.prototype) as MemorySystem;
 Object.assign(system, { _isConsolidating: false, factExtractor: defaultExtractor ?? heuristicFactExtractor, summarizer, rollingSummaries: new Map(), adapter: { episode: { getUnconsolidated: async () => [episode] } } });
 return system;
}

describe("small-model request scope", () => {
 it("UT-MEM-SM-01 요청 추출기가 생성자 추출기보다 우선한다", async () => {
  const fallback = makeExtractor("default");
  const chosen = vi.fn(async () => { throw new Error("request extractor called"); });
  const system = bareSystem(fallback);
  await expect(system.consolidateNow(true, chosen)).rejects.toThrow("request extractor called");
  expect(chosen).toHaveBeenCalledOnce(); expect(fallback).not.toHaveBeenCalled();
  const defaultCall = vi.fn(async () => { throw new Error("default called"); });
  await expect(bareSystem(defaultCall).consolidateNow(true)).rejects.toThrow("default called");
  expect(defaultCall).toHaveBeenCalledOnce();
  expect((await heuristicFactExtractor([episode]))[0].content).toBe(episode.content);
  const root = await mkdtemp(join(tmpdir(), "sm-unit-"));
  const adapter = new LocalAdapter(join(root, "store.json"));
  const real = new MemorySystem({ adapter, consolidationIntervalMs: 0 });
  try {
   await real.encode({ role: "user", content: "I prefer warm tea" }, {});
   await real.consolidateNow(true);
   expect((await adapter.semantic.getAll()).map(f => f.content)).toContain("I prefer warm tea");
  } finally { await real.close(); await rm(root, { recursive: true, force: true }); }
 });
 it("UT-MEM-SM-02 요청 요약기 우선과 기존 요약 복구", async () => {
  const fallback = vi.fn(async () => "default summary");
  const system = bareSystem(undefined, fallback);
  const request = vi.fn(async () => "request summary");
  expect((await system.compact({ ...compactInput, summarizer: request })).summary.content).toBe("request summary");
  expect(fallback).not.toHaveBeenCalled();
  expect((await system.compact(compactInput)).summary.content).toBe("default summary");
  const plain = bareSystem();
  const deterministic = await plain.compact(compactInput);
  expect((await plain.compact({ ...compactInput, summarizer: async () => { throw new Error("failure"); } })).summary.content).toBe(deterministic.summary.content);
  plain.loadRollingSummaries([{ sessionId: "s", started: 1, updated: 1, recent: [{ role: "user", content: "rolling tea", timestamp: 1 }], compressed: "older", userCount: 1, assistantCount: 0, toolCount: 0, topics: [] }]);
  const rolling = await plain.compact({ ...compactInput, sessionId: "s" });
  const failed = await plain.compact({ ...compactInput, sessionId: "s", summarizer: async () => { throw new Error("failure"); } });
  expect(failed.summary.content).toBe(rolling.summary.content); expect(failed.realtime).toBe(true);
 });
});
