import {
	hasGroundedDeleteEvidence,
	isLabelOnlyDeleteGrounding,
} from "./delete-grounding.js";
import type {
	DeleteCandidate,
	DeleteVerifier,
	ExtractedFact,
} from "./memory-system-api.js";
import {
	findStructuredDeletionTargets,
	sameFactContent,
	sameStructuredIdentity,
	sameStructuredLabels,
	sameStructuredValue,
} from "./structured-facts.js";
import type { Episode, Fact } from "./types.js";

const MAX_DELETE_CANDIDATES = 32;

export function hasGroundedDeleteAuthority(
	fact: Pick<
		ExtractedFact,
		"structured" | "deleteEvidence" | "sourceEpisodeIds"
	>,
	episode: Pick<Episode, "content" | "role"> | undefined,
): boolean {
	if (
		episode?.role !== "user" ||
		fact.sourceEpisodeIds.length !== 1 ||
		!fact.structured ||
		!fact.deleteEvidence
	)
		return false;
	return hasGroundedDeleteEvidence({
		episodeContent: episode.content,
		episodeRole: episode.role,
		evidenceKind: fact.deleteEvidence.kind,
		evidenceQuote: fact.deleteEvidence.evidenceQuote,
		targetQuote: fact.deleteEvidence.targetQuote,
		subject: fact.structured.subject,
		property: fact.structured.property,
		value: fact.structured.value,
		subjectId: fact.structured.subjectId,
		propertyId: fact.structured.propertyId,
		polarity: fact.structured.polarity,
	});
}

type Candidate = { fact: Fact; source: DeleteCandidate["source"] };

