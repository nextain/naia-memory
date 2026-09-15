// Regenerate rows rejected at review. The author sees only the brief, the
// variant, and the defect reason; the reviewer never edits row content.
import fs from "node:fs";
const BASE = "https://naia-azure-foundry.cognitiveservices.azure.com/openai/v1/";
const MODEL = "deepseek-v4-flash";
const brief = fs.readFileSync(new URL("./AUTHOR-BRIEF.md", import.meta.url), "utf8");
const rows = JSON.parse(fs.readFileSync(new URL("./rows.json", import.meta.url), "utf8"));
const requests = [
  { indices: [37, 38, 39, 40, 41], category: "contradiction", variant: "quotation", reason: "질문이 정답 값을 담은 확인형(예: '내가 아침형 인간이 맞아?')이라 기억 없이도 '네'로 맞힐 수 있다. 질문은 값을 담지 않은 열린 질문(예: '내가 좋아하는 음식 종류가 뭐야?')으로 쓴다. 인용은 사용자 선호와 정반대를 직접 주장하고, expected와 obsolete의 주어는 '사용자는'으로 쓴다." },
  { indices: [76, 83], category: "project_isolation", variant: null, reason: "프로젝트 이름에 금지된 '숲'이 들어 있다(숲길, 숲속). 두 글자 한글 이름을 새로 짓고 '숲'을 포함하지 않는다. 다른 사례에서 쓴 프로젝트 이름(바람, 노을, 달빛, 햇살, 구름, 별빛, 바다, 하늘, 꽃잎, 잎새, 새벽, 라온, 나래, 은하, 구슬, 산들, 물결, 초원)도 쓰지 않는다." },
];
const used = rows.map((r) => r.question).join(" / ");
const priorLog = JSON.parse(fs.readFileSync(new URL("./review-regeneration-log.json", import.meta.url), "utf8"));
const log = priorLog.log;
for (const req of requests) {
  const variant = req.variant ?? null;
  if (variant === null) {
    for (const index of req.indices) {
      const v = rows[index].variant;
      const p = `${brief}\n\n검토에서 반려된 사례를 다시 작성합니다. category="${req.category}", variant="${v}" 사례 1건을 새로 작성하십시오.\n반려 사유: ${req.reason}\n다른 사례의 질문(소재가 겹치지 않게): ${used}\n출력은 JSON 객체 하나 {"rows": [...]} 이며 각 원소는 지침의 필드를 모두 가집니다. JSON만 출력하십시오.`;
      const r2 = await fetch(`${BASE}chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.AZURE_FOUNDRY_KEY}` }, body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: p }], temperature: 0.7, max_tokens: 3000, response_format: { type: "json_object" } }) });
      const d2 = await r2.json(); const g2 = JSON.parse(d2.choices[0].message.content).rows;
      if (!Array.isArray(g2) || g2.length !== 1) throw new Error("bad regeneration " + index);
      log.push({ index, reason: req.reason, before: rows[index], round: 2 }); rows[index] = { ...g2[0], category: req.category, variant: v };
    }
    continue;
  }
  const prompt = `${brief}\n\n검토에서 반려된 사례를 다시 작성합니다. category="${req.category}", variant="${req.variant}" 사례 ${req.indices.length}건을 새로 작성하십시오.\n반려 사유: ${req.reason}\n다른 사례의 질문(소재가 겹치지 않게): ${used}\n출력은 JSON 객체 하나 {"rows": [...]} 이며 각 원소는 지침의 필드를 모두 가집니다. JSON만 출력하십시오.`;
  const res = await fetch(`${BASE}chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.AZURE_FOUNDRY_KEY}` },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: prompt }], temperature: 0.7, max_tokens: 4000, response_format: { type: "json_object" } }) });
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  const got = JSON.parse(text).rows;
  if (!Array.isArray(got) || got.length !== req.indices.length) throw new Error(`bad regeneration for ${req.variant}: ${got?.length}`);
  req.indices.forEach((index, k) => { log.push({ index, reason: req.reason, before: rows[index], round: 2 }); rows[index] = { ...got[k], category: req.category, variant: req.variant }; });
}
fs.writeFileSync(new URL("./rows.json", import.meta.url), JSON.stringify(rows, null, 1) + "\n");
fs.writeFileSync(new URL("./review-regeneration-log.json", import.meta.url), JSON.stringify({ model: MODEL, at: new Date().toISOString(), log }, null, 1) + "\n");
console.log("regenerated", log.length);
