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

function labelKey(value: string): string {
	return value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/**
 * The extractor prompt prefixes every turn with "[Date: YYYY-MM-DD]"
 * (llm-fact-extractor.ts). A model that copies the whole turn copies that tag
 * too; it is not part of what the user said.
 */
const EXTRACTOR_DATE_TAG = /^\[Date: \d{4}-\d{2}-\d{2}\]\s*/;

function quotesWholeEpisode(evidence: string, episode: string): boolean {
	return evidence === episode || evidence.replace(EXTRACTOR_DATE_TAG, "") === episode;
}

function labelTokens(value: string): string[] {
	return labelKey(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * The user's words name the property label when every word of one occurs
 * inside the other. Words are compared by containment so attached particles
 * ("프로젝트의") and reordered qualifiers ("비밀번호(서리 프로젝트)") still
 * match; a label the user shortened ("이메일 비밀번호" for "테스트용 가상 이메일
 * 비밀번호") matches in the other direction.
 */
export function namesPropertyLabel(targetQuote: string, property: string): boolean {
	const target = labelTokens(targetQuote);
	const label = labelTokens(property);
	if (target.length === 0 || label.length === 0) return false;
	const joinedTarget = target.join(" ");
	const joinedLabel = label.join(" ");
	return (
		label.every((word) => joinedTarget.includes(word)) ||
		target.every((word) => joinedLabel.includes(word))
	);
}

/**
 * A value-less explicit request ("erase the warehouse door code; do not repeat
 * it") names the property instead of the value. It is grounded when the target
 * quote contains the extracted property label. The sink additionally requires
 * a single active value for that subject and property before any candidate is
 * offered (delete-authorization.ts).
 */
export function isLabelOnlyDeleteGrounding(input: DeleteGroundingInput): boolean {
	if (
		input.evidenceKind !== "explicit_removal_request" ||
		typeof input.targetQuote !== "string" ||
		typeof input.property !== "string" ||
		typeof input.value !== "string"
	)
		return false;
	const target = labelKey(input.targetQuote);
	const property = labelKey(input.property);
	const hasStableIdentity =
		typeof input.subjectId === "string" &&
		Boolean(input.subjectId.trim()) &&
		typeof input.propertyId === "string" &&
		Boolean(input.propertyId.trim());
	return (
		Boolean(property) &&
		namesPropertyLabel(target, property) &&
		!target.includes(labelKey(input.value)) &&
		!hasStableIdentity
	);
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
		quotesWholeEpisode(evidence, episode) &&
		hasVisibleSubstance(evidence) &&
		hasVisibleSubstance(target) &&
		Boolean(subject && property && value) &&
		episode.includes(target) &&
		(target.toLowerCase().includes(value.toLowerCase()) ||
			hasStableIdentity ||
			isLabelOnlyDeleteGrounding(input))
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
	if (!quotesWholeEpisode(evidence, episode)) reasons.push("evidence-not-whole-episode");
	if (!hasVisibleSubstance(evidence)) reasons.push("evidence-no-substance");
	if (!hasVisibleSubstance(target)) reasons.push("target-no-substance");
	if (!episode.includes(target)) reasons.push("target-not-in-episode");
	const hasStableIdentity =
		typeof input.subjectId === "string" &&
		Boolean(input.subjectId.trim()) &&
		typeof input.propertyId === "string" &&
		Boolean(input.propertyId.trim());
	if (
		!target.toLowerCase().includes(value.toLowerCase()) &&
		!hasStableIdentity &&
		!isLabelOnlyDeleteGrounding(input)
	)
		reasons.push("target-lacks-value-and-identity");
	return reasons;
}
