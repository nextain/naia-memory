import type { StructuredFact } from "../../memory/index.js";

export type StructuredStatement = { id: string; content: string; project: string; structured: StructuredFact };
export type StructuredContractCase = {
	id: string;
	language: string;
	query: string;
	recall_structured_query?: Pick<StructuredFact, "subject" | "property">;
	statements: StructuredStatement[];
	acceptable_statement_ids: string[];
	forbidden_statement_ids: string[];
	expected_active_statement_ids: string[];
	expected_inactive_statement_ids: string[];
	expected_history_statement_ids: string[];
	recall_project?: string;
	category?: string;
	family_id?: string;
	split?: string;
	construction?: string;
};
export type StructuredContract = {
	schema_version: string;
	purpose?: string;
	benchmark_tier?: string;
	native_review_status?: string;
	cases: StructuredContractCase[];
};

const LANGUAGES = ["ko", "en", "ja"] as const;

function normalized(value: string): string {
	return value.normalize("NFKC").toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
}

export function validateStructuredContract(contract: StructuredContract): void {
	const isV3 = contract.schema_version === "naia-memory-structured-supersession-contract-v3";
	const minimum = isV3 ? 100 : 7;
	if (!Array.isArray(contract.cases) || contract.cases.length < minimum) throw new Error(`Structured contract needs at least ${minimum} cases`);
	if (isV3 && (contract.benchmark_tier !== "generated-diagnostic" || contract.native_review_status !== "not-reviewed")) {
		throw new Error("v3 must disclose generated-diagnostic tier and not-reviewed native status");
	}
	const caseIds = new Set<string>();
	const statementIds = new Set<string>();
	const queries = new Set<string>();
	const contents = new Set<string>();
	const structuredOwners = new Map<string, string>();
	for (const c of contract.cases) {
		if (!c.id || caseIds.has(c.id) || !LANGUAGES.includes(c.language as typeof LANGUAGES[number]) || !c.query || c.statements.length < 2) throw new Error(`Invalid or duplicate case: ${c.id}`);
		caseIds.add(c.id);
		const queryKey = normalized(c.query);
		if (!queryKey || queries.has(queryKey)) throw new Error(`${c.id}: duplicate or empty normalized query`);
		queries.add(queryKey);
		const local = new Set<string>();
		for (const statement of c.statements) {
			if (!statement.id || statementIds.has(statement.id) || local.has(statement.id) || !statement.content || !statement.project || !statement.structured) throw new Error(`${c.id}: invalid statement`);
			const contentKey = normalized(statement.content);
			if (!contentKey || contents.has(contentKey)) throw new Error(`${c.id}: duplicate or empty normalized statement`);
			if (queryKey === contentKey) throw new Error(`${c.id}: query copies a statement`);
			contents.add(contentKey); statementIds.add(statement.id); local.add(statement.id);
			if (isV3) {
				const identity = [statement.project, normalized(statement.structured.subject), normalized(statement.structured.property)].join("|");
				const owner = structuredOwners.get(identity);
				if (owner && owner !== c.family_id) throw new Error(`${c.id}: structured identity leaks across families`);
				structuredOwners.set(identity, c.family_id!);
			}
		}
		for (const id of [...c.acceptable_statement_ids, ...c.forbidden_statement_ids, ...c.expected_active_statement_ids, ...c.expected_inactive_statement_ids, ...c.expected_history_statement_ids]) {
			if (!local.has(id)) throw new Error(`${c.id}: unknown statement id ${id}`);
		}
		if (c.acceptable_statement_ids.length === 0) throw new Error(`${c.id}: needs an acceptable statement`);
		if (c.acceptable_statement_ids.some((id) => c.forbidden_statement_ids.includes(id))) throw new Error(`${c.id}: acceptable and forbidden overlap`);
		if (c.acceptable_statement_ids.some((id) => !c.expected_active_statement_ids.includes(id))) throw new Error(`${c.id}: every acceptable statement must be expected active`);
		if (c.expected_active_statement_ids.some((id) => c.expected_inactive_statement_ids.includes(id))) throw new Error(`${c.id}: active and inactive expectations overlap`);
		if (c.statements.some((statement) => !c.expected_active_statement_ids.includes(statement.id) && !c.expected_inactive_statement_ids.includes(statement.id))) throw new Error(`${c.id}: every statement needs a lifecycle expectation`);
		if (isV3 && (!c.category || !c.family_id || c.split !== "diagnostic" || c.construction !== "template-generated")) throw new Error(`${c.id}: missing v3 provenance fields`);
		if (isV3 && (!c.recall_structured_query?.subject || !c.recall_structured_query.property)) throw new Error(`${c.id}: missing structured recall query`);
	}
	for (const language of LANGUAGES) {
		const required = isV3 ? 30 : 2;
		if (contract.cases.filter((c) => c.language === language).length < required) throw new Error(`Structured contract needs at least ${required} ${language} cases`);
	}
	if (isV3 && new Set(contract.cases.map((c) => c.category)).size < 4) throw new Error("v3 needs at least four diagnostic categories");
}
