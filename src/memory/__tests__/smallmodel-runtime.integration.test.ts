import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalAdapter, MemorySystem, heuristicFactExtractor } from "../index.js";
import type { FactExtractor } from "../index.js";
import { distillInsights } from "../insight-distillation.js";
import { GeminiFlashLiteContradictionFilter, VllmReasoningContradictionFilter, parseContradictionVerdicts } from "../contradiction-filter.js";

let root: string;
const systems: MemorySystem[] = [];
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "sm-memory-")); });
afterEach(async () => { for (const system of systems.splice(0)) await system.close(); await rm(root, { recursive: true, force: true }); vi.restoreAllMocks(); });
function makeSystem(options: ConstructorParameters<typeof MemorySystem>[0] = {}) {
 const adapter = new LocalAdapter(join(root, `${randomUUID()}.json`));
 const system = new MemorySystem({ consolidationIntervalMs: 0, ...options, adapter }); systems.push(system); return { system, adapter };
}
const extract = (content: string): FactExtractor => async (episodes) => episodes.map(ep => ({ content, entities: [], topics: [], importance: 0.8, sourceEpisodeIds: [ep.id] }));
const messages = [{ role: "user" as const, content: "I prefer warm tea" }];

describe("small-model integration", () => {
 it("IT-MEM-SM-01 대화 사실과 압축에 요청별 함수를 사용한다", async () => {
  const defaultExtract = vi.fn(extract("default fact")); const defaultSummary = vi.fn(async () => "default recap");
  const { system, adapter } = makeSystem({ factExtractor: defaultExtract, summarizer: defaultSummary });
  await system.encode(messages[0], {});
  const requestExtract = vi.fn(extract("warm tea preference"));
  await system.consolidateNow(true, requestExtract);
  expect((await adapter.semantic.getAll()).map(f => f.content)).toContain("warm tea preference");
  expect((await system.compact({ messages, keepTail: 0, targetTokens: 100, summarizer: async () => "request recap" })).summary.content).toBe("request recap");
  expect(requestExtract).toHaveBeenCalledOnce(); expect(defaultExtract).not.toHaveBeenCalled(); expect(defaultSummary).not.toHaveBeenCalled();
 });
 it("IT-MEM-SM-02 동시 요청의 주입과 로컬 복구를 격리한다", async () => {
  const { system, adapter } = makeSystem();
  await system.encode(messages[0], {});
  const approved: string[] = []; const localTransport = vi.fn(async () => { throw new Error("offline"); });
  const cloudTransport = vi.fn(async () => "cloud");
  let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const request: FactExtractor = async episodes => {
   approved.push("local"); entered(); await gate;
   try { await localTransport(); } catch { return heuristicFactExtractor(episodes); }
   await cloudTransport(); return [];
  };
  const competing = vi.fn(extract("other preference"));
  const first = system.consolidateNow(true, request); await started;
  const rejected = await system.consolidateNow(true, competing);
  expect(rejected.episodesProcessed).toBe(0); expect(competing).not.toHaveBeenCalled();
  const [ca, cb] = await Promise.all([
   system.compact({ messages, keepTail: 0, targetTokens: 100, summarizer: async () => { try { await localTransport(); } catch { throw new Error("offline"); } return "unreachable"; } }),
   system.compact({ messages, keepTail: 0, targetTokens: 100, summarizer: async () => "other recap" }),
  ]);
  release(); const result = await first;
  expect(result.factsCreated).toBe(1); expect(approved).toEqual(["local"]); expect(localTransport).toHaveBeenCalledTimes(2); expect(cloudTransport).not.toHaveBeenCalled();
  expect((await adapter.semantic.getAll())[0].content).toBe(messages[0].content);
  expect(ca.summary.content).toContain("tea"); expect(cb.summary.content).toBe("other recap");
 });
 it("IT-MEM-SM-03 실패 재시도 후 사실 중복과 민감 기록을 막는다", async () => {
  const { system, adapter } = makeSystem({ consolidationIntervalMs: 1 }); const message = "sensitive private tea preference"; const sensitiveMarker = "credential-private-test";
  const logs = [vi.spyOn(console, "warn").mockImplementation(() => {}), vi.spyOn(console, "error").mockImplementation(() => {}), vi.spyOn(console, "log").mockImplementation(() => {})];
  await system.encode({ role: "user", content: message }, {});
  await expect(system.consolidateNow(true, async () => { throw new Error(sensitiveMarker); })).rejects.toThrow(sensitiveMarker);
  expect(await adapter.semantic.getAll()).toHaveLength(0);
  await system.consolidateNow(true, extract(message));
  await system.encode({ role: "user", content: message }, {});
  const replay = await system.consolidateNow(true, extract(message)); expect(replay.episodesProcessed).toBe(1);
  expect((await adapter.semantic.getAll()).filter(f => f.content === message)).toHaveLength(1);
  expect((await system.recall("tea", { topK: 10 })).facts.some(f => f.content === message)).toBe(true);
  await system.compact({ messages: [{ role: "user", content: message }], keepTail: 0, targetTokens: 100, summarizer: async () => { throw new Error(`${sensitiveMarker} ${message}`); } });
  vi.spyOn(adapter.semantic, "getAll").mockRejectedValue(new Error(`${sensitiveMarker} ${message}`));
  await distillInsights(adapter, Date.now());
  await system.consolidateNow(true, extract(message));
  vi.stubEnv("NAIA_FILTER_DEBUG", "1");
  parseContradictionVerdicts(JSON.stringify({ "1": { contradiction: true, confidence: 0.9, reason: `${sensitiveMarker} ${message}` } }), [{ existing: { content: "old", entities: [] } as any, newInfo: "new" }], 0, 0.5, "test");
  parseContradictionVerdicts(JSON.stringify({ "1": { contradiction: `${sensitiveMarker} ${message}`, confidence: 0.9 } }), [{ existing: { content: "old", entities: [] } as any, newInfo: "new" }], 0, 0.5, "test");
  vi.unstubAllEnvs();
  const failingFetch = vi.fn(async () => { throw new Error(`${sensitiveMarker} ${message}`); });
  vi.stubGlobal("fetch", failingFetch);
  const candidates = [{ existing: { content: "old", entities: [] } as any, newInfo: "new" }];
  await new GeminiFlashLiteContradictionFilter({ apiKey: "test", baseURL: "https://fake.invalid" }).filter(candidates);
  await new VllmReasoningContradictionFilter({ baseURL: "https://fake.invalid" }).filter(candidates);
  expect(failingFetch).toHaveBeenCalledTimes(2); vi.unstubAllGlobals();
  vi.useFakeTimers();
  vi.spyOn(system, "consolidateNow").mockRejectedValue(new Error(`${sensitiveMarker} ${message}`));
  system.startConsolidation(); await vi.advanceTimersByTimeAsync(1); system.stopConsolidation(); vi.useRealTimers();
  const logged = JSON.stringify(logs.flatMap(log => log.mock.calls)); expect(logged).not.toContain(sensitiveMarker); expect(logged).not.toContain(message);
 });
});
