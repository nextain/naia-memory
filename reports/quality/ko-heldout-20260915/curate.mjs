// Mechanical curation loop for the held-out rows.
// 1. The author model annotates each row with the literal values it uses.
// 2. Deterministic checks reject rows (value not in turns, value in question,
//    reused project name or banned substring, value set reused by another row).
// 3. Rejected rows are regenerated with the reasons, re-annotated, re-checked,
//    at most three rounds. Row content is never edited by hand.
import fs from "node:fs";
const BASE = "https://naia-azure-foundry.cognitiveservices.azure.com/openai/v1/";
const MODEL = "deepseek-v4-flash";
const here = (p) => new URL(p, import.meta.url);
const brief = fs.readFileSync(here("./AUTHOR-BRIEF.md"), "utf8");
const rows = JSON.parse(fs.readFileSync(here("./rows.json"), "utf8"));
const log = { model: MODEL, startedAt: new Date().toISOString(), rounds: [] };

async function call(prompt, maxTokens = 3000) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const res = await fetch(`${BASE}chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.AZURE_FOUNDRY_KEY}` },
      body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: prompt }], temperature: 0.7, max_tokens: maxTokens, response_format: { type: "json_object" } }) });
    const data = await res.json();
    try { return JSON.parse(data.choices[0].message.content); } catch { if (attempt === 3) throw new Error(`unparseable response: ${res.status}`); }
  }
}

const VALUE_RULES = {
  stable: "current_values=[1턴의 기억할 값], obsolete_values=[]",
  deadline: "current_values=[1턴의 날짜], obsolete_values=[]",
  correction: "current_values=[2턴의 정정된 값], obsolete_values=[1턴의 틀린 값]",
  chain: "current_values=[3턴의 최종 값], obsolete_values=[1턴 값, 2턴 값]",
  forget: "current_values=[], obsolete_values=[지워야 할 비밀 값]",
  cancel_one: "current_values=[남긴 것], obsolete_values=[취소한 것]",
  quotation: "current_values=[사용자의 실제 선호나 사실을 나타내는 핵심어], obsolete_values=[인용된 반대 내용의 핵심어]",
  hypothetical: "current_values=[지금 상태의 핵심어], obsolete_values=[가정된 상태의 핵심어]",
  coexist: "current_values=[상황 A의 선호, 상황 B의 선호], obsolete_values=[]",
  unchanged: "current_values=[유지되는 선호의 핵심어], obsolete_values=[새로 생긴 대안의 핵심어]",
  former: "current_values=[2턴의 새 값], obsolete_values=[1턴의 이전 값]",
  at_time: "current_values=[1턴의 변경 전 값], obsolete_values=[], other_values=[2턴의 현재 값]",
  different: "current_values=[첫 프로젝트의 값], obsolete_values=[둘째 프로젝트의 값], other_values=[둘째 프로젝트의 값]",
  delete_one: "current_values=[], obsolete_values=[지울 프로젝트의 값], other_values=[남길 프로젝트의 값]",
};

async function annotate(row) {
  const out = await call(`다음은 한국어 평가 사례 하나입니다. 사례 내용은 바꾸지 말고, 사례에 쓰인 값을 발화에 적힌 글자 그대로 뽑아 주십시오.\n규칙(${row.variant}): ${VALUE_RULES[row.variant]}\n각 값은 발화 중 하나에 글자 그대로 들어 있는 짧은 부분 문자열이어야 합니다(조사 제외).\n사례: ${JSON.stringify({ turns: row.turns, question: row.question, expected: row.expected, obsolete: row.obsolete, second: row.second })}\n출력: {"current_values": [...], "obsolete_values": [...], "other_values": [...]} JSON만.`, 800);
  return { current_values: out.current_values ?? [], obsolete_values: out.obsolete_values ?? [], other_values: out.other_values ?? [] };
}

