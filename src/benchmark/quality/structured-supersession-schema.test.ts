import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateStructuredContract, type StructuredContract } from "./structured-supersession-schema.js";

const load = () => JSON.parse(readFileSync("src/benchmark/quality/structured-supersession-contract-v3.json", "utf8")) as StructuredContract;

describe("structured supersession v3 contract", () => {
	it("accepts the frozen 108-case diagnostic with balanced languages", () => {
		const contract = load();
		expect(() => validateStructuredContract(contract)).not.toThrow();
		expect(contract.cases).toHaveLength(108);
		for (const language of ["ko", "en", "ja"]) expect(contract.cases.filter((c) => c.language === language)).toHaveLength(36);
	});

	it("rejects undisclosed review status and query copies", () => {
		const disclosure = load(); disclosure.native_review_status = "reviewed";
		expect(() => validateStructuredContract(disclosure)).toThrow(/disclose/);
		const leakage = load(); leakage.cases[0].query = leakage.cases[0].statements[0].content;
		expect(() => validateStructuredContract(leakage)).toThrow(/copies a statement/);
	});

	it("rejects language imbalance and missing provenance", () => {
		const imbalance = load(); let removed = 0; imbalance.cases = imbalance.cases.filter((c) => c.language !== "ja" || removed++ >= 7);
		expect(() => validateStructuredContract(imbalance)).toThrow(/at least 30 ja/);
		const provenance = load(); delete provenance.cases[0].family_id;
		expect(() => validateStructuredContract(provenance)).toThrow(/provenance/);
	});

	it("rejects structured identity leakage across families", () => {
		const contract = load();
		contract.cases[1].statements[0].structured.subject = contract.cases[0].statements[0].structured.subject;
		contract.cases[1].statements[0].structured.property = contract.cases[0].statements[0].structured.property;
		expect(() => validateStructuredContract(contract)).toThrow(/identity leaks/);
	});

	it("rejects an inactive statement declared as an acceptable answer", () => {
		const contract = load();
		const inactiveId = contract.cases[0].expected_inactive_statement_ids[0];
		contract.cases[0].acceptable_statement_ids = [inactiveId];
		contract.cases[0].forbidden_statement_ids = contract.cases[0].forbidden_statement_ids.filter((id) => id !== inactiveId);
		expect(() => validateStructuredContract(contract)).toThrow(/acceptable statement must be expected active/);
	});
});
