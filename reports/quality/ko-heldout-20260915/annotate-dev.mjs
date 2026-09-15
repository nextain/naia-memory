// Annotate the 42 development fixtures with literal values so the fact-state
// script can be calibrated on runs that already have human judgements.
import fs from "node:fs";
const BASE = "https://naia-azure-foundry.cognitiveservices.azure.com/openai/v1/";
const DESIGN = "/var/home/luke/alpha-adk/projects/naia-memory/reports/quality/remaining-plan-20260905/design";
const inputs = JSON.parse(fs.readFileSync(`${DESIGN}/memory-inputs.json`, "utf8")).cases;
const gold = new Map(JSON.parse(fs.readFileSync(`${DESIGN}/memory-gold.json`, "utf8")).cases.map((c) => [c.case_id, c]));
const src = fs.readFileSync(new URL("./curate.mjs", import.meta.url), "utf8");
const RULES = eval("(" + src.slice(src.indexOf("const VALUE_RULES = ") + "const VALUE_RULES = ".length, src.indexOf("};", src.indexOf("const VALUE_RULES = ")) + 1) + ")");
const out = {};
for (const c of inputs) {
  const variant = c.construction_family.replace(`memory-${c.category}-`, "");
  const g = gold.get(c.id);
  const row = { turns: c.events.filter((e) => e.operation === "encode").map((e) => e.message.content), question: c.queries[0].text,
    expected: g.queries[0].expected_answer, obsolete: g.propositions.find((p) => p.id === "p_obsolete")?.text ?? "", second: g.queries[1] ? [c.queries[1].text, g.queries[1].expected_answer] : null };
  const res = await fetch(`${BASE}chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.AZURE_FOUNDRY_KEY}` },
    body: JSON.stringify({ model: "deepseek-v4-flash", messages: [{ role: "user", content: `다음은 평가 사례 하나입니다. 사례 내용은 바꾸지 말고, 사례에 쓰인 값을 발화에 적힌 글자 그대로 뽑아 주십시오.\n규칙(${variant}): ${RULES[variant]}\n각 값은 발화 중 하나에 글자 그대로 들어 있는 짧은 부분 문자열이어야 합니다(조사 제외).\n사례: ${JSON.stringify(row)}\n출력: {"current_values": [...], "obsolete_values": [...], "other_values": [...]} JSON만.` }], temperature: 0, max_tokens: 800, response_format: { type: "json_object" } }) });
  const v = JSON.parse((await res.json()).choices[0].message.content);
  out[c.id] = { variant, current_values: v.current_values ?? [], obsolete_values: v.obsolete_values ?? [], other_values: v.other_values ?? [] };
}
fs.writeFileSync(new URL("./calibration/dev-values.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(Object.keys(out).length);
