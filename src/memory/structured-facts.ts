import type { Fact, StructuredFact } from "./types.js";

function comparisonKey(value: string): string {
	return value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function opaqueId(value: string | undefined): string {
	return value?.normalize("NFC").trim() ?? "";
}

export function sameStructuredSubject(
	left: Pick<StructuredFact, "subject" | "subjectId">,
	right: Pick<StructuredFact, "subject" | "subjectId">,
): boolean {
	const leftId = opaqueId(left.subjectId);
	const rightId = opaqueId(right.subjectId);
	if (leftId || rightId)
		return Boolean(leftId && rightId && leftId === rightId);
	return comparisonKey(left.subject) === comparisonKey(right.subject);
}

function sameMultiValue(left: string, right: string): boolean {
	const a = comparisonKey(left);
	const b = comparisonKey(right);
	if (a === b) return true;
	if (!/^[a-z]{4,}$/.test(a) || !/^[a-z]{4,}$/.test(b)) return false;
	const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
	return !shorter.endsWith("s") && longer === `${shorter}s`;
}

/** Compares values without requiring extractor cardinality agreement. */
export function sameStructuredValue(
	left: Pick<StructuredFact, "value" | "cardinality">,
	right: Pick<StructuredFact, "value" | "cardinality">,
): boolean {
	return left.cardinality === "multi" || right.cardinality === "multi"
		? sameMultiValue(left.value, right.value)
		: comparisonKey(left.value) === comparisonKey(right.value);
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
		sameStructuredValue(left, right) &&
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

/**
 * Finds an active affirmative fact explicitly negated by the candidate.
 * Identity, value, and cardinality must all match; negation never retires a
 * merely related value or another member of a multi-valued property.
 */
export function findStructuredNegationRetirements(
	existingFacts: Fact[],
	candidate: StructuredFact,
): Fact[] {
	if (candidate.polarity !== "negated") return [];
	return existingFacts.filter((fact) => {
		const structured = fact.structured;
		return (
			fact.status === "active" &&
			structured?.polarity === "affirmed" &&
			structured.cardinality === candidate.cardinality &&
			sameStructuredIdentity(structured, candidate) &&
			(candidate.cardinality === "multi"
				? sameMultiValue(structured.value, candidate.value)
				: comparisonKey(structured.value) === comparisonKey(candidate.value))
		);
	});
}
