// Ask a cloud model that has no repository access to author the held-out rows.
// One request per (category, variant); the brief is the only context.
// Usage: AZURE_FOUNDRY_KEY=... node author-rows.mjs
import fs from "node:fs";
const BASE = "https://naia-azure-foundry.cognitiveservices.azure.com/openai/v1/";
const MODEL = process.env.AUTHOR_MODEL ?? "deepseek-v4-flash";
const brief = fs.readFileSync(new URL("./AUTHOR-BRIEF.md", import.meta.url), "utf8");
const variants = [["new","stable"],["new","deadline"],["update","correction"],["update","chain"],["delete","forget"],["delete","cancel_one"],["contradiction","quotation"],["contradiction","hypothetical"],["preferences","coexist"],["preferences","unchanged"],["history","former"],["history","at_time"],["project_isolation","different"],["project_isolation","delete_one"]];
const rows = [];
const TWELVE = new Set(["stable", "deadline", "forget", "cancel_one", "coexist", "delete_one"]);
const firstSet = JSON.parse(fs.readFileSync(new URL("./first-set-questions.json", import.meta.url), "utf8"));
const receipts = [];
const usedTopics = [];
for (const [category, variant] of variants) {
  const n = TWELVE.has(variant) ? 12 : 6;
  const prompt = `${brief}\n\n지금은 category="${category}", variant="${variant}" 사례만 ${n}건 작성하십시오. 표의 해당 행 구조와 추가 제약을 정확히 따르십시오.\n첫 번째 보유셋의 질문(소재가 겹치면 안 됨): ${firstSet.join(" / ")}\n이미 이번 보유셋에서 쓴 소재(다시 쓰지 말 것): ${usedTopics.join(", ") || "없음"}\n출력은 JSON 객체 하나 {"rows": [ ...${n}개... ]} 이며 각 원소는 지침의 필드(category, variant, turns, question, expected, obsolete, second, forbidden_value)를 모두 가집니다. 설명 문장 없이 JSON만 출력하십시오.`;
  const res = await fetch(`${BASE}chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.AZURE_FOUNDRY_KEY}` },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: prompt }], temperature: 0.7, max_tokens: 12000, response_format: { type: "json_object" } }) });
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  receipts.push({ category, variant, status: res.status, usage: data.usage ?? null, model: data.model ?? null, text });
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}
  const got = Array.isArray(parsed?.rows) ? parsed.rows : [];
  console.error(category, variant, res.status, got.length);
  for (const r of got) { rows.push({ ...r, category, variant }); usedTopics.push(String(r.question).slice(0, 30)); }
}
fs.writeFileSync(new URL("./rows.json", import.meta.url), JSON.stringify(rows, null, 1) + "\n");
fs.writeFileSync(new URL("./author-receipts.json", import.meta.url), JSON.stringify({ model: MODEL, authoredAt: new Date().toISOString(), receipts }, null, 1) + "\n");
console.error("rows", rows.length);