function labelKey(value: string): string {
	return value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function structuredCandidates(existingFacts: Fact[], fact: ExtractedFact): Fact[] {
	const proposed = fact.structured;
	if (!proposed) return [];
	const exact = findStructuredDeletionTargets(existingFacts, proposed);
	const sameIdentity = existingFacts.filter(
		(candidate) =>
			candidate.status === "active" &&
			candidate.structured?.polarity === "affirmed" &&
			Boolean(proposed.subjectId && proposed.propertyId) &&
			sameStructuredIdentity(candidate.structured, proposed),
	);
	const sameValue = sameIdentity.filter(
		(candidate) =>
			candidate.structured !== undefined &&
			sameStructuredValue(candidate.structured, proposed),
	);
	// Extractors can represent one referent with different surface forms across
	// turns. A sole value is unambiguous enough for the verifier even when it was
	// duplicated across turns; multiple distinct values remain fail-closed.
	const oneEquivalentValue = sameIdentity.every((candidate) =>
		sameIdentity.every(
			(other) =>
				candidate.structured !== undefined &&
				other.structured !== undefined &&
				sameStructuredValue(candidate.structured, other.structured),
		),
	);
	const identityFallback = oneEquivalentValue ? sameIdentity : [];
	return [...exact, ...sameValue, ...identityFallback];
}

/**
 * Candidates for a value-less request that only names the property. The
 * request must leave exactly one distinct active value under the same subject
 * and property labels; otherwise nothing is offered. `existingFacts` must be
 * the complete project-scoped fact set (consolidation passes getAll() for
 * structured operations), never a top-k search result, or a sibling value
 * outside the result would make this check pass falsely.
 */
function labelCandidates(
	existingFacts: Fact[],
	fact: ExtractedFact,
): { facts: Fact[]; siblingValues: number } {
	const proposed = fact.structured;
	if (!proposed) return { facts: [], siblingValues: 0 };
	const siblings = existingFacts.filter(
		(candidate) =>
			candidate.status === "active" &&
			candidate.structured?.polarity === "affirmed" &&
			sameStructuredLabels(candidate.structured, proposed),
	);
	const distinct: Fact[] = [];
	for (const sibling of siblings) {
		if (!distinct.some((seen) => sameStructuredValue(seen.structured!, sibling.structured!)))
			distinct.push(sibling);
	}
	return { facts: siblings, siblingValues: distinct.length };
}

/**
 * Unstructured facts whose content equals the delete operation's content. The
 * user's target quote must name the fact, the fact must be unstructured (the
 * structured path covers the rest), and it must come from an earlier episode.
 */
function stringCandidates(
	existingFacts: Fact[],
	fact: ExtractedFact,
	episode: Episode,
): Fact[] {
	const target = fact.deleteEvidence?.targetQuote;
	if (!target) return [];
	return existingFacts.filter(
		(candidate) =>
			candidate.status === "active" &&
			!candidate.structured &&
			sameFactContent(candidate.content, fact.content) &&
			labelKey(candidate.content).includes(labelKey(target)) &&
			!candidate.sourceEpisodes.includes(episode.id),
	);
}

export type DeleteResolution =
	| { status: "denied"; reason?: "no-candidate" | "sibling-values>1" | "verifier-denied" }
	| { status: "oversized" }
	| { status: "verifier_failed" }
	| { status: "authorized"; targets: Fact[]; source: DeleteCandidate["source"] };

export async function resolveDeleteTarget(options: {
	episode: Episode;
	fact: ExtractedFact;
	existingFacts: Fact[];
	verifier: DeleteVerifier;
}): Promise<DeleteResolution> {
	const { episode, fact, existingFacts } = options;
	const candidates: Candidate[] = structuredCandidates(existingFacts, fact).map((f) => ({ fact: f, source: "structured" }));
	if (
		fact.structured &&
		fact.deleteEvidence &&
		isLabelOnlyDeleteGrounding({
			episodeContent: episode.content,
			evidenceKind: fact.deleteEvidence.kind,
			targetQuote: fact.deleteEvidence.targetQuote,
			property: fact.structured.property,
			value: fact.structured.value,
			subjectId: fact.structured.subjectId,
			propertyId: fact.structured.propertyId,
		})
	) {
		const label = labelCandidates(existingFacts, fact);
		if (label.siblingValues > 1) return { status: "denied", reason: "sibling-values>1" };
		candidates.push(...label.facts.map((f) => ({ fact: f, source: "structured-label" as const })));
	}
	candidates.push(...stringCandidates(existingFacts, fact, episode).map((f) => ({ fact: f, source: "string-exact" as const })));
	// A fact found by several branches keeps the last, most specific source tag.
	const unique = [...new Map(candidates.map((c) => [c.fact.id, c])).values()];
	if (unique.length > MAX_DELETE_CANDIDATES) return { status: "oversized" };
	if (unique.length === 0) return { status: "denied", reason: "no-candidate" };
	const verifierCandidates: DeleteCandidate[] = unique.map(({ fact: candidate, source }) =>
		candidate.structured
			? {
					id: candidate.id,
					source,
					structured: {
						subject: candidate.structured.subject,
						property: candidate.structured.property,
						subjectId: candidate.structured.subjectId,
						propertyId: candidate.structured.propertyId,
						value: candidate.structured.value,
						polarity: candidate.structured.polarity,
						cardinality: candidate.structured.cardinality,
					},
				}
			: { id: candidate.id, source, content: candidate.content },
	);
	try {
		const verification = await options.verifier(episode, fact, verifierCandidates);
		if (!verification.authorized) return { status: "denied", reason: "verifier-denied" };
		const target = unique.find((c) => c.fact.id === verification.targetFactId);
		if (!target) return { status: "denied", reason: "verifier-denied" };
		const targetStructured = target.fact.structured;
		const targets = unique
			.filter(({ fact: candidate }) =>
				targetStructured
					? candidate.structured !== undefined &&
						sameStructuredIdentity(candidate.structured, targetStructured) &&
						sameStructuredValue(candidate.structured, targetStructured)
					: !candidate.structured && sameFactContent(candidate.content, target.fact.content),
			)
			.map((c) => c.fact);
		return targets.length > 0
			? { status: "authorized", targets, source: target.source }
			: { status: "denied", reason: "verifier-denied" };
	} catch {
		return { status: "verifier_failed" };
	}
}
