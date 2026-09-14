/*
 * Paid envelope smoke for candidate-az1-20260915, run before freezing and
 * outside the run id. Uses synthetic content, never fixture text. Checks that
 * the real models honour the response shapes the runner depends on:
 *   1. answer envelope  (gpt-5-4-nano, json_object, {"answers":{id:text}})
 *   2. judge envelope   (deepseek-v4-flash, json_object, row object keyed by id)
 *   3. delete verifier  (product buildLLMDeleteVerifier request on deepseek-v4-flash)
 * Usage: AZURE_FOUNDRY_KEY=... pnpm exec tsx reports/quality/candidate-az1-20260915/smoke-envelopes.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { answerMessages, MEMORY_JUDGE_BOOLEAN_FIELDS } from "./run-az1.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const BASE = "https://naia-azure-foundry.cognitiveservices.azure.com/openai/v1/";
const key = process.env.AZURE_FOUNDRY_KEY;
if (!key) throw new Error("AZURE_FOUNDRY_KEY required");
const rubric = JSON.parse(fs.readFileSync(path.join(REPO, "reports/quality/remaining-plan-20260905/design/rubric.json"), "utf8"));

async function chat(body) {
  const started = performance.now();
  const res = await fetch(`${BASE}chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
  const json = await res.json();
  return { status: res.status, ms: Math.round(performance.now() - started), content: json.choices?.[0]?.message?.content ?? null, finish: json.choices?.[0]?.finish_reason ?? null, usage: json.usage ?? null, model: json.model ?? null, error: json.error?.message?.slice(0, 200) ?? null };
}

const out = { at: new Date().toISOString(), note: "synthetic content; outside run id; not evaluation data" };

const row = { queryId: "sq1", query: "What tea should I bring to the book meeting?", contextText: "[fact] The user brings jasmine tea to book meetings.", recentTail: [{ role: "user", content: "Okay, next question." }] };
const a = await chat({ model: "gpt-5-4-nano", messages: answerMessages(rubric, row), temperature: 0, max_completion_tokens: 512, response_format: { type: "json_object" } });
let answerShape = "invalid";
try { const p = JSON.parse(a.content); answerShape = typeof p?.answers?.sq1 === "string" ? "ok" : "missing-question-id"; } catch { answerShape = "invalid-json"; }
out.answer = { ...a, shape: answerShape };

const judgeRows = [{ id: "bsmoke0001", language: "en", question: { id: "sq1", text: row.query }, retrieved_ranked: [{ rank: 1, content: "The user brings jasmine tea to book meetings.", project: "p" }], recovered_context: "The user brings jasmine tea to book meetings.", recent_tail: row.recentTail, candidate_answer: { text: "Jasmine tea." }, native_active_state: { status: "available", facts: [{ id: "f1", content: "The user brings jasmine tea to book meetings.", status: "active" }] }, source_events: [{ id: "e1", content: "I always bring jasmine tea to book meetings." }], gold_propositions: [{ id: "p1", text: "Book meeting tea is jasmine.", status: "current" }], expected_answer: "Jasmine tea.", required_proposition_ids: ["p1"], forbidden_proposition_ids: [], abstention_required: false }];
const judgeSystem = [
  "You are a strict, blind evaluator of a memory system's answers. Judge meaning, not wording. Use only the supplied rows.",
  "For every row id return an object with exactly these fields:",
  `${MEMORY_JUDGE_BOOLEAN_FIELDS.join(", ")} (booleans), false_overwrite (boolean when native_active_state.status is "available", otherwise null), reason (one sentence), evidence_quotes (array of short exact substrings copied from the row's supplied texts).`,
  'Return one JSON object keyed by row id: {"<row id>": {...}, ...}. No other text.',
].join("\n");
const j = await chat({ model: "deepseek-v4-flash", messages: [{ role: "system", content: judgeSystem }, { role: "user", content: JSON.stringify({ rows: judgeRows }) }], temperature: 0, max_tokens: 2048, response_format: { type: "json_object" } });
let judgeShape = "invalid";
try {
  const p = JSON.parse(j.content);
  const r = p?.bsmoke0001;
  const missing = MEMORY_JUDGE_BOOLEAN_FIELDS.filter((f) => typeof r?.[f] !== "boolean");
  const extra = Object.keys(r ?? {}).filter((k) => ![...MEMORY_JUDGE_BOOLEAN_FIELDS, "false_overwrite", "reason", "evidence_quotes"].includes(k));
  judgeShape = { rowPresent: Boolean(r), missingBooleans: missing, extraFields: extra, falseOverwriteType: typeof r?.false_overwrite, quotes: r?.evidence_quotes };
} catch { judgeShape = "invalid-json"; }
out.judge = { ...j, content: j.content?.slice(0, 600), shape: judgeShape };

const memoryApi = await import(path.join(REPO, "src/memory/index.ts"));
const verify = memoryApi.buildLLMDeleteVerifier({ apiKey: key, auth: "bearer", baseURL: BASE, model: "deepseek-v4-flash", batchSize: 1, failurePolicy: "throw" });
const receipts = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const res = await realFetch(input, init);
  const clone = res.clone();
  const body = await clone.json().catch(() => null);
  receipts.push({ status: res.status, finish: body?.choices?.[0]?.finish_reason ?? null, usage: body?.usage ?? null, request: Object.keys(JSON.parse(String(init.body))) });
  return res;
};
let verdict;
try {
  const structured = { subject: "user", subjectId: "person:self", property: "favorite tea", propertyId: "preference:tea", value: "jasmine tea", polarity: "affirmed", cardinality: "single" };
  verdict = await verify(
    { content: "Please forget that I like jasmine tea.", role: "user" },
    { content: "user favorite tea: jasmine tea", structured, deleteEvidence: { kind: "explicit_removal_request", quote: "Please forget that I like jasmine tea.", targetQuote: "I like jasmine tea" } },
    [{ id: "f1", structured }],
  );
} catch (error) {
  verdict = { error: String(error?.message ?? error).slice(0, 200) };
} finally {
  globalThis.fetch = realFetch;
}
out.deleteVerifier = { verdict, receipts };

fs.writeFileSync(path.join(HERE, "smoke-envelopes-20260915.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({ answer: { status: a.status, shape: answerShape, ms: a.ms }, judge: { status: j.status, finish: j.finish, shape: judgeShape, ms: j.ms }, deleteVerifier: out.deleteVerifier }, null, 2));
