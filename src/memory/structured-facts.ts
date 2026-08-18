import type { Fact, StructuredFact } from "./types.js";

function comparisonKey(value: string): string {
	return value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function opaqueId(value: string | undefined): string {
	return value?.normalize("NFC").trim() ?? "";
}

/**
 * Compares a subject/property pair without interpreting either language.
 * Complete opaque IDs take precedence; labels are the migration fallback.
 */
export function sameStructuredIdentity(
	left: Pick<
		StructuredFact,
		"subject" | "property" | "subjectId" | "propertyId"
	>,
	right: Pick<
		StructuredFact,
		"subject" | "property" | "subjectId" | "propertyId"
	>,
): boolean {
	const leftSubjectId = opaqueId(left.subjectId);
	const leftPropertyId = opaqueId(left.propertyId);
	const rightSubjectId = opaqueId(right.subjectId);
	const rightPropertyId = opaqueId(right.propertyId);
	const hasAnyId = Boolean(
		leftSubjectId || leftPropertyId || rightSubjectId || rightPropertyId,
	);
	if (hasAnyId) {
		return Boolean(
			leftSubjectId &&
				leftPropertyId &&
				rightSubjectId &&
				rightPropertyId &&
				leftSubjectId === rightSubjectId &&
				leftPropertyId === rightPropertyId,
		);
	}
	return (
		comparisonKey(left.subject) === comparisonKey(right.subject) &&
		comparisonKey(left.property) === comparisonKey(right.property)
	);
}

/** True only when every replacement-relevant field was explicitly identical. */
export function sameStructuredFact(
	left: StructuredFact,
	right: StructuredFact,
): boolean {
	return (
		sameStructuredIdentity(left, right) &&
		comparisonKey(left.value) === comparisonKey(right.value) &&
		left.polarity === right.polarity &&
		left.cardinality === right.cardinality
	);
}

/**
 * Finds active facts matching an explicit structured deletion target exactly.
 * No identity-only or natural-language fallback is allowed: false deletion is
 * more damaging than retaining a stale fact.
 */
export function findStructuredDeletionTargets(
	existingFacts: Fact[],
	target: StructuredFact,
): Fact[] {
	if (target.polarity !== "affirmed") return [];
	return existingFacts.filter(
		(fact) =>
			fact.status === "active" &&
			!!fact.structured &&
			sameStructuredFact(fact.structured, target),
	);
}

/**
 * Returns active facts that an explicitly structured candidate may replace.
 *
 * This deliberately has no natural-language fallback: subject/property labels
 * and single-valued cardinality must already be supplied by the extractor.
 */
export function findStructuredSupersessions(
	existingFacts: Fact[],
	candidate: StructuredFact,
): Fact[] {
	// Negation is not a safe replacement signal. For example, "does not live
	// in Seoul" may be temporary, scoped, or refer to a past state.
	if (candidate.cardinality !== "single" || candidate.polarity !== "affirmed")
		return [];
	const value = comparisonKey(candidate.value);
	if (
		!comparisonKey(candidate.subject) ||
		!comparisonKey(candidate.property) ||
		!value
	)
		return [];

	return existingFacts.filter((fact) => {
		const structured = fact.structured;
		return (
			fact.status === "active" &&
			structured?.cardinality === "single" &&
			structured.polarity === "affirmed" &&
			sameStructuredIdentity(structured, candidate) &&
			comparisonKey(structured.value) !== value
		);
	});
}
