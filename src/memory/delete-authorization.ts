import { hasGroundedDeleteEvidence } from "./delete-grounding.js";
import type {
	DeleteCandidate,
	DeleteVerifier,
	ExtractedFact,
} from "./memory-system-api.js";
import {
	findStructuredDeletionTargets,
	sameStructuredIdentity,
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

function eligibleCandidates(
	existingFacts: Fact[],
	fact: ExtractedFact,
): Fact[] {
	const proposed = fact.structured;
	if (!proposed) return [];
	const exact = findStructuredDeletionTargets(existingFacts, proposed);
	const byId = existingFacts.filter(
		(candidate) =>
			candidate.status === "active" &&
			candidate.structured?.polarity === "affirmed" &&
			Boolean(proposed.subjectId && proposed.propertyId) &&
			candidate.structured.cardinality === proposed.cardinality &&
			sameStructuredIdentity(candidate.structured, proposed),
	);
	return [
		...new Map(
			[...exact, ...byId].map((candidate) => [candidate.id, candidate]),
		).values(),
	];
}

export type DeleteResolution =
	| { status: "denied" }
	| { status: "oversized" }
	| { status: "verifier_failed" }
	| { status: "authorized"; target: Fact };

export async function resolveDeleteTarget(options: {
	episode: Episode;
	fact: ExtractedFact;
	existingFacts: Fact[];
	verifier: DeleteVerifier;
}): Promise<DeleteResolution> {
	const candidates = eligibleCandidates(options.existingFacts, options.fact);
	if (candidates.length > MAX_DELETE_CANDIDATES) return { status: "oversized" };
	if (candidates.length === 0) return { status: "denied" };
	const verifierCandidates: DeleteCandidate[] = candidates.flatMap(
		(candidate) =>
			candidate.structured
				? [
						{
							id: candidate.id,
							structured: {
								subjectId: candidate.structured.subjectId,
								propertyId: candidate.structured.propertyId,
								value: candidate.structured.value,
								polarity: candidate.structured.polarity,
								cardinality: candidate.structured.cardinality,
							},
						},
					]
				: [],
	);
	try {
		const verification = await options.verifier(
			options.episode,
			options.fact,
			verifierCandidates,
		);
		if (!verification.authorized) return { status: "denied" };
		const target = candidates.find(
			(candidate) => candidate.id === verification.targetFactId,
		);
		return target ? { status: "authorized", target } : { status: "denied" };
	} catch {
		return { status: "verifier_failed" };
	}
}
