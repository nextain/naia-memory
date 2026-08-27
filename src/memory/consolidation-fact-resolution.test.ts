import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFactContradictions } from "./consolidation-fact-resolution.js";
import type { ContradictionFilterProvider } from "./contradiction-filter.js";
import type { ExtractedFact } from "./memory-system-api.js";
import type { Fact } from "./types.js";
import { getUsage, resetUsage } from "./usage-tracker.js";

const existing: Fact = {
	id: "existing",
	content: "User lives in Seoul",
	entities: ["User"],
	topics: ["residence"],
	createdAt: 1,
	updatedAt: 1,
	importance: 0.8,
	recallCount: 0,
	lastAccessed: 1,
	strength: 0.8,
	status: "active",
	sourceEpisodes: ["user-episode"],
	structured: {
		subject: "User",
		subjectId: "person:self",
		property: "residence",
		propertyId: "profile:residence",
		value: "Seoul",
		polarity: "affirmed",
		cardinality: "single",
	},
};

const extracted: ExtractedFact = {
	content: "User lives in Busan",
	entities: ["User"],
	topics: ["residence"],
	importance: 0.8,
	sourceEpisodeIds: ["assistant-episode"],
	structured: {
		subject: "User",
		subjectId: "person:self",
		property: "residence",
		propertyId: "profile:residence",
		value: "Busan",
		polarity: "affirmed",
		cardinality: "single",
	},
};

describe("resolveFactContradictions trust boundary", () => {
	beforeEach(() => resetUsage());
	it("rejects untrusted structured mutations even when candidates are supplied", async () => {
		const filter = {
			name: "test",
			filter: vi.fn().mockResolvedValue([
				{
					index: 0,
					result: {
						action: "update",
						updatedContent: extracted.content,
						reason: "test",
					},
				},
			]),
		} satisfies ContradictionFilterProvider;

		const result = await resolveFactContradictions({
			extracted,
			existingFacts: [existing],
			trustedUserMutation: false,
			supersessions: [existing],
			fallbackFacts: [existing],
			contradictionFilter: filter,
			contextualEvidence: "I now use the new value instead of the old value.",
		});

		expect(result).toEqual([]);
		expect(filter.filter).not.toHaveBeenCalled();
	});

	it("measures a denied untrusted unstructured contradiction", async () => {
		const filter = {
			name: "test",
			filter: vi.fn().mockResolvedValue([
				{
					index: 0,
					result: {
						action: "update",
						updatedContent: "User lives in Busan",
						reason: "contradiction",
					},
				},
			]),
		} satisfies ContradictionFilterProvider;
		const result = await resolveFactContradictions({
			extracted: { ...extracted, structured: undefined },
			existingFacts: [existing],
			trustedUserMutation: false,
			supersessions: [],
			fallbackFacts: [],
			contradictionFilter: filter,
		});

		expect(result).toEqual([]);
		expect(filter.filter).toHaveBeenCalledOnce();
		expect(getUsage().mutationOutcomes).toEqual({
			untrusted_contradiction_denied: 1,
			structured_conflict_denied: 0,
			structured_duplicate_noop: 0,
			structured_duplicate_reconciled: 0,
			structured_supersession_applied: 0,
			structured_fact_created: 0,
		});
	});

	it("uses trusted source evidence for contextual verification but stores the normalized fact", async () => {
		const filter = {
			name: "test",
			filter: vi.fn().mockResolvedValue([
				{
					index: 0,
					result: {
						action: "update" as const,
						updatedContent: "raw replacement utterance",
						reason: "explicit replacement",
					},
				},
			]),
		} satisfies ContradictionFilterProvider;

		const result = await resolveFactContradictions({
			extracted,
			existingFacts: [existing],
			trustedUserMutation: true,
			supersessions: [],
			fallbackFacts: [existing],
			contradictionFilter: filter,
			contextualEvidence: "I use Busan instead of Seoul now.",
		});

		expect(filter.filter).toHaveBeenCalledWith([
			{ existing, newInfo: "I use Busan instead of Seoul now." },
		]);
		expect(result[0]?.result.updatedContent).toBe(extracted.content);
	});
});
