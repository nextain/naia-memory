/** Flashbulb = emotional AROUSAL (either valence), not positive valence only.
 *  Regression for the local-adapter fix: a STRONG NEGATIVE (grief) memory now
 *  flashbulbs (surfaces at low similarity), while a NEUTRAL one does not — and the
 *  previous positive-valence behavior is preserved. LocalAdapter = the default path. */
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { MemorySystem } from "../index.js";
import { LocalAdapter } from "../adapters/local.js";

describe("Flashbulb by arousal (LocalAdapter — grief flashbulbs too)", () => {
  let memory: MemorySystem;
  let adapter: LocalAdapter;

  beforeEach(async () => {
    const storePath = join(mkdtempSync(join(tmpdir(), "flashbulb-arousal-")), "store.json");
    adapter = new LocalAdapter({ storePath });
    memory = new MemorySystem({ adapter });
    await memory.init();
  });

  const factWith = (content: string, maxEmotion: number) => ({
    id: randomUUID(), content, entities: [], topics: ["personal"],
    createdAt: Date.now() - 500, updatedAt: Date.now() - 500,
    importance: 0.9, maxEmotion, recallCount: 0, lastAccessed: Date.now() - 500,
    strength: 0.9, status: "active" as const, sourceEpisodes: [],
    encodingContext: { project: "personal" },
  });

  it("STRONG NEGATIVE (grief, valence 0.05 → arousal 0.9) flashbulbs at low similarity", async () => {
    await adapter.semantic.upsert(factWith("13년 함께한 강아지 마루를 떠나보낸 날, 하루 종일 울었다.", 0.05));
    const result = await memory.recall("내일 회의 자료 준비해야지.", { project: "personal", topK: 5 });
    const found = result.facts.find((f) => f.content.includes("마루"));
    expect(found, "grief memory should flashbulb (arousal-based), previously positive-only").toBeDefined();
  });

  it("NEUTRAL (valence 0.5 → arousal 0) does NOT flashbulb an irrelevant memory", async () => {
    await adapter.semantic.upsert(factWith("어제는 날씨가 맑았다.", 0.5));
    const result = await memory.recall("내일 점심 메뉴 추천해줘.", { project: "personal", topK: 5 });
    expect(result.facts.find((f) => f.content.includes("날씨"))).toBeUndefined();
  });

  it("STRONG POSITIVE (triumph, valence 0.95 → arousal 0.9) still flashbulbs (backward-compatible)", async () => {
    await adapter.semantic.upsert(factWith("10년 만에 마라톤을 완주한 순간, 벅차서 눈물이 났다.", 0.95));
    const result = await memory.recall("주말에 뭐 하지.", { project: "personal", topK: 5 });
    expect(result.facts.find((f) => f.content.includes("마라톤"))).toBeDefined();
  });
});