const norm = (s) => String(s).normalize("NFC").replace(/[\s'"‘’“”「」『』]/g, "").toLowerCase();
const COUNTS = { stable: [1, 0], deadline: [1, 0], correction: [1, 1], chain: [1, 2], forget: [0, 1], cancel_one: [1, 1], quotation: [1, 1], hypothetical: [1, 1], coexist: [2, 0], unchanged: [1, 1], former: [1, 1], at_time: [1, 0], different: [1, 1], delete_one: [0, 1] };
const BANNED = ["보리차","커피 원두","등대","교정본","엽서","답례품","녹음 시작","창고","도예 수업","사진 수업","안내문","작업 책상","재즈","전자음악","종이 출력본","태블릿","아카이브","입장료","검수 담당자","배포 채널","해오름","별무리","숲"];
const projectNames = (row) => [...new Set([...row.turns.join(" ").matchAll(/([가-힣]{2,4}) 프로젝트/g)].map((m) => m[1]))];

function check(index) {
  const row = rows[index];
  const reasons = [];
  const turns = norm(row.turns.join(" "));
  const values = [...(row.current_values ?? []), ...(row.obsolete_values ?? []), ...(row.other_values ?? [])];
  const [nc, no] = COUNTS[row.variant];
  if ((row.current_values ?? []).length !== nc || (row.obsolete_values ?? []).length !== no) reasons.push(`값 개수가 규칙과 다르다 (${VALUE_RULES[row.variant]})`);
  for (const v of values) if (!norm(v) || !turns.includes(norm(v))) reasons.push(`값 '${v}'이 발화에 글자 그대로 없다`);
  const q = norm(row.question);
  for (const v of values) if (norm(v) && q.includes(norm(v))) reasons.push(`질문에 값 '${v}'이 들어 있다. 값을 담지 않은 열린 질문으로 써야 한다`);
  if (row.second) for (const v of row.other_values ?? []) if (norm(v) && norm(row.second[0]).includes(norm(v))) reasons.push(`두 번째 질문에 값 '${v}'이 들어 있다`);
  const blob = JSON.stringify(row);
  for (const b of BANNED) if (blob.includes(b)) reasons.push(`금지 소재 '${b}'가 들어 있다`);
  const names = projectNames(row);
  for (const other of rows.keys()) {
    if (other === index) continue;
    const shared = names.filter((n) => projectNames(rows[other]).includes(n));
    if (shared.length) reasons.push(`프로젝트 이름 ${shared.join(", ")}이 다른 사례와 겹친다`);
    const mine = new Set(values.map(norm)); const theirs = [...(rows[other].current_values ?? []), ...(rows[other].obsolete_values ?? []), ...(rows[other].other_values ?? [])].map(norm);
    const overlap = theirs.filter((v) => v.length >= 3 && mine.has(v));
    if (overlap.length && other < index) reasons.push(`값이 다른 사례와 겹친다(${overlap.join(", ")})`);
  }
  if (row.variant === "forget" && (!row.forbidden_value || !(row.obsolete_values ?? []).map(norm).includes(norm(row.forbidden_value)))) reasons.push("forbidden_value가 obsolete_values와 다르다");
  return [...new Set(reasons)];
}

if (!process.env.SKIP_ANNOTATE) for (const row of rows) Object.assign(row, await annotate(row));
for (let round = 1; round <= 4; round += 1) {
  const failing = rows.map((_, i) => [i, check(i)]).filter(([, r]) => r.length);
  log.rounds.push({ round, failing: failing.map(([i, r]) => ({ index: i, reasons: r, row: rows[i] })) });
  console.error(`round ${round}: ${failing.length} failing`);
  if (!failing.length || round === 4) break;
  const usedQuestions = rows.map((r) => r.question).join(" / ");
  const usedProjects = [...new Set(rows.flatMap(projectNames))].join(", ");
  for (const [i, reasons] of failing) {
    const row = rows[i];
    const out = await call(`${brief}\n\n검토에서 반려된 사례 1건을 다시 작성합니다. category="${row.category}", variant="${row.variant}".\n반려 사유:\n- ${reasons.join("\n- ")}\n이미 쓰인 질문(소재가 겹치지 않게): ${usedQuestions}\n이미 쓰인 프로젝트 이름(쓰지 말 것): ${usedProjects}\n출력은 JSON 객체 하나 {"rows": [한 건]} 이며 지침의 필드를 모두 가집니다. JSON만.`);
    const fresh = out.rows?.[0];
    if (!fresh) continue;
    rows[i] = { ...fresh, category: row.category, variant: row.variant };
    Object.assign(rows[i], await annotate(rows[i]));
  }
}
fs.writeFileSync(here("./rows.json"), JSON.stringify(rows, null, 1) + "\n");
log.finishedAt = new Date().toISOString();
const logPath = here(process.env.SKIP_ANNOTATE ? "./curation-log-2.json" : "./curation-log.json");
fs.writeFileSync(logPath, JSON.stringify(log, null, 1) + "\n");
const final = rows.map((_, i) => [i, check(i)]).filter(([, r]) => r.length);
console.log(JSON.stringify(final, null, 1));
