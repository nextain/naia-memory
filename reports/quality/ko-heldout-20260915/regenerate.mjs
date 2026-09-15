// Regenerate rows rejected at review. The author sees only the brief, the
// variant, and the defect reason; the reviewer never edits row content.
import fs from "node:fs";
const BASE = "https://naia-azure-foundry.cognitiveservices.azure.com/openai/v1/";
const MODEL = "deepseek-v4-flash";
const brief = fs.readFileSync(new URL("./AUTHOR-BRIEF.md", import.meta.url), "utf8");
const rows = JSON.parse(fs.readFileSync(new URL("./rows.json", import.meta.url), "utf8"));
const requests = [
  { indices: [60, 61, 62, 63, 64, 65], category: "history", variant: "former", reason: "60번은 첫 발화가 사실이 아니라 질문이고 이전 값이 대화에 없다. 6건 모두 obsolete가 '~라는 명제'로 모호하다. 1턴은 반드시 이전 값을 사실로 말하고, obsolete는 옛 값을 현재 값으로 말하는 평서문('현재 X는 (1턴 값)이다')으로 쓴다. second의 정답 값은 반드시 1턴에 있는 값이다." },
  { indices: [36], category: "contradiction", variant: "quotation", reason: "expected와 obsolete의 주어가 '저는'이라 비서 자신의 취향으로 읽힌다. 주어는 '사용자는'으로 쓴다." },
  { indices: [41], category: "contradiction", variant: "quotation", reason: "인용된 말이 사용자의 선호와 모순되지 않는다. 인용은 사용자의 선호와 정반대의 내용을 직접 주장해야 한다. expected와 obsolete의 주어는 '사용자는'으로 쓴다." },
  { indices: [55], category: "preferences", variant: "unchanged", reason: "다른 사례(소설보다 에세이 선호)와 소재가 겹친다. 책·독서와 무관한 새 소재로 쓴다." },
];
const used = rows.map((r) => r.question).join(" / ");
const log = [];
for (const req of requests) {
  const prompt = `${brief}\n\n검토에서 반려된 사례를 다시 작성합니다. category="${req.category}", variant="${req.variant}" 사례 ${req.indices.length}건을 새로 작성하십시오.\n반려 사유: ${req.reason}\n다른 사례의 질문(소재가 겹치지 않게): ${used}\n출력은 JSON 객체 하나 {"rows": [...]} 이며 각 원소는 지침의 필드를 모두 가집니다. JSON만 출력하십시오.`;
  const res = await fetch(`${BASE}chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.AZURE_FOUNDRY_KEY}` },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: prompt }], temperature: 0.7, max_tokens: 4000, response_format: { type: "json_object" } }) });
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  const got = JSON.parse(text).rows;
  if (!Array.isArray(got) || got.length !== req.indices.length) throw new Error(`bad regeneration for ${req.variant}: ${got?.length}`);
  req.indices.forEach((index, k) => { log.push({ index, reason: req.reason, before: rows[index] }); rows[index] = { ...got[k], category: req.category, variant: req.variant }; });
}
fs.writeFileSync(new URL("./rows.json", import.meta.url), JSON.stringify(rows, null, 1) + "\n");
fs.writeFileSync(new URL("./review-regeneration-log.json", import.meta.url), JSON.stringify({ model: MODEL, at: new Date().toISOString(), log }, null, 1) + "\n");
console.log("regenerated", log.length);
