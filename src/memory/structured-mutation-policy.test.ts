import { describe, expect, it } from "vitest";
import type { ContradictionFilterProvider } from "./contradiction-filter.js";
import {
	hasTrustedUserMutationSources,
	resolveStructuredMutationPolicy,
} from "./structured-mutation-policy.js";
import type { Episode, Fact, StructuredFact } from "./types.js";

function episode(id: string, role: Episode["role"]): Episode {
	return {
		id,
		role,
		content: id,
		summary: id,
		timestamp: 1,
		importance: { importance: 0.8, surprise: 0, emotion: 0, utility: 0 },
		encodingContext: {},
		consolidated: false,
		recallCount: 0,
		lastAccessed: 1,
		strength: 0.8,
	};
}

describe("structured mutation source trust", () => {
	it("accepts every declared source when all resolve to user episodes", () => {
		expect(
			hasTrustedUserMutationSources(
				["second", "first"],
				[episode("first", "user"), episode("second", "user")],
			),
		).toBe(true);
	});

	it("rejects mixed-role and unresolved source sets", () => {
		const episodes = [
			episode("user", "user"),
			episode("assistant", "assistant"),
		];
		expect(hasTrustedUserMutationSources(["user", "assistant"], episodes)).toBe(
			false,
		);
		expect(hasTrustedUserMutationSources(["user", "missing"], episodes)).toBe(
			false,
		);
	});

	it("sends a single-to-multi schema mismatch to a non-heuristic verifier", () => {
		const existingStructured: StructuredFact = {
			subject: "User",
			subjectId: "person:self",
			property: "preferred genre",
			propertyId: "preference:music-genre",
			value: "classical",
			polarity: "affirmed",
			cardinality: "single",
		};
		const existing = {
			id: "fact",
			content: "User prefers classical",
			entities: ["User"],
			topics: ["music"],
			createdAt: 1,
			updatedAt: 1,
			importance: 0.8,
			recallCount: 0,
			lastAccessed: 1,
			strength: 0.8,
			status: "active",
			sourceEpisodes: ["episode"],
			structured: existingStructured,
		} satisfies Fact;
		const verifier = {
			name: "test-verifier",
			filter: async () => [],
		} satisfies ContradictionFilterProvider;

		const result = resolveStructuredMutationPolicy({
			trustedUserMutation: true,
			structured: {
				...existingStructured,
				value: "jazz",
				cardinality: "multi",
			},
			existingFacts: [existing],
			contradictionFilter: verifier,
		});

		expect(result.supersessions).toEqual([]);
		expect(result.fallbackFacts).toEqual([existing]);
	});

	it("sends a multi-to-single schema mismatch to a non-heuristic verifier", () => {
		const existingStructured: StructuredFact = {
			subject: "User's",
			property: "music genre preference",
			value: "classical music",
			polarity: "affirmed",
			cardinality: "multi",
		};
		const existing = {
			id: "fact",
			content: "User's music genre preference is classical music",
			entities: ["User"],
			topics: ["music"],
			createdAt: 1,
			updatedAt: 1,
			importance: 0.8,
			recallCount: 0,
			lastAccessed: 1,
			strength: 0.8,
			status: "active",
			sourceEpisodes: ["episode"],
			structured: existingStructured,
		} satisfies Fact;
		const verifier = {
			name: "test-verifier",
			filter: async () => [],
		} satisfies ContradictionFilterProvider;

		const result = resolveStructuredMutationPolicy({
			trustedUserMutation: true,
			structured: {
				subject: "User",
				subjectId: "person:self",
				property: "music preference",
				propertyId: "preference:music-genre",
				value: "jazz",
				polarity: "affirmed",
				cardinality: "single",
			},
			existingFacts: [existing],
			contradictionFilter: verifier,
		});

		expect(result.supersessions).toEqual([]);
		expect(result.fallbackFacts).toEqual([existing]);
	});
});
