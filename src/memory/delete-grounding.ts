export const DELETE_EVIDENCE_KINDS = new Set([
	"explicit_removal_request",
	"durable_cessation",
]);

const INVISIBLE_OR_FILLER =
	/[\p{Cf}\p{Mn}\p{Me}\u115f\u1160\u3164\uffa0\ufe00-\ufe0f\u{e0100}-\u{e01ef}]/gu;

function hasVisibleSubstance(value: string): boolean {
	return /[\p{L}\p{N}]/u.test(value.replace(INVISIBLE_OR_FILLER, ""));
}

export interface DeleteGroundingInput {
	episodeContent: string;
	episodeRole?: string;
	evidenceKind?: unknown;
	evidenceQuote?: unknown;
	targetQuote?: unknown;
	subject?: unknown;
	property?: unknown;
	value?: unknown;
	subjectId?: unknown;
	propertyId?: unknown;
	polarity?: unknown;
}

/** Deterministic, language-preserving grounding shared by extraction and sink. */
export function hasGroundedDeleteEvidence(
	input: DeleteGroundingInput,
): boolean {
	if (
		input.episodeRole !== "user" ||
		typeof input.evidenceKind !== "string" ||
		!DELETE_EVIDENCE_KINDS.has(input.evidenceKind) ||
		typeof input.evidenceQuote !== "string" ||
		typeof input.targetQuote !== "string" ||
		typeof input.subject !== "string" ||
		typeof input.property !== "string" ||
		typeof input.value !== "string" ||
		input.polarity !== "affirmed"
	)
		return false;
	const episode = input.episodeContent.normalize("NFC").trim();
	const evidence = input.evidenceQuote.normalize("NFC").trim();
	const target = input.targetQuote.normalize("NFC").trim();
	const subject = input.subject.trim();
	const property = input.property.trim();
	const value = input.value.normalize("NFC").trim();
	const hasStableIdentity =
		typeof input.subjectId === "string" &&
		Boolean(input.subjectId.trim()) &&
		typeof input.propertyId === "string" &&
		Boolean(input.propertyId.trim());
	return (
		evidence === episode &&
		hasVisibleSubstance(evidence) &&
		hasVisibleSubstance(target) &&
		Boolean(subject && property && value) &&
		episode.includes(target) &&
		(target.toLowerCase().includes(value.toLowerCase()) || hasStableIdentity)
	);
}

/**
 * Names every grounding condition the input fails. Empty exactly when
 * hasGroundedDeleteEvidence(input) is true. Diagnostic only: it does not
 * change which deletes are accepted.
 */
export function explainDeleteGrounding(input: DeleteGroundingInput): string[] {
	const reasons: string[] = [];
	if (input.episodeRole !== "user") reasons.push("role-not-user");
	if (
		typeof input.evidenceKind !== "string" ||
		!DELETE_EVIDENCE_KINDS.has(input.evidenceKind)
	)
		reasons.push("evidence-kind");
	if (input.polarity !== "affirmed") reasons.push("polarity-not-affirmed");
	const strings = [
		["evidence-quote-missing", input.evidenceQuote],
		["target-quote-missing", input.targetQuote],
		["subject-missing", input.subject],
		["property-missing", input.property],
		["value-missing", input.value],
	] as const;
	for (const [reason, value] of strings) {
		if (typeof value !== "string" || !value.trim()) reasons.push(reason);
	}
	if (reasons.length > 0) return reasons;
	const episode = input.episodeContent.normalize("NFC").trim();
	const evidence = (input.evidenceQuote as string).normalize("NFC").trim();
	const target = (input.targetQuote as string).normalize("NFC").trim();
	const value = (input.value as string).normalize("NFC").trim();
	if (evidence !== episode) reasons.push("evidence-not-whole-episode");
	if (!hasVisibleSubstance(evidence)) reasons.push("evidence-no-substance");
	if (!hasVisibleSubstance(target)) reasons.push("target-no-substance");
	if (!episode.includes(target)) reasons.push("target-not-in-episode");
	const hasStableIdentity =
		typeof input.subjectId === "string" &&
		Boolean(input.subjectId.trim()) &&
		typeof input.propertyId === "string" &&
		Boolean(input.propertyId.trim());
	if (!target.toLowerCase().includes(value.toLowerCase()) && !hasStableIdentity)
		reasons.push("target-lacks-value-and-identity");
	return reasons;
}
