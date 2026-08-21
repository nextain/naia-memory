import type { ContradictionFilterProvider } from "./contradiction-filter.js";
import {
	findStructuredNegationRetirements,
	findStructuredSupersessions,
	sameStructuredIdentity,
	sameStructuredSubject,
} from "./structured-facts.js";
import type { Episode, Fact, StructuredFact } from "./types.js";

export function hasTrustedUserMutationSources(
	sourceEpisodeIds: string[],
	episodes: Episode[],
): boolean {
	return (
		sourceEpisodeIds.length > 0 &&
		sourceEpisodeIds.every(
			(id) => episodes.find((episode) => episode.id === id)?.role === "user",
		)
	);
}

export function resolveStructuredMutationPolicy(options: {
	trustedUserMutation: boolean;
	structured: StructuredFact | undefined;
	existingFacts: Fact[];
	contradictionFilter: ContradictionFilterProvider;
}): {
	trustedUserMutation: boolean;
	blockedUntrustedConflict: boolean;
	supersessions: Fact[];
	fallbackFacts: Fact[];
} {
	const {
		trustedUserMutation,
		structured,
		existingFacts,
		contradictionFilter,
	} = options;
	if (!structured) {
		return {
			trustedUserMutation,
			blockedUntrustedConflict: false,
			supersessions: [],
			fallbackFacts: [],
		};
	}
	const sameSingleIdentity = (fact: Fact) =>
		fact.status === "active" &&
		fact.structured?.cardinality === "single" &&
		structured.cardinality === "single" &&
		sameStructuredIdentity(fact.structured, structured);
	if (!trustedUserMutation) {
		return {
			trustedUserMutation,
			blockedUntrustedConflict: existingFacts.some(sameSingleIdentity),
			supersessions: [],
			fallbackFacts: [],
		};
	}
	return {
		trustedUserMutation,
		blockedUntrustedConflict: false,
		supersessions: [
			...findStructuredSupersessions(existingFacts, structured),
			...findStructuredNegationRetirements(existingFacts, structured),
		],
		fallbackFacts: existingFacts.filter(
			(fact) =>
				contradictionFilter.name !== "heuristic" &&
				fact.status === "active" &&
				!!fact.structured &&
				fact.structured.cardinality === "single" &&
				structured.polarity === "affirmed" &&
				sameStructuredSubject(fact.structured, structured),
		),
	};
}
