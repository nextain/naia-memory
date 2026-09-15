/*
 * candidate-kc-20260915 — Korean confirmation runs on the second sealed held-out
 * set (reports/quality/ko-confirm-20260915), comparing the product before the
 * 2026-09-15 rules (70dc147) with the product after them plus R3 (366141b).
 *
 * Changes from candidate-ko (and only these):
 *   1. Design directory is the confirmation set; manifest sha pinned at freeze.
 *   2. Run ids candidate-kc-before-20260915 / candidate-kc-after-20260915.
 *   3. Observation only: trace lineage facts also carry the structured value
 *      so the fact-state script can match on it before falling back to text.
 *
 * candidate-ko header follows.
 *
 * candidate-ko-20260915 — Korean held-out proof runs (reports/quality/ko-heldout-20260915).
 * Two registered runs pair the product before the 2026-09-15 rules (70dc147)
 * with the product after them (a0dd0b5: supersession rules, deletion rules,
 * episode exclude filter) on 84 sealed Korean cases.
 *
 * Changes from az6 (and only these):
 *   1. Design directory is the sealed Korean held-out set; manifest sha pinned.
 *   2. Arms: no-memory, simple-vector, naia (heuristic contradiction filter),
 *      naia-llm-filter (product LLM contradiction filter class pointed at Azure
 *      gpt-5-4-nano). naia-no-kg-spreading is dropped.
 *   3. Run ids candidate-ko-before-20260915 (live extraction, sealed) and
 *      candidate-ko-after-20260915 (extraction replayed from the before run).
 *      Delete verification is live in both (candidate sets differ by product).
 *   4. Contradiction-filter calls are ledgered under their own operation; any
 *      silent heuristic fallback of the LLM filter aborts capture.
 *
 * az6 header follows.
 *
 * candidate-az6-20260915 — episode filter remeasure (branch
 * feat/episode-filter-remeasure on feat/delete-rule). Two registered runs:
 * az6a excludes retired episodes from latest recall (a0dd0b5), az6b moves them
 * after current episodes (28addfe + test c2d66ec).
 *
 * Changes from az4 (and only these):
 *   1. Run ids candidate-az6a-20260915 and candidate-az6b-20260915.
 *   2. Replay covers delete verification too: the sealed az4 responses answer
 *      both extraction and delete-verification requests (keyed by operation,
 *      case and exact request messages). A miss aborts capture. Only answers
 *      and judge are live, so store states equal az4 by construction.
 *   3. Extraction gate is N/A when no physical extraction call was made, and
 *      delete-ungrounded diagnostics are counted separately from failures.
 *   4. Observation only: rankingDiagnostics adds retired-episode counts
 *      computed on latest-mode rows only (az3 counted all modes by mistake).
 *
 * az4 header follows.
 *
 * candidate-az4-20260915 — deletion reachability run (branch feat/delete-rule,
 * built on feat/supersession-precision), same extraction replay as az5.
 *
 * Changes from az5 (and only these):
 *   1. One registered run id, candidate-az4-20260915.
 *   2. Observation only: each delete-verification call records which branch
 *      produced each candidate (structured / structured-label / string-exact)
 *      in the receipt and the raw provider log.
 *
 * az5 header follows.
 *
 * candidate-az5-20260915 — supersession precision runs (branch
 * feat/supersession-precision), measured by replaying the sealed az3
 * extraction responses so extraction nondeterminism cannot confound them.
 *
 * Changes from az3 (and only these):
 *   1. --run-id selects one of two registered runs: az5a (same-episode rule
 *      only, product ed738df) and az5b (same-episode rule and category
 *      identity rule, product 6486fd6). The episode filter of az3 is reverted.
 *   2. --replay-extraction <file>: every extraction request is answered from
 *      the sealed az3 capture-raw-provider.jsonl, keyed by case and the exact
 *      request messages. A missing key aborts capture; nothing falls through to
 *      a live call. Delete verification, answers and judge stay live.
 *   3. The episode-filter diagnostics are removed; lineage stays in the trace.
 *
 * az3 header follows.
 *
 * candidate-az3-20260915 — candidate-az2-20260915 runner on the latest-mode
 * retired-episode filter (branch feat/latest-episode-lifecycle-filter).
 *
 * Changes from az2 (and only these):
 *   1. RUN_ID.
 *   2. Observation only: each capture row's trace keeps fact lineage (id,
 *      status, validTo, sourceEpisodes) and episode timestamps, outside the
 *      judge payload so judge input stays as in az2. score.rankingDiagnostics
 *      adds episodeRank1, retiredEpisodeInRanked, retiredEpisodesTotal and
 *      anchorOrderMismatches for the preregistered predictions.
 * The product source differs from az2 only by the episode filter commit.
 *
 * Original az2 header follows.
 *
 * candidate-az2-20260915 — corrected rerun of candidate-az1-20260915.
 *
 * Changes from az1 (and only these):
 *   1. recall receives atTimestamp only for queries whose mode is "at-time".
 *      az1 (inherited from candidate-e) passed it for all 57 queries, which
 *      sends latest queries down the valid-at-time path and skips the
 *      active-only filter: 16 naia rows ranked a superseded fact first.
 *   2. Raw answer text and raw judge text are preserved.
 *   3. Judge validation failures keep the raw response.
 *   4. score reports ranking diagnostics (superseded fact at rank 1, active
 *      successor absent) so the preregistered prediction can be checked.
 *   5. Observation only: raw extraction and delete-verification provider
 *      responses go to capture-raw-provider.jsonl (sealed), and each capture
 *      row keeps the consolidateNow return value. No behaviour change.
 *
 * Original header of az1 follows.
 *
 * candidate-az1-20260915 — lean memory quality runner (Azure Foundry).
 *
 * Why this file exists: the frozen design in
 * reports/quality/remaining-plan-20260905/design/ was never executed against a
 * real provider. The previous runner (candidate-e, 5,590 lines) is bound to the
 * Gemini native countTokens/embedContent API and an eight-bucket ledger. The
 * owner chose Azure Foundry credit instead of Gemini and asked for something
 * fast and simple. This runner keeps the design's fixtures, gold, rubric,
 * arms and thresholds unchanged and reimplements only the execution path.
 * Pure helpers copied from candidate-e are marked "copied from candidate-e".
 *
 * Three subcommands, run in order:
 *   capture  runs the four arms. It never opens a gold file.
 *   judge    refuses to run unless capture has been sealed, then reads gold.
 *   score    aggregates metrics and gates from capture + judge + gold.
 *
 * Usage (from projects/naia-memory):
 *   pnpm exec tsx reports/quality/candidate-az3-20260915/run-az3.mjs capture --backend mock --per-language 2 --out <dir>
 *   AZURE_FOUNDRY_KEY=... pnpm exec tsx reports/quality/candidate-az3-20260915/run-az3.mjs capture --backend azure --out <dir>
 *   ... judge --backend azure --out <dir>
 *   ... score --out <dir>
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getEncoding } from "js-tiktoken";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const DESIGN_DIR = path.join(REPO, "reports/quality/ko-confirm-20260915/design");
const MANIFEST_SHA256 = "507307b191de2c3fc2d656c43c09febf4515c888e804e40d225603f1867b21a1";
const PREREG_PATH = path.join(HERE, "preregistration.json");

export const RUN_IDS = Object.freeze(["candidate-kc-before-20260915", "candidate-kc-after-20260915"]);
export let RUN_ID = null;
export const ARMS = Object.freeze(["no-memory", "simple-vector", "naia", "naia-llm-filter"]);
export const NAIA_ARMS = Object.freeze(["naia", "naia-llm-filter"]);
export const MODELS = Object.freeze({
  lite: "gpt-5-4-nano",
  judge: "deepseek-v4-flash",
  embedding: "multilingual-e5-base",
});
const AZURE_BASE_URL = "https://naia-azure-foundry.cognitiveservices.azure.com/openai/v1/";
const AZURE_HOST = new URL(AZURE_BASE_URL).host;
// Caps apply per stage: capture and judge each get their own Transport.
export const CAPS = Object.freeze({
  capture: Object.freeze({ requests: 1500, inputTokens: 3_000_000, outputTokens: 600_000, wallMinutes: 45 }),
  judge: Object.freeze({ requests: 300, inputTokens: 3_000_000, outputTokens: 600_000, wallMinutes: 45 }),
});
const REQUEST_TIMEOUT_MS = 60_000;
const MEMORY_CONTEXT_BUDGET = 1024;
const ANSWER_PROMPT_CEILING = 8192;
const ANSWER_OUTPUT_MAX = 512;
const JUDGE_OUTPUT_MAX = 2048;
const JUDGE_BATCH_INPUT_CEILING = 16_000;
const BOOTSTRAP_SEED = 20260905;
const BOOTSTRAP_RESAMPLES = 10_000;

const enc = getEncoding("o200k_base");
export const countTokens = (text) => enc.encode(String(text ?? "")).length;

// ── small utilities ────────────────────────────────────────────────────────
const sha256 = (value) => crypto.createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
const clone = (value) => structuredClone(value);
function assertCondition(condition, message) { if (!condition) throw new Error(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
const jsonCache = new Map();
function readJsonCached(file) { if (!jsonCache.has(file)) jsonCache.set(file, readJson(file)); return jsonCache.get(file); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n"); }
function boundedErrorText(value) {
  // copied from candidate-e
  let text = String(value ?? "provider error");
  text = text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(api[-_]?key|authorization)\s*[:=]\s*[^\s,}]+/gi, "$1=[redacted]");
  return text.slice(0, 320);
}
function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function stripVectors(value) {
  if (Array.isArray(value)) {
    if (value.length > 16 && value.every((item) => typeof item === "number")) return `[vector:${value.length}]`;
    return value.map(stripVectors);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (/^(embedding|vector|embeddings)$/i.test(key)) continue;
      out[key] = stripVectors(child);
    }
    return out;
  }
  return value;
}
function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else { out[key] = next; i += 1; }
    } else out._.push(argv[i]);
  }
  return out;
}

// ── design integrity ───────────────────────────────────────────────────────
export function verifyDesign() {
  const manifestPath = path.join(DESIGN_DIR, "manifest.sha256");
  const manifestSha = sha256(fs.readFileSync(manifestPath));
  const errors = [];
  if (manifestSha !== MANIFEST_SHA256) errors.push(`manifest sha mismatch ${manifestSha}`);
  for (const line of fs.readFileSync(manifestPath, "utf8").split("\n")) {
    const match = line.match(/^([0-9a-f]{64})\s+(.+)$/);
    if (!match) continue;
    const file = path.join(DESIGN_DIR, match[2]);
    if (!fs.existsSync(file)) { errors.push(`missing ${match[2]}`); continue; }
    if (sha256(fs.readFileSync(file)) !== match[1]) errors.push(`sha mismatch ${match[2]}`);
  }
  if (errors.length) throw new Error(`design integrity failed: ${errors.join("; ")}`);
  return manifestSha;
}

function productProvenance() {
  const git = (...a) => execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8" }).trim();
  return {
    commit: git("rev-parse", "HEAD"),
    srcDirty: git("status", "--porcelain", "--", "src") !== "",
    node: process.version,
    host: os.hostname(),
  };
}

// ── extraction replay ──────────────────────────────────────────────────────
export const REPLAYED_OPERATIONS = Object.freeze(["extraction"]);
export function replayKey(operation, caseId, messages) { return `${operation}|${caseId}|${sha256(JSON.stringify(messages))}`; }

export function loadExtractionReplay(file) {
  const replay = new Map();
  for (const line of fs.readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    const entry = JSON.parse(line);
    if (!REPLAYED_OPERATIONS.includes(entry.operation) || entry.status !== 200) continue;
    const key = replayKey(entry.operation, entry.caseId, entry.requestMessages);
    assertCondition(!replay.has(key), `duplicate recorded ${entry.operation} for ${entry.caseId}`);
    replay.set(key, { status: entry.status, responseText: entry.responseText });
  }
  return replay;
}

// ── transport: every Azure request passes through one ledgered fetch ───────
export class Transport {
  constructor({ backend, stage, apiKey = "", receiptsFile, mock = null, replay = null }) {
    assertCondition(CAPS[stage], "transport stage must be capture or judge");
    this.caps = CAPS[stage];
    assertCondition(["azure", "mock"].includes(backend), "backend must be azure or mock");
    if (backend === "azure") assertCondition(typeof apiKey === "string" && apiKey.length > 0, "AZURE_FOUNDRY_KEY is required for the azure backend");
    this.backend = backend;
    this.apiKey = apiKey;
    this.receiptsFile = receiptsFile;
    // Wall time uses the monotonic clock. Date.now is replaced by the logical
    // clock while memory arms run, so it cannot measure elapsed time.
    this.startedAt = performance.now();
    this.mock = mock;
    this.replay = replay;
    this.replayHits = 0;
    this.seq = 0;
    this.totals = { requests: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
    this.attemptsByBody = new Map();
    this.operation = "unlabelled";
    this.context = {};
    this.realFetch = globalThis.fetch;
  }

  label(operation, context = {}) { this.operation = operation; this.context = context; }

  capExceeded(estimatedInput, maxOutput) {
    if (this.totals.requests + 1 > this.caps.requests) return "requests";
    if (this.totals.inputTokens + estimatedInput > this.caps.inputTokens) return "inputTokens";
    if (this.totals.outputTokens + maxOutput > this.caps.outputTokens) return "outputTokens";
    if ((performance.now() - this.startedAt) / 60000 > this.caps.wallMinutes) return "wallMinutes";
    return null;
  }

  receipt(entry) {
    fs.appendFileSync(this.receiptsFile, JSON.stringify(entry) + "\n");
  }

  install() {
    const transport = this;
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input instanceof Request ? input.url : input);
      if (new URL(url).host !== AZURE_HOST) {
        if (transport.backend === "mock") throw new Error(`mock backend refused a non-Azure request: ${url}`);
        return transport.realFetch(input, init);
      }
      return transport.send(url, init);
    };
  }

  uninstall() { globalThis.fetch = this.realFetch; }

  async send(url, init) {
    // Product factories use `${baseURL}chat/completions` with bearer auth.
    const body = JSON.parse(String(init.body ?? "{}"));
    // Retry accounting is per logical call: operation + call context + body.
    // Identical bodies from different arms (same retrieval) are separate calls.
    const bodyHash = sha256(`${this.operation}|${JSON.stringify(this.context)}|${init.body}`);
    const attempt = (this.attemptsByBody.get(bodyHash) ?? 0) + 1;
    this.attemptsByBody.set(bodyHash, attempt);
    const localPromptTokens = (body.messages ?? []).reduce((sum, m) => sum + countTokens(typeof m.content === "string" ? m.content : JSON.stringify(m.content)), 0);
    const maxOutput = Number(body.max_completion_tokens ?? body.max_tokens ?? 0);
    const base = { seq: ++this.seq, runId: RUN_ID, operation: this.operation, ...this.context, model: body.model, bodyHash, attempt, localPromptTokens, maxOutput };
    // Contract: only non-content transport failure may be retried, once. The
    // product extractor retries 5xx up to three times on its own; the third
    // physical attempt is refused here without touching the network.
    if (this.replay && REPLAYED_OPERATIONS.includes(this.operation)) {
      const key = replayKey(this.operation, this.context.caseId, body.messages);
      const recorded = this.replay.get(key);
      if (!recorded) {
        this.replayMiss = `${this.operation} replay miss for ${this.context.caseId}; refusing a live call`;
        throw new Error(this.replayMiss);
      }
      this.replayHits += 1;
      this.receipt({ ...base, physical: false, replayed: true, status: recorded.status });
      if (this.rawProviderFile) fs.appendFileSync(this.rawProviderFile, JSON.stringify({ seq: base.seq, operation: this.operation, ...this.context, attempt, status: recorded.status, replayed: true, requestMessages: body.messages, responseText: recorded.responseText }) + "\n");
      return new Response(recorded.responseText, { status: recorded.status, headers: { "content-type": "application/json" } });
    }
    if (attempt > 2) {
      this.receipt({ ...base, status: 499, refused: "transport-retry-cap", physical: false });
      return new Response(JSON.stringify({ error: { message: "transport retry cap reached" } }), { status: 499 });
    }
    const cap = this.capExceeded(localPromptTokens, maxOutput);
    if (cap) {
      this.receipt({ ...base, status: 498, refused: `cap:${cap}`, physical: false });
      return new Response(JSON.stringify({ error: { message: `budget cap reached: ${cap}` } }), { status: 498 });
    }
    this.totals.requests += 1;
    const started = performance.now();
    let status = 0;
    let text = "";
    let error = null;
    try {
      if (this.backend === "mock") {
        const mocked = this.mock(body, this.operation, this.context);
        status = 200;
        text = JSON.stringify(mocked);
      } else {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
          const headers = { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` };
          const response = await this.realFetch(url, { method: "POST", headers, body: init.body, signal: controller.signal });
          status = response.status;
          text = await response.text();
        } finally {
          clearTimeout(timer);
        }
      }
    } catch (caught) {
      error = caught?.name === "AbortError" ? "deadline" : boundedErrorText(caught?.message ?? caught);
      status = 504;
      text = JSON.stringify({ error: { message: error } });
    }
    const ms = performance.now() - started;
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    const usage = parsed?.usage ?? {};
    const usageIn = Number(usage.prompt_tokens);
    const usageOut = Number(usage.completion_tokens);
    const reasoning = Number(usage.completion_tokens_details?.reasoning_tokens);
    this.totals.inputTokens += Number.isFinite(usageIn) ? usageIn : localPromptTokens;
    this.totals.outputTokens += Number.isFinite(usageOut) ? usageOut : maxOutput;
    if (Number.isFinite(reasoning)) this.totals.reasoningTokens += reasoning;
    const choice = parsed?.choices?.[0];
    this.receipt({
      ...base,
      physical: true,
      status,
      ms: Math.round(ms),
      usage: { prompt: Number.isFinite(usageIn) ? usageIn : null, completion: Number.isFinite(usageOut) ? usageOut : null, reasoning: Number.isFinite(reasoning) ? reasoning : null },
      finishReason: choice?.finish_reason ?? null,
      returnedModel: parsed?.model ?? null,
      contentChars: typeof choice?.message?.content === "string" ? choice.message.content.length : null,
      error: status >= 400 ? boundedErrorText(parsed?.error?.message ?? error ?? text) : null,
    });
    if (this.rawProviderFile && ["extraction", "delete-verification", "contradiction-filter"].includes(this.operation)) {
      fs.appendFileSync(this.rawProviderFile, JSON.stringify({ seq: base.seq, operation: this.operation, ...this.context, attempt, status, requestMessages: body.messages, responseText: text }) + "\n");
    }
    return new Response(text, { status, headers: { "content-type": "application/json" } });
  }

  // One logical chat call made by this runner (answer, judge). Retries once on
  // 5xx/deadline only.
  async chat(body, operation, context = {}) {
    this.label(operation, context);
    let last = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await globalThis.fetch(`${AZURE_BASE_URL}chat/completions`, { method: "POST", body: JSON.stringify(body) });
      const text = await response.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      last = { status: response.status, parsed, text };
      if (response.status < 500 || response.status === 498 || response.status === 499) break;
    }
    const choice = last.parsed?.choices?.[0];
    return {
      ok: last.status === 200 && typeof choice?.message?.content === "string",
      status: last.status,
      content: choice?.message?.content ?? null,
      finishReason: choice?.finish_reason ?? null,
      usage: last.parsed?.usage ?? null,
      error: last.status === 200 ? null : boundedErrorText(last.parsed?.error?.message ?? last.text),
    };
  }
}

// ── logical clock (copied from candidate-e) ────────────────────────────────
function toNativeTimestamp(value) {
  if (Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}
export class LogicalClock {
  constructor() { this.originalNow = Date.now; this.value = null; this.installed = false; }
  install() {
    if (this.installed) return;
    const clock = this;
    Date.now = function logicalNow() { return clock.value === null ? clock.originalNow() : clock.value; };
    this.installed = true;
  }
  set(value) {
    const timestamp = toNativeTimestamp(value);
    assertCondition(timestamp !== undefined, `invalid logical timestamp: ${value}`);
    this.value = timestamp;
    return timestamp;
  }
  now() { return this.value === null ? this.originalNow() : this.value; }
  restore() { if (!this.installed) return; Date.now = this.originalNow; this.installed = false; }
}

// ── simple vector arm (copied from candidate-e; passage/query prefixes follow the product) ──
export class SimpleVectorIndex {
  constructor({ embeddingProvider, topK = 5 }) {
    this.embeddingProvider = embeddingProvider;
    this.topK = topK;
    this.entries = [];
    this.sequence = 0;
  }
  async append({ id, content, role, project, timestamp }) {
    if (role !== "user" || !content) return false;
    // Product stores passages through embedBatch (passage prefix) and queries
    // through embed (query prefix). The baseline must receive the same space.
    const [vector] = await this.embeddingProvider.embedBatch([String(content)]);
    assertCondition(Array.isArray(vector) && vector.length > 0, "simple-vector embedding unavailable");
    this.entries.push({ id, content: String(content), role, project, timestamp: toNativeTimestamp(timestamp), order: this.sequence++, vector });
    return true;
  }
  async recall(query, { project, scopeMode = "strict", atTimestamp }) {
    const queryVector = await this.embeddingProvider.embed(query);
    const queryTime = toNativeTimestamp(atTimestamp);
    const norm = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    const qn = norm(queryVector);
    const cosine = (v) => { const n = norm(v); return n === 0 || qn === 0 ? 0 : v.reduce((s, x, i) => s + x * queryVector[i], 0) / (n * qn); };
    return this.entries
      .filter((entry) => scopeMode !== "strict" || !project || entry.project === project)
      .filter((entry) => queryTime === undefined || entry.timestamp === undefined || entry.timestamp <= queryTime)
      .map((entry) => ({ ...entry, score: cosine(entry.vector) }))
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .slice(0, this.topK)
      .map(({ vector, ...entry }) => entry);
  }
}

// ── bounded context (copied from candidate-e, counter = o200k) ─────────────
// Neutral "- " prefix for every arm. candidate-e used "[fact]"/"[episode]",
// which gives the answer model engine vocabulary that differs by arm.
const rowContent = (row) => `- ${row.content ?? ""}`.trim();
export function buildContext(ranked, budget = MEMORY_CONTEXT_BUDGET) {
  const candidates = (ranked ?? []).slice(0, 5);
  const textFor = (items) => items.map(rowContent).join("\n");
  const supplied = [];
  let tokenCount = 0;
  for (let index = 1; index <= candidates.length; index += 1) {
    const count = countTokens(textFor(candidates.slice(0, index)));
    if (count > budget) break;
    supplied.push(candidates[index - 1]);
    tokenCount = count;
  }
  return { text: textFor(supplied), supplied, tokenCount };
}

function recallRows(result) {
  // copied from candidate-e nativeRecallRows
  const rows = [];
  for (const fact of result?.facts ?? []) rows.push({ kind: "fact", id: fact.id, content: fact.content, score: fact.strength ?? fact.importance ?? null, sourceEpisodeIds: clone(fact.sourceEpisodeIds ?? fact.sourceEpisodes ?? []), project: fact.encodingContext?.project ?? fact.project ?? null });
  for (const episode of result?.episodes ?? []) rows.push({ kind: "episode", id: episode.id, content: episode.content, score: episode.score ?? null, sourceEpisodeIds: [episode.id], project: episode.encodingContext?.project ?? null });
  for (const reflection of result?.reflections ?? []) rows.push({ kind: "reflection", id: reflection.id, content: reflection.content, score: reflection.score ?? null, sourceEpisodeIds: clone(reflection.sourceEpisodeIds ?? []), project: reflection.encodingContext?.project ?? null });
  return rows;
}

// ── answer prompt: identical for all arms ──────────────────────────────────
export function answerMessages(rubric, row) {
  const tail = row.recentTail ?? [];
  return [
    { role: "system", content: `${rubric.answer_prompt} Return a JSON object {"answers": {"<question id>": "<answer>"}}.` },
    { role: "user", content: `QUESTION_ID ${row.queryId}\nQUESTION: ${row.query}\nRETRIEVED MEMORY:\n${row.contextText || "(none)"}\nRECENT CONVERSATION:\n${tail.map((m) => `${m.role}: ${m.content}`).join("\n")}` },
  ];
}

// ── capture ────────────────────────────────────────────────────────────────
async function runArm({ item, arm, memoryApi, embeddingProvider, factExtractor, deleteVerifier, llmContradictionFilter, storeRoot, clock, onRetrieval }) {
  const rows = [];
  const trace = { caseId: item.id, arm, reopens: 0, encodes: 0, consolidation: null, activeState: null };
  if (arm === "no-memory") {
    for (const event of item.events) if (event.timestamp) clock.set(event.timestamp);
    for (const query of item.queries) {
      rows.push({ queryId: query.id, query: query.text, queryTime: toNativeTimestamp(query.at_timestamp ?? clock.now()), ranked: [], supplied: [], contextText: "", contextTokens: 0, retrievalMs: 0 });
    }
    return { rows, trace };
  }
  if (arm === "simple-vector") {
    const index = new SimpleVectorIndex({ embeddingProvider, topK: 5 });
    for (const event of item.events) {
      if (event.timestamp) clock.set(event.timestamp);
      if (event.operation === "reopen") { trace.reopens += 1; continue; } // declared no-op for this arm
      if (event.operation !== "encode") continue;
      if (await index.append({ id: event.id, content: event.message?.content, role: event.message?.role ?? "user", project: event.project, timestamp: event.timestamp })) trace.encodes += 1;
    }
    for (const query of item.queries) {
      const queryTime = toNativeTimestamp(query.at_timestamp ?? clock.now());
      const started = performance.now();
      const ranked = (await index.recall(query.text, { project: query.project, scopeMode: query.scope_mode ?? "strict", ...(query.mode === "at-time" ? { atTimestamp: queryTime } : {}) }))
        .map((entry) => ({ kind: "episode", id: entry.id, content: entry.content, score: entry.score, project: entry.project, sourceEpisodeIds: [entry.id] }));
      const retrievalMs = performance.now() - started;
      const context = buildContext(ranked);
      rows.push({ queryId: query.id, query: query.text, queryTime, ranked, supplied: context.supplied, contextText: context.text, contextTokens: context.tokenCount, retrievalMs });
    }
    trace.activeState = { status: "unavailable", reason: "append-only baseline has no native semantic state" };
    return { rows, trace };
  }
  const storePath = path.join(storeRoot, `${item.id}-${arm}.json`);
  for (const candidate of [storePath, `${storePath}.tmp`]) fs.rmSync(candidate, { force: true });
  let adapter;
  let system;
  const open = async () => {
    adapter = new memoryApi.LocalAdapter({ storePath, embeddingProvider });
    system = new memoryApi.MemorySystem({
      adapter,
      factExtractor,
      deleteVerifier,
      contradictionFilter: arm === "naia-llm-filter" ? llmContradictionFilter : new memoryApi.HeuristicContradictionFilter(),
      consolidationIntervalMs: 24 * 60 * 60 * 1000,
    });
    await system.init();
  };
  await open();
  try {
    for (const event of item.events) {
      if (event.timestamp) clock.set(event.timestamp);
      if (event.operation === "reopen") {
        await system.flush();
        await system.close();
        system = null;
        trace.reopens += 1;
        await open();
        continue;
      }
      if (event.operation !== "encode") continue;
      await system.encode(
        { content: String(event.message?.content ?? ""), role: event.message?.role ?? "user", timestamp: toNativeTimestamp(event.timestamp), idempotencyKey: `${item.id}:${event.id}` },
        { project: event.project, sessionId: `memory:${item.id}` },
      );
      trace.encodes += 1;
    }
    const last = item.events.map((e) => toNativeTimestamp(e.timestamp)).filter((v) => v !== undefined).pop();
    if (last !== undefined) clock.set(last);
    trace.consolidation = stripVectors(clone(await system.consolidateNow(true)));
    await system.flush();
    // Reopen once after consolidation so recall also exercises fact
    // persistence, not only episode persistence. No provider cost.
    await system.close();
    system = null;
    await open();
    trace.postConsolidationReopen = true;
    trace.activeState = activeStateProjection(adapter.getStore());
    // Observation only (not sent to the judge): lineage for anchor diagnostics.
    trace.lineage = {
      facts: (adapter.getStore().facts ?? []).map((f) => ({ id: f.id, status: f.status ?? "active", validTo: f.validTo ?? null, sourceEpisodes: [...(f.sourceEpisodes ?? [])], value: f.structured?.value ?? null })),
      episodeTimestamps: Object.fromEntries((adapter.getStore().episodes ?? []).map((e) => [e.id, e.timestamp])),
    };
    for (const query of item.queries) {
      const queryTime = toNativeTimestamp(query.at_timestamp ?? clock.now());
      clock.set(queryTime);
      const started = performance.now();
      // az2: atTimestamp only for at-time queries (az1 passed it for all).
      const result = await system.recall(query.text, { project: query.project, topK: 5, scopeMode: query.scope_mode ?? "strict", mode: query.mode ?? "latest", ...(query.mode === "at-time" ? { atTimestamp: queryTime } : {}) });
      const retrievalMs = performance.now() - started;
      const ranked = recallRows(result);
      const context = buildContext(ranked);
      rows.push({ queryId: query.id, query: query.text, queryTime, ranked: stripVectors(ranked), supplied: stripVectors(context.supplied), contextText: context.text, contextTokens: context.tokenCount, retrievalMs });
      onRetrieval?.();
    }
  } finally {
    if (system) await system.close();
  }
  return { rows, trace };
}

// The judge needs only fact lifecycle state to decide false_overwrite. The full
// store (episodes, KG, embedding space id) is not sent.
export function activeStateProjection(store) {
  return {
    status: "available",
    facts: (store?.facts ?? []).map((fact) => ({
      id: fact.id,
      content: fact.content,
      status: fact.status ?? "active",
      project: fact.encodingContext?.project ?? null,
      validFrom: fact.validFrom ?? null,
      validTo: fact.validTo ?? null,
      supersedes: fact.supersedes ?? null,
    })),
  };
}

function sharedFactory(cache, key, factory) {
  // Both naia arms consume one physical extraction/deletion response per
  // identical input so the pair stays matched. Errors are shared too.
  return async (...callArgs) => {
    const cacheKey = `${key}|${sha256(JSON.stringify(callArgs, (_k, v) => (Array.isArray(v) && v.length > 16 && v.every((x) => typeof x === "number") ? `[vector:${v.length}]` : v)))}`;
    if (!cache.has(cacheKey)) {
      cache.set(cacheKey, factory(...callArgs).then((value) => ({ ok: true, value }), (error) => ({ ok: false, error })));
    }
    const settled = await cache.get(cacheKey);
    if (!settled.ok) throw settled.error;
    return clone(settled.value);
  };
}

function mockResponder(body, operation) {
  const content = (() => {
    if (operation === "extraction") {
      const count = (String(body.messages?.[0]?.content ?? "").match(/^\[\d+\]|Episode \d+|^\d+\./gm) ?? []).length || 1;
      return JSON.stringify(Object.fromEntries(Array.from({ length: Math.max(1, count) }, (_v, i) => [String(i + 1), []])));
    }
    if (operation === "delete-verification") return JSON.stringify({ authorized: false, kind: null, targetFactId: null });
    if (operation === "answer") return JSON.stringify({ answers: {} });
    if (operation === "judge") {
      const rows = JSON.parse(body.messages[1].content).rows;
      return JSON.stringify(Object.fromEntries(rows.map((row) => [row.id, {
        correct: false, abstained: true, unsupported: false, forbidden_asserted: false, critical_reversal: false,
        retrieval_critical_reversal: false, answer_critical_reversal: false, stale_exposure: false, deletion_leakage: false,
        project_leakage: false, current_at_1: false, current_at_5: false,
        false_overwrite: row.false_overwrite_applies ? false : null, confidence: "mock-undeclared-field",
        reason: "mock", evidence_quotes: [row.question.text],
      }])));
    }
    return "{}";
  })();
  return { model: body.model, choices: [{ finish_reason: "stop", message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
}

export async function capture(options) {
  const outDir = path.resolve(options.out);
  fs.mkdirSync(outDir, { recursive: true });
  const captureFile = path.join(outDir, "capture.jsonl");
  assertCondition(!fs.existsSync(path.join(outDir, "seal.json")), "capture already sealed; refusing to overwrite");
  for (const file of [captureFile, path.join(outDir, "receipts-capture.jsonl"), path.join(outDir, "capture-raw-provider.jsonl")]) fs.rmSync(file, { force: true });
  const manifestSha = verifyDesign();
  const provenance = productProvenance();
  assertCondition(options.backend === "mock" || provenance.srcDirty === false, "product src has uncommitted changes; commit before a provider run");
  assertCondition(RUN_IDS.includes(RUN_ID), "--run-id must be a registered Korean held-out run");
  // The before run extracts live and seals its responses; the after run must
  // replay exactly that sealed file so both products see identical extraction.
  const replayRequired = RUN_ID === "candidate-kc-after-20260915";
  assertCondition(replayRequired === (typeof options["replay-extraction"] === "string"), replayRequired ? "--replay-extraction <before run capture-raw-provider.jsonl> is required" : "the before run extracts live; do not pass --replay-extraction");
  const replayFile = replayRequired ? path.resolve(options["replay-extraction"]) : null;
  const replaySha256 = replayFile ? sha256(fs.readFileSync(replayFile)) : null;
  if (replayFile) {
    const beforeSeal = readJson(path.join(path.dirname(replayFile), "seal.json"));
    assertCondition(beforeSeal.runId === "candidate-kc-before-20260915" && beforeSeal.rawProviderSha256 === replaySha256, "replay file does not match the sealed before run");
  }
  const preregFile = options.backend === "azure" ? readJson(PREREG_PATH) : null;
  if (options.backend === "azure") assertCondition(preregFile.frozen === true && preregFile.runs?.[RUN_ID], "preregistration is not frozen for this run");
  const prereg = options.backend === "azure" ? preregFile.runs[RUN_ID] : null;
  if (options.backend === "azure") assertCondition(preregFile.runner.sha256 === sha256(fs.readFileSync(fileURLToPath(import.meta.url))), "runner differs from the registered runner");
  // The runner and preregistration are committed after the product commit, so HEAD
  // moves; what must match is the product src tree at the registered commit.
  if (options.backend === "azure") {
    let srcMatches = true;
    try { execFileSync("git", ["-C", REPO, "diff", "--quiet", prereg.product_commit_sha, "HEAD", "--", "src"], { stdio: "ignore" }); } catch { srcMatches = false; }
    assertCondition(srcMatches, "product src differs from the registered commit");
  }
  // Gold is never read in this process.
  const inputs = readJson(path.join(DESIGN_DIR, "memory-inputs.json")).cases;
  const rubric = readJson(path.join(DESIGN_DIR, "rubric.json"));
  const perLanguage = options["per-language"] ? Number(options["per-language"]) : null;
  const cases = perLanguage ? ["ko", "en", "ja"].flatMap((lang) => inputs.filter((c) => c.language === lang).slice(0, perLanguage)) : inputs;

  const memoryApi = await import(path.join(REPO, "src/memory/index.ts"));
  const filterModule = await import(path.join(REPO, "src/memory/contradiction-filter.ts"));
  const embeddingProvider = new memoryApi.OfflineEmbeddingProvider(MODELS.embedding, "cpu");
  const warmStart = performance.now();
  await embeddingProvider.embed("warmup");
  await embeddingProvider.embedBatch(["warmup"]);
  const warmupMs = performance.now() - warmStart;

  const replay = replayFile ? loadExtractionReplay(replayFile) : null;
  const transport = new Transport({ backend: options.backend, stage: "capture", apiKey: process.env.AZURE_FOUNDRY_KEY ?? "", receiptsFile: path.join(outDir, "receipts-capture.jsonl"), mock: mockResponder, replay });
  transport.rawProviderFile = path.join(outDir, "capture-raw-provider.jsonl");
  transport.install();
  const extractionFailures = [];
  const extractorFactory = memoryApi.buildLLMFactExtractor({
    apiKey: options.backend === "azure" ? process.env.AZURE_FOUNDRY_KEY : "mock",
    auth: "bearer", baseURL: AZURE_BASE_URL, model: MODELS.lite, batchSize: 10, failurePolicy: "throw",
    structuredOutput: { provider: "openai-compatible" }, maxTokensParam: "max_completion_tokens",
    onFailure: (failure) => extractionFailures.push({ caseId: transport.context.caseId, code: failure.code, message: boundedErrorText(failure.message) }),
  });
  const deleteFactory = memoryApi.buildLLMDeleteVerifier({ apiKey: options.backend === "azure" ? process.env.AZURE_FOUNDRY_KEY : "mock", auth: "bearer", baseURL: AZURE_BASE_URL, model: MODELS.judge, batchSize: 1, failurePolicy: "throw" });

  // Product LLM contradiction filter class, pointed at Azure. Its own catch
  // silently falls back to the heuristic filter; count those warnings and abort.
  let llmFilterFallbacks = 0;
  const originalWarn = console.warn;
  console.warn = (...parts) => { if (String(parts[0] ?? "").includes("ContradictionFilter]")) llmFilterFallbacks += 1; originalWarn(...parts); };
  const llmFilterFor = (item) => {
    const inner = new filterModule.GeminiFlashLiteContradictionFilter({ apiKey: options.backend === "azure" ? process.env.AZURE_FOUNDRY_KEY : "mock", baseURL: AZURE_BASE_URL, model: MODELS.lite });
    return { name: inner.name, filter: async (candidates) => { transport.label("contradiction-filter", { caseId: item.id }); return inner.filter(candidates); } };
  };
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${RUN_ID}-stores-`));
  const clock = new LogicalClock();
  const startedAt = new Date().toISOString();
  const embeddingProbe = {};
  let rowsWritten = 0;
  try {
    for (const item of cases) {
      const cache = new Map();
      const factExtractor = sharedFactory(cache, "extraction", async (...a) => { transport.label("extraction", { caseId: item.id }); return extractorFactory(...a); });
      const deleteVerifier = sharedFactory(cache, "delete", async (...a) => { transport.label("delete-verification", { caseId: item.id, candidateSources: (a[2] ?? []).map((c) => c.source ?? null) }); return deleteFactory(...a); });
      for (const arm of ARMS) {
        clock.install();
        let result = null;
        let failure = null;
        try {
          result = await runArm({ item, arm, memoryApi, embeddingProvider, factExtractor, deleteVerifier, llmContradictionFilter: llmFilterFor(item), storeRoot, clock });
        } catch (error) {
          failure = { code: error?.code ?? "engine-failure", message: boundedErrorText(error?.message ?? error) };
        } finally {
          clock.restore();
        }
        // The product turns extractor errors into an arm failure; a replay miss
        // must stop the whole capture instead.
        if (transport.replayMiss) throw new Error(transport.replayMiss);
        if (llmFilterFallbacks > 0) throw new Error(`LLM contradiction filter fell back to the heuristic ${llmFilterFallbacks} time(s) in ${item.id}; capture is invalid`);
        if (item === cases[0] && arm === "simple-vector") embeddingProbe.firstCaseQueryVectorSha = sha256((await embeddingProvider.embed(item.queries[0].text)).map((x) => x.toFixed(6)));
        const answerRows = failure
          ? item.queries.map((query) => ({ queryId: query.id, query: query.text, queryTime: null, ranked: [], supplied: [], contextText: "", contextTokens: 0, retrievalMs: null }))
          : result.rows;
        for (const row of answerRows) {
          const record = {
            rowId: `memory-answer:${item.id}:${arm}:${row.queryId}`,
            caseId: item.id, arm, language: item.language, family: item.construction_family,
            ...row, recentTail: clone(item.recent_tail ?? []),
            engineFailure: failure, trace: result?.trace ? { reopens: result.trace.reopens, encodes: result.trace.encodes, consolidation: result.trace.consolidation ?? null, lineage: result.trace.lineage ?? null } : null,
            activeState: result?.trace?.activeState ?? { status: "unavailable", reason: failure ? `engine failure: ${failure.code}` : "not captured" },
          };
          if (failure) {
            record.answer = { text: "", status: "not-run-engine-failure" };
          } else {
            const messages = answerMessages(rubric, record);
            const promptTokens = messages.reduce((s, m) => s + countTokens(m.content), 0);
            const started = performance.now();
            const reply = await transport.chat({ model: MODELS.lite, messages, temperature: 0, max_completion_tokens: ANSWER_OUTPUT_MAX, response_format: { type: "json_object" } }, "answer", { caseId: item.id, arm, queryId: row.queryId });
            const answerMs = performance.now() - started;
            let text = "";
            let parseStatus = "ok";
            if (reply.ok) {
              try {
                const parsed = JSON.parse(reply.content);
                const value = parsed?.answers?.[row.queryId] ?? parsed?.[row.queryId];
                text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
                if (typeof value !== "string") parseStatus = "missing-question-id";
              } catch {
                text = reply.content;
                parseStatus = "invalid-json";
              }
            }
            const budgetFailure = Number(reply.usage?.prompt_tokens) > ANSWER_PROMPT_CEILING;
            record.answer = {
              raw: reply.content, text, parseStatus, status: !reply.ok ? "transport-failure" : parseStatus !== "ok" ? "parse-failure" : budgetFailure ? "budget-failure" : "ok",
              httpStatus: reply.status, finishReason: reply.finishReason, error: reply.error,
              localPromptTokens: promptTokens, usagePromptTokens: reply.usage?.prompt_tokens ?? null,
              usageCompletionTokens: reply.usage?.completion_tokens ?? null, ms: Math.round(answerMs),
            };
          }
          fs.appendFileSync(captureFile, JSON.stringify(record) + "\n");
          rowsWritten += 1;
        }
      }
    }
  } finally {
    console.warn = originalWarn;
    transport.uninstall();
    fs.rmSync(storeRoot, { recursive: true, force: true });
  }
  const receipts = fs.existsSync(transport.receiptsFile) ? fs.readFileSync(transport.receiptsFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const meta = {
    runId: RUN_ID, stage: "capture", backend: options.backend, startedAt, finishedAt: new Date().toISOString(),
    manifestSha, provenance, models: MODELS, embeddingSpaceId: embeddingProvider.embeddingSpaceId, embeddingPolicy: embeddingProvider.policyReceipt,
    embeddingWarmupMs: Math.round(warmupMs), embeddingProbe, onnxThreads: process.env.ORT_NUM_THREADS ?? "default",
    cases: cases.length, perLanguage, rows: rowsWritten,
    replay: replayFile ? { file: path.relative(REPO, replayFile), sha256: replaySha256, recorded: replay.size, hits: transport.replayHits } : null,
    census: {
      expectedRows: cases.reduce((s, c) => s + c.queries.length, 0) * ARMS.length,
      reopensPerNaiaArm: cases.reduce((s, c) => s + c.events.filter((e) => e.operation === "reopen").length, 0),
      physicalExtraction: receipts.filter((r) => r.operation === "extraction" && r.physical).length,
      physicalDeleteVerification: receipts.filter((r) => r.operation === "delete-verification" && r.physical).length,
      physicalAnswers: receipts.filter((r) => r.operation === "answer" && r.physical).length,
    },
    extractionFailures,
    totals: transport.totals,
  };
  meta.censusChecks = {
    rows: meta.rows === meta.census.expectedRows,
    extractionPerCase: replayFile
      ? meta.census.physicalExtraction === 0 && receipts.filter((r) => r.operation === "extraction" && r.replayed).length === cases.length
      : meta.census.physicalExtraction === cases.length,
    contradictionFilterCalls: receipts.filter((r) => r.operation === "contradiction-filter" && r.physical).length,
    contradictionFilterNon200: receipts.filter((r) => r.operation === "contradiction-filter" && r.physical && r.status !== 200).length,
    llmFilterFallbacks,
  };
  writeJson(path.join(outDir, "capture-meta.json"), meta);
  const rawProviderPath = path.join(outDir, "capture-raw-provider.jsonl");
  const seal = { runId: RUN_ID, captureSha256: sha256(fs.readFileSync(captureFile)), metaSha256: sha256(fs.readFileSync(path.join(outDir, "capture-meta.json"))), rawProviderSha256: fs.existsSync(rawProviderPath) ? sha256(fs.readFileSync(rawProviderPath)) : null, rows: rowsWritten, sealedAt: new Date().toISOString() };
  writeJson(path.join(outDir, "seal.json"), seal);
  return { meta, seal };
}

// ── judge ──────────────────────────────────────────────────────────────────
export const MEMORY_JUDGE_BOOLEAN_FIELDS = Object.freeze(["correct", "abstained", "unsupported", "forbidden_asserted", "critical_reversal", "retrieval_critical_reversal", "answer_critical_reversal", "stale_exposure", "deletion_leakage", "project_leakage", "current_at_1", "current_at_5"]);
const JUDGE_FIELDS = Object.freeze([...MEMORY_JUDGE_BOOLEAN_FIELDS, "false_overwrite", "reason", "evidence_quotes"]);

// Answer prompts carry "[fact] ..." / "[episode] ..." row prefixes. The judge
// projection removes them so engine vocabulary does not hint at the arm.
export function stripKindPrefixes(text) {
  return String(text ?? "").split("\n").map((line) => line.replace(/^(\[(fact|episode|reflection|memory)\]\s*|-\s+)/, "")).join("\n");
}

export function blindId(rowId) { return `b${sha256(`${RUN_ID}|${rowId}`).slice(0, 12)}`; }

function goldProjection(gold, query) {
  const matched = gold?.queries?.find((q) => q.query_id === query.id) ?? null;
  return {
    gold_propositions: clone(gold?.propositions ?? []),
    expected_answer: matched?.expected_answer ?? null,
    required_proposition_ids: clone(matched?.required_proposition_ids ?? []),
    forbidden_proposition_ids: clone(matched?.forbidden_proposition_ids ?? []),
    abstention_required: matched?.requires_abstention_about_value === true,
  };
}

export function judgeRow(item, gold, row) {
  // Projection follows candidate-e memorySourceProjection. Arm identity and
  // row ids are never included; the blind id is opaque.
  const query = item.queries.find((q) => q.id === row.queryId);
  return {
    id: blindId(row.rowId),
    language: item.language,
    question: { id: query.id, text: query.text, project: query.project, scope_mode: query.scope_mode, mode: query.mode },
    query_context: { project: query.project, scope_mode: query.scope_mode, mode: query.mode, at_timestamp: query.at_timestamp ?? null },
    retrieved_ranked: (row.ranked ?? []).map((r, index) => ({ rank: index + 1, content: r.content, project: r.project ?? null })),
    retrieved_supplied: (row.supplied ?? []).map((r, index) => ({ rank: index + 1, content: r.content, project: r.project ?? null })),
    recovered_context: stripKindPrefixes(row.contextText),
    recent_tail: row.recentTail,
    candidate_answer: { text: row.answer?.text ?? "" },
    native_active_state: row.activeState,
    // Tells the judge whether false_overwrite must be decided for this row:
    // native state exists and the gold flags the metric for this query.
    false_overwrite_applies: row.activeState?.status === "available" && gold?.queries?.find((q) => q.query_id === query.id)?.denominators?.false_overwrite === true,
    source_events: item.events.map((e) => ({ id: e.id, operation: e.operation, timestamp: e.timestamp, ...(e.project ? { project: e.project } : {}), ...(e.message ? { role: e.message.role, content: e.message.content } : {}) })),
    ...goldProjection(gold, query),
  };
}

export function evidenceTexts(projected) {
  const texts = new Set();
  const add = (v) => { if (typeof v === "string" && v.length) texts.add(v); };
  for (const e of projected.source_events) add(e.content);
  for (const m of projected.recent_tail) add(m.content);
  for (const p of projected.gold_propositions) add(p.text);
  add(projected.expected_answer);
  add(projected.question.text);
  add(projected.candidate_answer.text);
  add(projected.recovered_context);
  for (const r of projected.retrieved_ranked ?? []) add(r.content);
  for (const f of projected.native_active_state?.facts ?? []) add(f.content);
  return [...texts];
}

function judgeMessages(rubric, rows) {
  const system = [
    "You are a strict, blind evaluator of a memory system's answers. Judge meaning, not wording. Use only the supplied rows.",
    `Rubric (fixed): ${JSON.stringify({ answer_fields: rubric.answer_fields, memory_denominators: rubric.memory_denominators, retrieval_labels: rubric.retrieval_labels, uncertain_policy: rubric.uncertain_policy })}`,
    "For every row id return an object with exactly these fields:",
    `${MEMORY_JUDGE_BOOLEAN_FIELDS.join(", ")} (booleans), false_overwrite (boolean when the row's false_overwrite_applies is true, otherwise null), reason (one sentence), evidence_quotes (array of short exact substrings copied from the row's supplied texts).`,
    "current_at_1/current_at_5 judge retrieved_ranked (first item / first five). retrieval_critical_reversal judges retrieved context; answer_critical_reversal judges the candidate answer; critical_reversal is true if either is true.",
    'Return one JSON object keyed by row id: {"<row id>": {...}, ...}. No other text.',
  ].join("\n");
  return [{ role: "system", content: system }, { role: "user", content: JSON.stringify({ rows }) }];
}

export function validateJudgeResponse(parsed, projectedRows) {
  // Batch-level structure is strict; quote validity is reported per row.
  assertCondition(parsed && typeof parsed === "object" && !Array.isArray(parsed), "judge output must be an object");
  const expected = projectedRows.map((r) => r.id);
  const actual = Object.keys(parsed);
  assertCondition(actual.length === expected.length && expected.every((id) => actual.includes(id)), `judge id coverage failed: expected ${expected.length}, got ${actual.length}`);
  const perRow = {};
  for (const projected of projectedRows) {
    let row = parsed[projected.id];
    assertCondition(row && typeof row === "object" && !Array.isArray(row), `judge row ${projected.id} is not an object`);
    // Undeclared fields are recorded and ignored; only declared field type
    // violations fail the batch.
    const undeclaredFields = Object.keys(row).filter((k) => !JUDGE_FIELDS.includes(k));
    for (const field of MEMORY_JUDGE_BOOLEAN_FIELDS) assertCondition(typeof row[field] === "boolean", `judge row ${projected.id}/${field} must be boolean`);
    // false_overwrite: type must be boolean or null. A null where the metric
    // applies is counted unavailable for that metric only (score stage), so one
    // row cannot void a whole batch.
    assertCondition(row.false_overwrite === null || row.false_overwrite === undefined || typeof row.false_overwrite === "boolean", `judge row ${projected.id} false_overwrite must be boolean or null`);
    if (!projected.false_overwrite_applies && typeof row.false_overwrite === "boolean") row = { ...row, false_overwrite: null };
    assertCondition(typeof row.reason === "string" && row.reason.trim().length > 0, `judge row ${projected.id} reason missing`);
    const texts = evidenceTexts(projected);
    const quotesOk = Array.isArray(row.evidence_quotes)
      && row.evidence_quotes.every((q) => typeof q === "string" && q.trim().length > 0 && texts.some((t) => t.replace(/\s+/g, " ").includes(q.replace(/\s+/g, " "))));
    const declared = Object.fromEntries(JUDGE_FIELDS.map((k) => [k, row[k]]));
    if (declared.false_overwrite === undefined) declared.false_overwrite = null;
    perRow[projected.id] = { ...declared, quotesValid: quotesOk, undeclaredFields };
  }
  return perRow;
}

export async function judge(options) {
  const outDir = path.resolve(options.out);
  const seal = readJson(path.join(outDir, "seal.json"));
  assertCondition(sha256(fs.readFileSync(path.join(outDir, "capture.jsonl"))) === seal.captureSha256, "capture does not match its seal");
  assertCondition(sha256(fs.readFileSync(path.join(outDir, "capture-meta.json"))) === seal.metaSha256, "capture meta does not match its seal");
  const judgeFile = path.join(outDir, "judge.jsonl");
  assertCondition(!fs.existsSync(judgeFile), "judge output exists; refusing to rejudge (no selective rejudging)");
  verifyDesign();
  // Gold is opened only after the seal check.
  const inputs = new Map(readJson(path.join(DESIGN_DIR, "memory-inputs.json")).cases.map((c) => [c.id, c]));
  const golds = new Map(readJson(path.join(DESIGN_DIR, "memory-gold.json")).cases.map((c) => [c.case_id, c]));
  const rubric = readJson(path.join(DESIGN_DIR, "rubric.json"));
  const rows = fs.readFileSync(path.join(outDir, "capture.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const transport = new Transport({ backend: options.backend, stage: "judge", apiKey: process.env.AZURE_FOUNDRY_KEY ?? "", receiptsFile: path.join(outDir, "receipts-judge.jsonl"), mock: mockResponder });
  transport.install();
  const batches = [];
  try {
    for (const arm of ARMS) {
      const armRows = rows.filter((r) => r.arm === arm);
      let offset = 0;
      while (offset < armRows.length) {
        let size = 4;
        let slice;
        let projected;
        let messages;
        // Size decision happens before dispatch, never after seeing a response.
        for (;;) {
          slice = armRows.slice(offset, offset + size);
          projected = slice.map((r) => judgeRow(inputs.get(r.caseId), golds.get(r.caseId), r));
          messages = judgeMessages(rubric, projected);
          const estimate = Math.ceil(messages.reduce((s, m) => s + countTokens(m.content), 0) * 1.3);
          if (estimate <= JUDGE_BATCH_INPUT_CEILING || size === 1) break;
          size = size === 4 ? 2 : 1;
        }
        offset += slice.length;
        const batchId = `j${String(batches.length + 1).padStart(3, "0")}`;
        const reply = await transport.chat({ model: MODELS.judge, messages, temperature: 0, max_tokens: JUDGE_OUTPUT_MAX, response_format: { type: "json_object" } }, "judge", { batchId });
        let perRow = null;
        let unavailable = null;
        if (!reply.ok) unavailable = `transport:${reply.status}:${reply.error ?? ""}`;
        else if (reply.finishReason === "length") unavailable = "finish_reason=length";
        else {
          try { perRow = validateJudgeResponse(JSON.parse(reply.content), projected); } catch (error) { unavailable = `invalid:${boundedErrorText(error.message)}`; }
        }
        for (const [index, row] of slice.entries()) {
          const verdict = perRow?.[projected[index].id] ?? null;
          const record = {
            rowId: row.rowId, blindId: projected[index].id, batchId, batchSize: slice.length,
            terminal: unavailable ? "unavailable-judge" : verdict.quotesValid ? "judged" : "unavailable-judge-quote",
            reason: unavailable ?? (verdict.quotesValid ? null : "evidence quote not found in supplied texts"),
            verdict,
          };
          fs.appendFileSync(judgeFile, JSON.stringify(record) + "\n");
        }
        fs.appendFileSync(path.join(outDir, "judge-raw.jsonl"), JSON.stringify({ batchId, arm, blindIds: projected.map((x) => x.id), status: reply.status, finishReason: reply.finishReason, unavailable, content: reply.content }) + "\n");
        batches.push({ batchId, arm, size: slice.length, unavailable, usage: reply.usage, finishReason: reply.finishReason });
      }
    }
  } finally {
    transport.uninstall();
  }
  const meta = { runId: RUN_ID, stage: "judge", backend: options.backend, finishedAt: new Date().toISOString(), captureSeal: seal, batches, totals: transport.totals };
  writeJson(path.join(outDir, "judge-meta.json"), meta);
  return meta;
}

// ── score ──────────────────────────────────────────────────────────────────
const METRIC_FLAGS = Object.freeze({
  stale_exposure: "stale_exposure",
  deletion_leakage: "deletion_leakage",
  project_leakage: "project_leakage",
  false_overwrite: "false_overwrite",
  critical_reversal: "critical_reversal",
});

function clusterBootstrap(pairs, seed = BOOTSTRAP_SEED, resamples = BOOTSTRAP_RESAMPLES) {
  // pairs: [{family, diff}] at case level. Resample construction families.
  const families = [...new Set(pairs.map((p) => p.family))];
  if (families.length < 2) return { lower: null, upper: null, degenerate: true };
  const byFamily = new Map(families.map((f) => [f, pairs.filter((p) => p.family === f)]));
  const rand = mulberry32(seed);
  const stats = [];
  for (let i = 0; i < resamples; i += 1) {
    let sum = 0;
    let n = 0;
    for (let j = 0; j < families.length; j += 1) {
      for (const p of byFamily.get(families[Math.floor(rand() * families.length)])) { sum += p.diff; n += 1; }
    }
    stats.push(n ? sum / n : 0);
  }
  stats.sort((a, b) => a - b);
  const lower = stats[Math.floor(0.025 * resamples)];
  const upper = stats[Math.floor(0.975 * resamples) - 1];
  return { lower, upper, degenerate: lower === upper };
}

export function score(options) {
  const outDir = path.resolve(options.out);
  const golds = new Map(readJson(path.join(DESIGN_DIR, "memory-gold.json")).cases.map((c) => [c.case_id, c]));
  const prereg = fs.existsSync(PREREG_PATH) ? readJson(PREREG_PATH) : null;
  const capture = fs.readFileSync(path.join(outDir, "capture.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const judged = new Map(fs.readFileSync(path.join(outDir, "judge.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((r) => [r.rowId, r]));
  const captureMeta = readJson(path.join(outDir, "capture-meta.json"));
  const flagsFor = (row) => golds.get(row.caseId).queries.find((q) => q.query_id === row.queryId).denominators;
  const verdictUsable = (row) => judged.get(row.rowId)?.terminal === "judged";
  // Execution failures (engine, transport, parse, budget) are definite
  // incorrect answers. A judge-unavailable row with a successful execution is
  // uncertain: it lowers the lower bound and raises the upper bound only.
  const executionOk = (row) => !row.engineFailure && row.answer?.status === "ok";
  const nativeStateDeclared = (row) => row.activeState?.status === "available";
  const summarize = (subset) => {
    const failureKinds = {};
    for (const r of subset) {
      if (executionOk(r)) continue;
      const kind = r.engineFailure ? `engine:${r.engineFailure.code}` : r.answer?.status ?? "unknown";
      failureKinds[kind] = (failureKinds[kind] ?? 0) + 1;
    }
    const out = { rows: subset.length, executionFailures: Object.values(failureKinds).reduce((a, b) => a + b, 0), executionFailureKinds: failureKinds, judgeUnavailable: subset.filter((r) => executionOk(r) && !verdictUsable(r)).length };
    const correctOn = (flag) => {
      const rows = subset.filter((r) => flagsFor(r)[flag]);
      const correct = rows.filter((r) => executionOk(r) && verdictUsable(r) && judged.get(r.rowId).verdict.correct).length;
      const uncertain = rows.filter((r) => executionOk(r) && !verdictUsable(r)).length;
      return { n: rows.length, correct, uncertain, lower: rows.length ? correct / rows.length : null, upper: rows.length ? (correct + uncertain) / rows.length : null };
    };
    out.answerCorrectness = correctOn("answer_correctness");
    out.currentAnswerCorrectness = correctOn("current_at_k");
    for (const k of ["current_at_1", "current_at_5"]) {
      const rows = subset.filter((r) => flagsFor(r).current_at_k);
      out[k] = { n: rows.length, observed: rows.filter((r) => verdictUsable(r) && judged.get(r.rowId).verdict[k]).length, unavailable: rows.filter((r) => !verdictUsable(r)).length };
    }
    for (const [metric, flag] of Object.entries(METRIC_FLAGS)) {
      let rows = subset.filter((r) => flagsFor(r)[flag]);
      let notApplicable = 0;
      if (metric === "false_overwrite") {
        // Arms without native semantic state cannot overwrite; not applicable, not unavailable.
        notApplicable = rows.filter((r) => !nativeStateDeclared(r) && !r.engineFailure).length;
        rows = rows.filter((r) => nativeStateDeclared(r) || r.engineFailure);
      }
      const usable = rows.filter((r) => verdictUsable(r) && judged.get(r.rowId).verdict[metric] !== null);
      out[metric] = { n: rows.length, notApplicable, observed: usable.filter((r) => judged.get(r.rowId).verdict[metric] === true).length, unavailable: rows.length - usable.length };
    }
    out.retrievalMs = { p50: percentile(subset.map((r) => r.retrievalMs), 50), p95: percentile(subset.map((r) => r.retrievalMs), 95) };
    out.answerMs = { p50: percentile(subset.map((r) => r.answer?.ms), 50), p95: percentile(subset.map((r) => r.answer?.ms), 95) };
    return out;
  };
  const byArm = {};
  for (const arm of ARMS) {
    const armRows = capture.filter((r) => r.arm === arm);
    byArm[arm] = { overall: summarize(armRows), byLanguage: Object.fromEntries(["ko", "en", "ja"].map((lang) => [lang, summarize(armRows.filter((r) => r.language === lang))])) };
  }
  const acceptance = prereg?.memory_acceptance ?? { current_answer_correctness_overall_min: 0.85, current_answer_correctness_each_language_min: 0.8 };
  const gate = (arm) => {
    const a = byArm[arm];
    const fail = [];
    const uncertain = [];
    const thresholdCheck = (label, c, min) => {
      if (!c.n) return;
      if (c.upper < min) fail.push(`${label} current correctness upper ${c.correct + c.uncertain}/${c.n} < ${min}`);
      else if (c.lower < min) uncertain.push(`${label} current correctness lower ${c.correct}/${c.n} < ${min} <= upper ${c.correct + c.uncertain}/${c.n}`);
    };
    thresholdCheck("overall", a.overall.currentAnswerCorrectness, acceptance.current_answer_correctness_overall_min);
    for (const [lang, sub] of Object.entries(a.byLanguage)) thresholdCheck(lang, sub.currentAnswerCorrectness, acceptance.current_answer_correctness_each_language_min);
    for (const metric of ["deletion_leakage", "project_leakage", "false_overwrite", "critical_reversal"]) {
      if (a.overall[metric].observed > 0) fail.push(`${metric} observed ${a.overall[metric].observed}`);
      else if (a.overall[metric].unavailable > 0) uncertain.push(`${metric} unavailable ${a.overall[metric].unavailable}`);
    }
    return { decision: fail.length ? "FAIL" : uncertain.length ? "INCONCLUSIVE" : "PASS", fail, uncertain, formalNoninferiority: "INCONCLUSIVE (suite cannot support inference)" };
  };
  const caseScores = (arm) => {
    const map = new Map();
    for (const r of capture.filter((x) => x.arm === arm && flagsFor(x).current_at_k)) {
      const e = map.get(r.caseId) ?? { family: r.family, correct: 0, n: 0 };
      e.n += 1;
      if (executionOk(r) && verdictUsable(r) && judged.get(r.rowId).verdict.correct) e.correct += 1;
      map.set(r.caseId, e);
    }
    return map;
  };
  const paired = (a, b) => {
    const A = caseScores(a);
    const B = caseScores(b);
    const pairs = [...A.keys()].filter((k) => B.has(k)).map((k) => ({ family: A.get(k).family, diff: A.get(k).correct / A.get(k).n - B.get(k).correct / B.get(k).n }));
    const mean = pairs.length ? pairs.reduce((s, p) => s + p.diff, 0) / pairs.length : null;
    return { cases: pairs.length, meanCaseDifference: mean, familyBootstrap95: clusterBootstrap(pairs) };
  };
  // delete-ungrounded is a parser diagnostic for a rejected delete operation,
  // not a failed extraction call; with replayed extraction the gate is N/A.
  const callFailures = captureMeta.extractionFailures.filter((f) => f.code !== "delete-ungrounded");
  const extraction = {
    physicalCalls: captureMeta.census.physicalExtraction,
    failures: callFailures.length,
    byCode: callFailures.reduce((m, f) => ({ ...m, [f.code]: (m[f.code] ?? 0) + 1 }), {}),
    deleteUngrounded: captureMeta.extractionFailures.filter((f) => f.code === "delete-ungrounded").map((f) => f.caseId),
    preregisteredMax: prereg?.extraction_failure_gate?.max_failed ?? 2,
    applicable: captureMeta.census.physicalExtraction > 0,
  };
  extraction.decision = !extraction.applicable ? "N/A (replayed extraction)" : extraction.failures <= extraction.preregisteredMax ? "PASS (necessary condition only)" : "REJECT";
  const receipts = ["capture", "judge"].flatMap((stage) => {
    const f = path.join(outDir, `receipts-${stage}.jsonl`);
    return fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  });
  const tokenizerDiffs = receipts.filter((r) => r.operation === "answer" && r.physical && Number.isFinite(r.usage?.prompt)).map((r) => Math.abs(r.localPromptTokens - r.usage.prompt) / r.usage.prompt);
  const result = {
    runId: RUN_ID, scoredAt: new Date().toISOString(), scope: "Azure Foundry gpt-5-4-nano extraction/answer + deepseek-v4-flash judge; model-authored synthetic development-exposed fixtures; not product-path (local reasoning) evidence; not independent human evaluation",
    byArm,
    gates: Object.fromEntries(ARMS.map((arm) => [arm, gate(arm)])),
    paired: { "naia-vs-simple-vector": paired("naia", "simple-vector"), "naia-llm-filter-vs-simple-vector": paired("naia-llm-filter", "simple-vector"), "naia-vs-no-memory": paired("naia", "no-memory"), "naia-llm-filter-vs-naia": paired("naia-llm-filter", "naia") },
    extraction,
    tokenizer: { answerRows: tokenizerDiffs.length, medianRelativeDiff: percentile(tokenizerDiffs, 50), maxRelativeDiff: tokenizerDiffs.length ? Math.max(...tokenizerDiffs) : null, note: "o200k_base is the budget tokenizer; not claimed identical to the model tokenizer" },
    providerTotals: { capture: captureMeta.totals, judge: fs.existsSync(path.join(outDir, "judge-meta.json")) ? readJson(path.join(outDir, "judge-meta.json")).totals : null },
    reasoningTokensObserved: receipts.reduce((s, r) => s + (Number(r.usage?.reasoning) || 0), 0),
    // Preregistered unsupported path: at-time queries at the first event time.
    atTimeUnsupported: Object.fromEntries(ARMS.map((arm) => [arm, capture
      .filter((r) => r.arm === arm && ["memory-ko-12", "memory-en-12", "memory-ja-12"].includes(r.caseId))
      .map((r) => {
        const query = golds.get(r.caseId) && readJsonCached(path.join(DESIGN_DIR, "memory-inputs.json")).cases.find((c) => c.id === r.caseId).queries.find((q) => q.id === r.queryId);
        return { rowId: r.rowId, mode: query?.mode ?? null, unsupportedAtTime: query?.mode === "at-time", executionOk: executionOk(r), judged: verdictUsable(r), correct: verdictUsable(r) ? judged.get(r.rowId).verdict.correct : null };
      })])),
    censusChecks: captureMeta.censusChecks ?? null,
    rankingDiagnostics: Object.fromEntries(NAIA_ARMS.map((arm) => {
      const queryModes = new Map(readJsonCached(path.join(DESIGN_DIR, "memory-inputs.json")).cases.flatMap((c) => c.queries.map((q) => [`${c.id}|${q.id}`, q.mode ?? "latest"])));
      const rows = capture.filter((r) => r.arm === arm && !r.engineFailure);
      let supersededRank1 = 0;
      let activeSuccessorAbsent = 0;
      let episodeRank1 = 0;
      let latestRows = 0;
      let retiredEpisodeInRanked = 0;
      let retiredEpisodeInSupplied = 0;
      let retiredEpisodesTotal = 0;
      let anchorOrderMismatches = 0;
      const retiredSuppliedRows = [];
      for (const r of rows) {
        const facts = new Map((r.activeState?.facts ?? []).map((f) => [f.id, f]));
        const first = r.ranked?.[0];
        if (first?.kind === "fact" && facts.get(first.id)?.status === "superseded") supersededRank1 += 1;
        const successors = [...facts.values()].filter((f) => f.status === "active" && f.supersedes);
        const rankedIds = new Set((r.ranked ?? []).filter((x) => x.kind === "fact").map((x) => x.id));
        if (successors.length && !successors.some((f) => rankedIds.has(f.id))) activeSuccessorAbsent += 1;
        if (first?.kind === "episode") episodeRank1 += 1;
        // Retired-episode diagnostics use the product's anchor rule on latest
        // rows only; history and at-time rows are outside the rule by design.
        const mode = queryModes.get(`${r.caseId}|${r.queryId}`) ?? "latest";
        const lineage = r.trace?.lineage;
        if (mode !== "latest" || !lineage) continue;
        latestRows += 1;
        const derived = new Set();
        const anchors = new Set();
        for (const f of lineage.facts) {
          for (const e of f.sourceEpisodes) derived.add(e);
          const live = f.status === "active" && (f.validTo === null || f.validTo > r.queryTime);
          if (live && f.sourceEpisodes.length) anchors.add(f.sourceEpisodes.at(-1));
          if (f.sourceEpisodes.length > 1) {
            const byTime = [...f.sourceEpisodes].sort((a, b) => (lineage.episodeTimestamps[a] ?? 0) - (lineage.episodeTimestamps[b] ?? 0)).at(-1);
            if (byTime !== f.sourceEpisodes.at(-1)) anchorOrderMismatches += 1;
          }
        }
        const retired = new Set([...derived].filter((e) => !anchors.has(e)));
        retiredEpisodesTotal += retired.size;
        if ((r.ranked ?? []).some((x) => x.kind === "episode" && retired.has(x.id))) retiredEpisodeInRanked += 1;
        if ((r.supplied ?? []).some((x) => x.kind === "episode" && retired.has(x.id))) { retiredEpisodeInSupplied += 1; retiredSuppliedRows.push(r.rowId); }
      }
      return [arm, { rows: rows.length, supersededRank1, activeSuccessorAbsent, episodeRank1, latestRows, retiredEpisodesTotal, retiredEpisodeInRanked, retiredEpisodeInSupplied, retiredSuppliedRows, anchorOrderMismatches }];
    })),
  };
  writeJson(path.join(outDir, "score.json"), result);
  return result;
}

// ── entry ──────────────────────────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = args(process.argv.slice(2));
  const command = a._[0];
  assertCondition(a.out, "--out <dir> is required");
  const run = async () => {
    RUN_ID = a["run-id"] ?? null;
    assertCondition(RUN_IDS.includes(RUN_ID), `--run-id must be one of ${RUN_IDS.join(", ")}`);
    if (command === "capture") return capture({ out: a.out, backend: a.backend ?? "mock", "per-language": a["per-language"], "replay-extraction": a["replay-extraction"] });
    if (command === "judge") return judge({ out: a.out, backend: a.backend ?? "mock" });
    if (command === "score") return score({ out: a.out });
    throw new Error("command must be capture, judge or score");
  };
  run().then((result) => {
    const summary = command === "score"
      ? { gates: result.gates, extraction: result.extraction, current: Object.fromEntries(ARMS.map((arm) => [arm, result.byArm[arm].overall.currentAnswerCorrectness])) }
      : command === "capture" ? { rows: result.meta.rows, census: result.meta.census, replay: result.meta.replay, censusChecks: result.meta.censusChecks, extractionFailures: result.meta.extractionFailures.length, totals: result.meta.totals }
        : { batches: result.batches.length, unavailable: result.batches.filter((b) => b.unavailable).length, totals: result.totals };
    console.log(JSON.stringify(summary, null, 2));
  }, (error) => {
    console.error(boundedErrorText(error?.stack ?? error));
    process.exit(1);
  });
}
