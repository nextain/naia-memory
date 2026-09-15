/*
 * What-if for the az4 pre-check (no provider calls): for the deletes rejected
 * at grounding, rebuild the delete operation from the raw response (with the
 * parser's vocabulary normalisation applied by parsing it as an upsert) and
 * list the candidates resolveDeleteTarget would offer if grounding passed.
 */
import fs from "node:fs";
import { parseLLMFactResponse } from "../../../src/memory/llm-fact-extractor.ts";
import { resolveDeleteTarget } from "../../../src/memory/delete-authorization.ts";

const inputs = JSON.parse(fs.readFileSync(process.env.DESIGN_INPUTS, "utf8")).cases;
const raw = fs.readFileSync(process.env.RAW, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.operation === "extraction" && r.status === 200);
for (const caseId of ["memory-ko-14", "memory-en-14", "memory-ja-14", "memory-en-05"]) {
  const item = inputs.find((c) => c.id === caseId);
  const episodes = item.events.filter((e) => e.operation === "encode").map((e, i) => ({ id: e.id, content: e.message.content, role: e.message.role, summary: e.message.content, timestamp: i, importance: { importance: 0.5, surprise: 0, emotion: 0.5, utility: 0.5 }, encodingContext: { project: e.project }, consolidated: false, recallCount: 0, lastAccessed: 0, strength: 1 }));
  const response = JSON.parse(raw.find((r) => r.caseId === caseId).responseText);
  const content = JSON.parse(response.choices[0].message.content);
  // Parse the delete entries as upserts to get the normalised structured field.
  const asUpserts = Object.fromEntries(Object.entries(content).map(([k, fs2]) => [k, fs2.map((f) => (typeof f === "object" && f.operation === "delete" ? { ...f, operation: "upsert", __wasDelete: true } : f))]));
  const flagged = new Set(Object.values(content).flat().filter((f) => typeof f === "object" && f.operation === "delete").map((f) => f.content));
  const parsed = parseLLMFactResponse({ ...response, choices: [{ ...response.choices[0], message: { ...response.choices[0].message, content: JSON.stringify(asUpserts) } }] }, episodes);
  const deletes = parsed.filter((f) => flagged.has(f.content) && episodes.findIndex((e) => e.id === f.sourceEpisodeIds[0]) === episodes.length - 1);
  const stored = parsed.filter((f) => !deletes.includes(f)).map((f, i) => ({ id: `f${i}`, content: f.content, status: "active", structured: f.structured, sourceEpisodes: f.sourceEpisodeIds, project: episodes.find((e) => e.id === f.sourceEpisodeIds[0]).encodingContext.project }));
  for (const del of deletes) {
    const episode = episodes.find((e) => e.id === del.sourceEpisodeIds[0]);
    const scoped = stored.filter((f) => f.project === episode.encodingContext.project);
    let offered = [];
    await resolveDeleteTarget({ episode, fact: { ...del, operation: "delete" }, existingFacts: scoped, verifier: async (_e, _f, c) => { offered = c; return { authorized: false }; } });
    console.log(JSON.stringify({ caseId, delete: del.content, structured: del.structured, scopedFacts: scoped.map((f) => [f.content, f.structured]), candidates: offered.map((c) => c.structured.value) }));
  }
}
