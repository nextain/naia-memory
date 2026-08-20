import crypto from "node:crypto";
import {
	contentTokens,
	jaccardSimilarity,
} from "./consolidation-primitives.js";
import type { ContradictionFilterProvider } from "./contradiction-filter.js";
import type { ExtractedFact } from "./memory-system-api.js";
import {
	type ReconsolidationResult,
	findContradictionsWith,
} from "./reconsolidation.js";
import { sameStructuredFact } from "./structured-facts.js";
import type { EncodingContext, Fact } from "./types.js";
import { recordMutationOutcome } from "./usage-tracker.js";

function normalizedContent(value: string): string {
	return value
		.normalize("NFC")
		.trim()
		.replace(/[.。!?！？]+$/u, "")
		.trimEnd()
		.replace(/\s+/g, " ")
		.toLocaleLowerCase();
}

export function findDuplicateFact(
	extracted: ExtractedFact,
	existingFacts: Fact[],
): Fact | undefined {
	const structured = extracted.structured;
	if (structured) {
		return existingFacts.find(
			(fact) =>
				fact.status === "active" &&
				(normalizedContent(fact.content) ===
					normalizedContent(extracted.content) ||
					(!!fact.structured &&
						sameStructuredFact(fact.structured, structured))),
		);
	}
	return existingFacts.find(
		(fact) =>
			jaccardSimilarity(
				contentTokens(fact.content),
				contentTokens(extracted.content),
			) > 0.85,
	);
}

export async function resolveFactContradictions(options: {
	extracted: ExtractedFact;
	existingFacts: Fact[];
	trustedUserMutation: boolean;
	supersessions: Fact[];
	fallbackFacts: Fact[];
	contradictionFilter: ContradictionFilterProvider;
}): Promise<Array<{ fact: Fact; result: ReconsolidationResult }>> {
	const { extracted, existingFacts, contradictionFilter } = options;
	if (!extracted.structured) {
		const contradictions = await findContradictionsWith(
			existingFacts,
			extracted.content,
			contradictionFilter,
		);
		if (!options.trustedUserMutation && contradictions.length > 0) {
			recordMutationOutcome("untrusted_contradiction_denied");
			return [];
		}
		return contradictions;
	}
	if (!options.trustedUserMutation) return [];
	const deterministic = options.supersessions.map((fact) => ({
		fact,
		result: {
			action: "update" as const,
			updatedContent: extracted.content,
			reason: "structured lifecycle replacement",
		},
	}));
	const deterministicIds = new Set(
		options.supersessions.map((fact) => fact.id),
	);
	const contextualFacts = options.fallbackFacts.filter(
		(fact) => !deterministicIds.has(fact.id),
	);
	const verdicts = await contradictionFilter.filter(
		contextualFacts.map((existing) => ({
			existing,
			newInfo: extracted.content,
		})),
	);
	const contextual = verdicts.flatMap((verdict) => {
		const fact = contextualFacts[verdict.index];
		return fact ? [{ fact, result: verdict.result }] : [];
	});
	return [...deterministic, ...contextual];
}

export function buildNewFact(options: {
	extracted: ExtractedFact;
	now: number;
	encodingContext?: EncodingContext;
}): Fact {
	const { extracted, now, encodingContext } = options;
	const hashHex = crypto
		.createHash("sha256")
		.update(
			extracted.content + [...extracted.sourceEpisodeIds].sort().join(","),
		)
		.digest("hex")
		.slice(0, 32);
	const id = `${hashHex.slice(0, 8)}-${hashHex.slice(8, 12)}-${hashHex.slice(12, 16)}-${hashHex.slice(16, 20)}-${hashHex.slice(20, 32)}`;
	const importance = Math.max(extracted.importance, 0.7);
	return {
		id,
		content: extracted.content,
		entities: extracted.entities,
		topics: extracted.topics,
		createdAt: now,
		updatedAt: now,
		importance,
		maxEmotion: extracted.maxEmotion,
		recallCount: 0,
		lastAccessed: now,
		strength: importance,
		status: "active",
		sourceEpisodes: extracted.sourceEpisodeIds,
		encodingContext,
		structured: extracted.structured,
	};
}
