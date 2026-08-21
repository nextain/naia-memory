import { createHash } from "node:crypto";

export interface ScaleFact {
	id: string;
	statement: string;
}

export interface ContaminationReceipt {
	targetSize: number;
	baseSize: number;
	generatedSize: number;
	uniqueIds: number;
	uniqueStatements: number;
	baseDuplicateStatements: number;
	generatedStatementCollisions: number;
	exactReferenceCollisions: number;
	referenceSubstringCollisions: number;
	corpusSha256: string;
}

const KO_DOMAINS = [
	"물류",
	"천문",
	"농업",
	"제조",
	"해양",
	"건축",
	"보건",
	"에너지",
];
const EN_DOMAINS = [
	"logistics",
	"astronomy",
	"agriculture",
	"manufacturing",
	"marine",
	"architecture",
	"health",
	"energy",
];
const KO_REGIONS = [
	"가람",
	"누리",
	"다온",
	"라온",
	"마루",
	"바다",
	"새롬",
	"하람",
];
const EN_REGIONS = [
	"Aster",
	"Beryl",
	"Cedar",
	"Dover",
	"Elm",
	"Fjord",
	"Grove",
	"Haven",
];
const UNITS = ["단계", "구역", "노드", "주기"];
const EN_UNITS = ["stage", "sector", "node", "cycle"];

export function normalizeForContamination(text: string): string {
	return text
		.normalize("NFKC")
		.toLocaleLowerCase("und")
		.replace(/[\p{P}\p{S}\s]+/gu, "")
		.trim();
}

function generatedStatement(language: string, index: number): string {
	const domainIndex = index % KO_DOMAINS.length;
	const regionIndex = Math.floor(index / KO_DOMAINS.length) % KO_REGIONS.length;
	const unitIndex =
		Math.floor(index / (KO_DOMAINS.length * KO_REGIONS.length)) % UNITS.length;
	const serial = Math.floor(
		index / (KO_DOMAINS.length * KO_REGIONS.length * UNITS.length),
	);
	const code = `${String.fromCharCode(65 + (serial % 26))}${String(serial).padStart(5, "0")}`;
	const value = 1000 + ((index * 7919 + 104729) % 8999);
	if (language === "ko") {
		return `${KO_REGIONS[regionIndex]} ${KO_DOMAINS[domainIndex]} 관측소의 ${UNITS[unitIndex]} ${code} 기준값은 ${value}이다.`;
	}
	return `The ${EN_UNITS[unitIndex]} ${code} reference value at the ${EN_REGIONS[regionIndex]} ${EN_DOMAINS[domainIndex]} station is ${value}.`;
}

export function buildScaleCorpus(options: {
	language: string;
	baseFacts: ScaleFact[];
	referenceTexts: string[];
	targetSize: number;
}): { facts: ScaleFact[]; receipt: ContaminationReceipt } {
	const { language, baseFacts, referenceTexts, targetSize } = options;
	if (!Number.isSafeInteger(targetSize) || targetSize < baseFacts.length) {
		throw new Error(
			`targetSize must be an integer >= base size (${baseFacts.length})`,
		);
	}
	const referenceNorms = referenceTexts
		.map(normalizeForContamination)
		.filter((value) => value.length >= 8);
	const facts = [...baseFacts];
	for (let index = 0; facts.length < targetSize; index++) {
		facts.push({
			id: `scale-${language}-${String(index).padStart(6, "0")}`,
			statement: generatedStatement(language, index),
		});
	}
	const ids = new Set<string>();
	const statements = new Set<string>();
	let baseDuplicateStatements = 0;
	let generatedStatementCollisions = 0;
	let exactReferenceCollisions = 0;
	let referenceSubstringCollisions = 0;
	const referenceSet = new Set(referenceNorms);
	for (const fact of facts) {
		const normalized = normalizeForContamination(fact.statement);
		if (ids.has(fact.id)) {
			throw new Error(`scale corpus contains duplicate id: ${fact.id}`);
		}
		ids.add(fact.id);
		if (statements.has(normalized)) {
			if (fact.id.startsWith("scale-")) generatedStatementCollisions++;
			else baseDuplicateStatements++;
		}
		statements.add(normalized);
		if (fact.id.startsWith("scale-")) {
			if (referenceSet.has(normalized)) exactReferenceCollisions++;
			if (
				referenceNorms.some(
					(reference) =>
						normalized.includes(reference) || reference.includes(normalized),
				)
			) {
				referenceSubstringCollisions++;
			}
		}
	}
	if (generatedStatementCollisions > 0) {
		throw new Error(
			"generated scale corpus contains normalized statement collisions",
		);
	}
	if (exactReferenceCollisions > 0 || referenceSubstringCollisions > 0) {
		throw new Error("generated scale corpus overlaps labeled reference text");
	}
	const corpusSha256 = createHash("sha256")
		.update(facts.map(({ id, statement }) => `${id}\0${statement}\n`).join(""))
		.digest("hex");
	return {
		facts,
		receipt: {
			targetSize,
			baseSize: baseFacts.length,
			generatedSize: targetSize - baseFacts.length,
			uniqueIds: ids.size,
			uniqueStatements: statements.size,
			baseDuplicateStatements,
			generatedStatementCollisions,
			exactReferenceCollisions,
			referenceSubstringCollisions,
			corpusSha256,
		},
	};
}
