import { createMiraclLanguageComparison } from "./miracl-language-comparison.js";
import {
	MIRACL_PREREGISTERED_LANGUAGES,
	type MiraclEvidenceLanguage,
} from "./miracl-multilingual-contract.js";
import { sha256Bytes } from "./native-full-corpus-evidence.js";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";

interface LanguageInput {
	completionEvidenceText: string;
	comparisonText: string;
}

interface Comparison {
	schemaVersion?: unknown;
	language?: unknown;
	role?: unknown;
	benchmark?: unknown;
	sourceEvidenceSha256?: unknown;
	publicClaimEligible?: unknown;
	comparisonPolicy?: { aggregation?: unknown };
	metrics?: { ndcgAt10?: unknown; recallAt100?: unknown };
	hybridReferenceOutcome?: unknown;
}

function canonicalObject(value: unknown): string {
	return evidenceObjectSha256(value);
}

export function createMiraclMultilingualTransferGate(
	inputs: readonly LanguageInput[],
) {
	if (inputs.length !== MIRACL_PREREGISTERED_LANGUAGES.length)
		throw new Error("all preregistered language inputs are required");

	const byLanguage = new Map<
		MiraclEvidenceLanguage,
		{
			completionEvidenceText: string;
			comparisonText: string;
			comparison: Comparison;
		}
	>();
	for (const input of inputs) {
		const expected = createMiraclLanguageComparison(
			input.completionEvidenceText,
		);
		const supplied = JSON.parse(input.comparisonText) as Comparison;
		if (canonicalObject(supplied) !== canonicalObject(expected))
			throw new Error("comparison does not reproduce from completion evidence");
		const language = supplied.language;
		if (language !== "ko" && language !== "en" && language !== "ar")
			throw new Error("unsupported comparison language");
		if (byLanguage.has(language))
			throw new Error("duplicate comparison language");
		if (
			supplied.schemaVersion !== "naia-memory-miracl-language-comparison-v1" ||
			supplied.publicClaimEligible !== false ||
			supplied.comparisonPolicy?.aggregation !== "none"
		)
			throw new Error("invalid language comparison boundary");
		byLanguage.set(language, { ...input, comparison: supplied });
	}
	for (const language of MIRACL_PREREGISTERED_LANGUAGES)
		if (!byLanguage.has(language))
			throw new Error(`missing preregistered language: ${language}`);

	const languages = MIRACL_PREREGISTERED_LANGUAGES.map((language) => {
		const item = byLanguage.get(language);
		if (!item) throw new Error(`missing preregistered language: ${language}`);
		return {
			language,
			role: item.comparison.role,
			benchmark: item.comparison.benchmark,
			completionEvidenceSha256: sha256Bytes(item.completionEvidenceText),
			comparisonSha256: sha256Bytes(item.comparisonText),
			metrics: item.comparison.metrics,
			hybridReferenceOutcome: item.comparison.hybridReferenceOutcome,
		};
	});

	return {
		schemaVersion: "naia-memory-miracl-multilingual-transfer-gate-v1",
		verdict: "COMPLETE_NO_POOLED_CLAIM",
		publicClaimEligible: false,
		claimBoundary:
			"Completeness proves that every preregistered language was measured and reported independently. It does not establish current SOTA, memory-engine superiority, or a pooled multilingual quality score.",
		aggregation: "none",
		requiredLanguages: [...MIRACL_PREREGISTERED_LANGUAGES],
		languages,
	};
}
