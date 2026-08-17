import type { Fact, StructuredFact } from "./types.js";

function comparisonKey(value: string): string {
	return value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/** True only when every replacement-relevant field was explicitly identical. */
export function sameStructuredFact(
	left: StructuredFact,
	right: StructuredFact,
): boolean {
	return (
		comparisonKey(left.subject) === comparisonKey(right.subject) &&
		comparisonKey(left.property) === comparisonKey(right.property) &&
		comparisonKey(left.value) === comparisonKey(right.value) &&
		left.polarity === right.polarity &&
		left.cardinality === right.cardinality
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
	if (candidate.cardinality !== "single" || candidate.polarity !== "affirmed") return [];
	const subject = comparisonKey(candidate.subject);
	const property = comparisonKey(candidate.property);
	const value = comparisonKey(candidate.value);
	if (!subject || !property || !value) return [];

	return existingFacts.filter((fact) => {
		const structured = fact.structured;
		return (
			fact.status === "active" &&
			structured?.cardinality === "single" &&
			structured.polarity === "affirmed" &&
			comparisonKey(structured.subject) === subject &&
			comparisonKey(structured.property) === property &&
			comparisonKey(structured.value) !== value
		);
	});
}
