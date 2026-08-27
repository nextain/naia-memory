import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StructuredContractCase, StructuredStatement } from "./structured-supersession-schema.js";

type Language = "ko" | "en" | "ja";
const languages: Language[] = ["ko", "en", "ja"];
const subjects = {
	ko: ["사용자", "고객", "연구원", "기획자", "개발자", "디자이너"],
	en: ["user", "customer", "researcher", "planner", "developer", "designer"],
	ja: ["ユーザー", "顧客", "研究者", "企画者", "開発者", "デザイナー"],
};
const others = { ko: "동료", en: "colleague", ja: "同僚" };
const properties = {
	ko: ["거주 도시", "선호 편집기", "근무 지역", "기본 언어", "회의 요일", "배포 채널"],
	en: ["home city", "preferred editor", "work region", "default language", "meeting day", "release channel"],
	ja: ["居住都市", "好みのエディター", "勤務地域", "既定言語", "会議曜日", "配布チャンネル"],
};
const values = [
	["서울", "부산", "Seoul", "Busan", "ソウル", "釜山"],
	["Vim", "Helix", "Vim", "Helix", "Vim", "Helix"],
	["아시아", "유럽", "Asia", "Europe", "アジア", "ヨーロッパ"],
	["한국어", "영어", "Korean", "English", "韓国語", "英語"],
	["화요일", "목요일", "Tuesday", "Thursday", "火曜日", "木曜日"],
	["안정", "시험", "stable", "beta", "安定版", "ベータ版"],
];
const skills = {
	ko: [["TypeScript", "Rust"], ["Python", "Go"], ["React", "Svelte"], ["Docker", "Kubernetes"], ["PostgreSQL", "SQLite"], ["PyTorch", "ONNX"]],
	en: [["TypeScript", "Rust"], ["Python", "Go"], ["React", "Svelte"], ["Docker", "Kubernetes"], ["PostgreSQL", "SQLite"], ["PyTorch", "ONNX"]],
	ja: [["TypeScript", "Rust"], ["Python", "Go"], ["React", "Svelte"], ["Docker", "Kubernetes"], ["PostgreSQL", "SQLite"], ["PyTorch", "ONNX"]],
};

function text(language: Language, kind: "statement" | "query" | "exclude", subject: string, property: string, value = ""): string {
	if (language === "ko") return kind === "statement" ? `${subject}의 ${property}: ${value}` : kind === "exclude" ? `${subject}의 현재 ${property}는 무엇인가? 동료 정보는 제외해.` : `${subject}에게 지금 적용되는 ${property}는 무엇인가?`;
	if (language === "ja") return kind === "statement" ? `${subject}の${property}: ${value}` : kind === "exclude" ? `${subject}の現在の${property}は何ですか？同僚の情報は除外してください。` : `${subject}に現在適用される${property}は何ですか？`;
	return kind === "statement" ? `${subject}'s ${property}: ${value}` : kind === "exclude" ? `What is the ${subject}'s current ${property}, excluding the colleague?` : `What ${property} currently applies to the ${subject}?`;
}

function statement(id: string, content: string, project: string, subject: string, property: string, value: string, cardinality: "single" | "multi" = "single"): StructuredStatement {
	return { id, content, project, structured: { subject, property, value, polarity: "affirmed", cardinality, provenance: "caller" } };
}

function metadata(language: Language, family: string, category: string) {
	return { id: `${language}-${family}`, language, family_id: family, category, split: "diagnostic", construction: "template-generated" };
}

