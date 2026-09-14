/*
 * Offline replay (no provider calls): parse the preserved 2026-09-05 Gemini
 * extraction responses for deletion-type cases with the current parser and
 * record which deletes survive grounding and why the others are rejected.
 * Usage (from the worktree root):
 *   RECEIPTS=<path to receipts.jsonl> REQUESTS=<path to requests.jsonl> pnpm exec tsx reports/quality/delete-diagnostics-20260915/replay-gemini-first-run.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { parseLLMFactResponse } from "../../../src/memory/llm-fact-extractor.ts";

const inputs = JSON.parse(fs.readFileSync(process.env.DESIGN_INPUTS ?? "reports/quality/remaining-plan-20260905/design/memory-inputs.json", "utf8")).cases;
const receipts = fs.readFileSync(process.env.RECEIPTS, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const requests = new Map(fs.readFileSync(process.env.REQUESTS, "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((r) => [`${r.sequence}:${r.attempt}`, r]));
const targetCases = ["memory-ko-05", "memory-en-05", "memory-ja-05", "memory-ko-06", "memory-en-06", "memory-ja-06", "memory-ko-14", "memory-en-14", "memory-ja-14"];
const rows = [];
const seen = new Set();
for (const receipt of receipts) {
  if (receipt.op !== "extractor") continue;
  const body = JSON.stringify(requests.get(`${receipt.sequence}:${receipt.attempt}`)?.body ?? "");
  const item = inputs.find((c) => targetCases.includes(c.id) && c.events.filter((e) => e.operation === "encode").every((e) => body.includes(JSON.stringify(e.message.content).slice(1, -1))));
  if (!item || seen.has(item.id)) continue;
  seen.add(item.id);
  const episodes = item.events.filter((e) => e.operation === "encode").map((e, i) => ({ id: e.id, content: e.message.content, role: e.message.role, summary: e.message.content, timestamp: i, importance: { importance: 0.5, surprise: 0, emotion: 0.5, utility: 0.5 }, encodingContext: { project: e.project }, consolidated: false, recallCount: 0, lastAccessed: 0, strength: 1 }));
  const rejected = [];
  let facts = null;
  let parseError = null;
  try {
    facts = parseLLMFactResponse(JSON.parse(receipt.rawResponse), episodes, { onDeleteRejected: (f) => rejected.push(f.message) });
  } catch (error) {
    parseError = `${error.code ?? "error"}: ${String(error.message).slice(0, 120)}`;
  }
  rows.push({
    caseId: item.id,
    category: item.category,
    parseError,
    upserts: facts ? facts.filter((f) => f.operation !== "delete").length : null,
    groundedDeletes: facts ? facts.filter((f) => f.operation === "delete").length : null,
    rejectedDeletes: rejected,
  });
}
const out = { source: "2026-09-05 Gemini flash-lite first run receipts (synthetic fixtures)", replayedAt: new Date().toISOString(), rows };
fs.writeFileSync(path.join("reports/quality/delete-diagnostics-20260915", "replay-gemini-first-run.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(rows, null, 2));
