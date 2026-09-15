/*
 * az4 offline pre-check (no provider calls). For the explicit deletion cases,
 * parse the sealed az3 extraction responses with the diagnostic parser, then ask
 * for each surviving delete operation which active facts would become verifier
 * candidates. A delete that is rejected at grounding, or that finds no
 * candidate, can never reach the verifier however the verifier is changed.
 * Usage (from this worktree root):
 *   RAW=<az3 capture-raw-provider.jsonl> pnpm exec tsx reports/quality/az4-precheck-20260915/precheck.mjs
 */
import fs from "node:fs";
import { parseLLMFactResponse } from "../../../src/memory/llm-fact-extractor.ts";
import { resolveDeleteTarget, hasGroundedDeleteAuthority } from "../../../src/memory/delete-authorization.ts";

const inputs = JSON.parse(fs.readFileSync(process.env.DESIGN_INPUTS ?? "reports/quality/remaining-plan-20260905/design/memory-inputs.json", "utf8")).cases;
const cases = ["memory-ko-05", "memory-en-05", "memory-ja-05", "memory-ko-14", "memory-en-14", "memory-ja-14", "memory-ko-06", "memory-en-06", "memory-ja-06"];
const raw = fs.readFileSync(process.env.RAW, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.operation === "extraction" && r.status === 200);
const rows = [];
for (const caseId of cases) {
  const item = inputs.find((c) => c.id === caseId);
  const response = JSON.parse(raw.find((r) => r.caseId === caseId).responseText);
  const encodes = item.events.filter((e) => e.operation === "encode");
  const episodes = encodes.map((e, i) => ({ id: e.id, content: e.message.content, role: e.message.role, summary: e.message.content, timestamp: i, importance: { importance: 0.5, surprise: 0, emotion: 0.5, utility: 0.5 }, encodingContext: { project: e.project }, consolidated: false, recallCount: 0, lastAccessed: 0, strength: 1 }));
  const rejected = [];
  const facts = parseLLMFactResponse(response, episodes, { onDeleteRejected: (f) => rejected.push(f.message) });
  const stored = facts.filter((f) => f.operation !== "delete").map((f, i) => ({
    id: `f${i}`, content: f.content, status: "active", structured: f.structured, sourceEpisodes: f.sourceEpisodeIds,
    encodingContext: { project: episodes.find((e) => e.id === f.sourceEpisodeIds[0])?.encodingContext.project },
  }));
  const deletes = [];
  for (const del of facts.filter((f) => f.operation === "delete")) {
    const episode = episodes.find((e) => e.id === del.sourceEpisodeIds[0]);
    const project = episode.encodingContext.project;
    const earlier = stored.filter((f) => f.encodingContext.project === project && episodes.findIndex((e) => e.id === f.sourceEpisodes[0]) < episodes.indexOf(episode));
    let offered = null;
    const grounded = hasGroundedDeleteAuthority(del, episode);
    if (grounded) await resolveDeleteTarget({ episode, fact: del, existingFacts: earlier, verifier: async (_e, _f, candidates) => { offered = candidates; return { authorized: false }; } });
    deletes.push({
      content: del.content, structured: del.structured, grounded,
      candidates: offered === null ? 0 : offered.length,
      candidateValues: (offered ?? []).map((c) => c.structured.value),
      earlierFacts: earlier.map((f) => ({ content: f.content, structured: f.structured ? `${f.structured.subjectId ?? ""}|${f.structured.propertyId ?? ""}|${f.structured.property}|${f.structured.value}` : null })),
    });
  }
  rows.push({ caseId, rejectedAtParse: rejected, deletes });
}
console.log(JSON.stringify(rows, null, 2));