const cases: StructuredContractCase[] = [];
for (const language of languages) {
	const offset = language === "ko" ? 0 : language === "en" ? 2 : 4;
	for (let round = 0; round < 2; round++) {
		for (let index = 0; index < 6; index++) {
			const family = `replacement-${round + 1}-${index + 1}`;
			const subject = subjects[language][index]; const property = `${properties[language][index]} replacement ${round + 1}`;
			const oldValue = values[index][offset]; const newValue = values[index][offset + 1];
			const oldId = `${language}-${family}-old`; const newId = `${language}-${family}-new`;
			cases.push({ ...metadata(language, family, "replacement"), query: `${text(language, "query", subject, property)} ${round === 1 ? (language === "ko" ? "최신 변경 기준으로." : language === "ja" ? "最新の変更を基準に。" : "Use the latest update.") : ""}`.trim(), statements: [statement(oldId, text(language, "statement", subject, property, oldValue), "profile", subject, property, oldValue), statement(newId, text(language, "statement", subject, property, newValue), "profile", subject, property, newValue)], acceptable_statement_ids: [newId], forbidden_statement_ids: [oldId], expected_active_statement_ids: [newId], expected_inactive_statement_ids: [oldId], expected_history_statement_ids: [oldId, newId] });
		}
	}
	for (let round = 0; round < 2; round++) {
		for (let index = 0; index < 6; index++) {
			const family = `entity-confusion-${round + 1}-${index + 1}`;
			const subject = subjects[language][index]; const property = `${properties[language][index]} entity ${round + 1}`; const other = others[language];
			const oldValue = values[index][offset]; const newValue = values[index][offset + 1];
			const oldId = `${language}-${family}-old`; const newId = `${language}-${family}-new`; const otherId = `${language}-${family}-other`;
			cases.push({ ...metadata(language, family, "entity-confusion"), query: `${text(language, "exclude", subject, property)} ${round === 1 ? (language === "ko" ? "최신값만." : language === "ja" ? "最新値のみ。" : "Latest value only.") : ""}`.trim(), statements: [statement(oldId, `${text(language, "statement", subject, property, oldValue)} (${round + 1})`, "profile", subject, property, oldValue), statement(newId, `${text(language, "statement", subject, property, newValue)} (${round + 1})`, "profile", subject, property, newValue), statement(otherId, `${text(language, "statement", other, property, newValue)} (${round + 1})`, "profile", other, property, newValue)], acceptable_statement_ids: [newId], forbidden_statement_ids: [oldId, otherId], expected_active_statement_ids: [newId, otherId], expected_inactive_statement_ids: [oldId], expected_history_statement_ids: [oldId, newId] });
		}
	}
	for (let index = 0; index < 6; index++) {
		const family = `multi-value-${index + 1}`; const subject = subjects[language][index]; const property = language === "ko" ? `기술 묶음 ${index + 1}` : language === "ja" ? `技術セット${index + 1}` : `skill set ${index + 1}`;
		const [a, b] = skills[language][index]; const aId = `${language}-${family}-a`; const bId = `${language}-${family}-b`;
		cases.push({ ...metadata(language, family, "multi-value-retention"), query: text(language, "query", subject, property), statements: [statement(aId, text(language, "statement", subject, property, a), "profile", subject, property, a, "multi"), statement(bId, text(language, "statement", subject, property, b), "profile", subject, property, b, "multi")], acceptable_statement_ids: [aId, bId], forbidden_statement_ids: [], expected_active_statement_ids: [aId, bId], expected_inactive_statement_ids: [], expected_history_statement_ids: [aId, bId] });
	}
	for (let index = 0; index < 6; index++) {
		const family = `project-boundary-${index + 1}`; const subject = subjects[language][index]; const property = properties[language][index]; const personal = `${language}-${family}-personal`; const work = `${language}-${family}-work`;
		cases.push({ ...metadata(language, family, "project-boundary"), query: `${text(language, "query", subject, property)} personal`, statements: [statement(personal, `${text(language, "statement", subject, property, values[index][offset])} personal`, "personal", subject, property, values[index][offset]), statement(work, `${text(language, "statement", subject, property, values[index][offset + 1])} work`, "work", subject, property, values[index][offset + 1])], acceptable_statement_ids: [personal], forbidden_statement_ids: [work], expected_active_statement_ids: [personal, work], expected_inactive_statement_ids: [], expected_history_statement_ids: [personal], recall_project: "personal" });
	}
}

for (const benchmarkCase of cases) {
	const acceptable = benchmarkCase.statements.find((item) => benchmarkCase.acceptable_statement_ids.includes(item.id));
	if (!acceptable) throw new Error(`${benchmarkCase.id}: no acceptable statement`);
	benchmarkCase.recall_structured_query = {
		subject: acceptable.structured.subject,
		property: acceptable.structured.property,
	};
}

const output = {
	schema_version: "naia-memory-structured-supersession-contract-v3",
	purpose: "Frozen 108-case multilingual generated diagnostic for lifecycle and retrieval exposure. Translation families are correlated; this is not an independently authored or native-reviewed publication benchmark.",
	benchmark_tier: "generated-diagnostic",
	native_review_status: "not-reviewed",
	cases,
};
writeFileSync(join(process.cwd(), "src/benchmark/quality/structured-supersession-contract-v3.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(`wrote ${cases.length} cases (${languages.map((language) => `${language}=${cases.filter((c) => c.language === language).length}`).join(", ")})`);
