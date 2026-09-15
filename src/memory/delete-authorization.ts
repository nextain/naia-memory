import {
	explainDeleteGrounding,
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

/** Diagnostic twin of hasGroundedDeleteAuthority: empty exactly when it passes. */
export function explainDeleteAuthority(
	fact: Pick<
		ExtractedFact,
		"structured" | "deleteEvidence" | "sourceEpisodeIds"
	>,
	episode: Pick<Episode, "content" | "role"> | undefined,
): string[] {
	if (episode?.role !== "user") return ["role-not-user"];
	if (fact.sourceEpisodeIds.length !== 1) return ["source-episodes-not-one"];
	if (!fact.structured) return ["unstructured"];
	if (!fact.deleteEvidence) return ["evidence-missing"];
	return explainDeleteGrounding({
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

function structuredCandidates(existingFacts: Fact[], fact: ExtractedFact): { facts: Fact[]; valueMismatch: boolean } {
	const proposed = fact.structured;
	if (!proposed) return { facts: [], valueMismatch: false };
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
	// A delete that names a value never offers a fact holding a different
	// value, even when that fact is the only one under the identity: the
	// extractor may have failed to store the named value (korean held-out
	// ko-36: "cancel dermatology, keep dentist" archived the dentist booking).
	// Value-less requests are handled by the label path below.
	return {
		facts: [...exact, ...sameValue],
		valueMismatch: exact.length === 0 && sameValue.length === 0 && sameIdentity.length > 0,
	};
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
 * Unstructured facts named by the user's target quote. The fact must be
 * unstructured (the structured path covers the rest), come from an earlier
 * episode, and either equal the delete operation's content ("string-exact")
 * or contain the proposed value literally ("string-value": the extractor
 * stored "금고 비밀번호(테스트용): 3852" without structure, and the delete
 * names value 3852).
 */
function stringCandidates(
	existingFacts: Fact[],
	fact: ExtractedFact,
	episode: Episode,
): Candidate[] {
	const target = fact.deleteEvidence?.targetQuote;
	if (!target) return [];
	const value = fact.structured?.value ? labelKey(fact.structured.value) : "";
	const found: Candidate[] = [];
	for (const candidate of existingFacts) {
		if (
			candidate.status !== "active" ||
			candidate.structured ||
			!labelKey(candidate.content).includes(labelKey(target)) ||
			candidate.sourceEpisodes.includes(episode.id)
		)
			continue;
		if (sameFactContent(candidate.content, fact.content))
			found.push({ fact: candidate, source: "string-exact" });
		else if (value && labelKey(candidate.content).includes(value))
			found.push({ fact: candidate, source: "string-value" });
	}
	return found;
}

export type DeleteResolution =
	| { status: "denied"; reason?: "no-candidate" | "value-mismatch" | "sibling-values>1" | "verifier-denied" }
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
	const structured = structuredCandidates(existingFacts, fact);
	const candidates: Candidate[] = structured.facts.map((f) => ({ fact: f, source: "structured" }));
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
	candidates.push(...stringCandidates(existingFacts, fact, episode));
	// A fact found by several branches keeps the last, most specific source tag.
	const unique = [...new Map(candidates.map((c) => [c.fact.id, c])).values()];
	if (unique.length > MAX_DELETE_CANDIDATES) return { status: "oversized" };
	if (unique.length === 0) return { status: "denied", reason: structured.valueMismatch ? "value-mismatch" : "no-candidate" };
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
