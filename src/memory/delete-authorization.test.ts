import { describe, expect, it, vi } from "vitest";
import { resolveDeleteTarget } from "./delete-authorization.js";
import type { DeleteVerifier, ExtractedFact } from "./memory-system-api.js";
import type { Episode, Fact } from "./types.js";

const episode = {
	id: "episode-delete",
	content: "더 이상 우표 수집을 하지 않아요.",
	role: "user",
} as Episode;

function fact(
	id: string,
	value: string,
	cardinality: "single" | "multi",
): Fact {
	return {
		id,
		content: `사용자 취미: ${value}`,
		status: "active",
		structured: {
			subject: "사용자",
			property: "취미",
			subjectId: "person:self",
			propertyId: "profile:hobby",
			value,
			polarity: "affirmed",
			cardinality,
		},
	} as Fact;
}

describe("delete candidate authorization", () => {
	it("does not offer a sole identity whose value differs from the named value", async () => {
		const proposed = {
			content: "ユーザーの食べ物の好み: 辛いもの",
			operation: "delete",
			structured: {
				subject: "ユーザー",
				property: "食べ物の好み",
				subjectId: "person:self",
				propertyId: "preference:food",
				value: "辛いもの",
				polarity: "affirmed",
				cardinality: "multi",
			},
			deleteEvidence: {
				kind: "durable_cessation",
				evidenceQuote: "もう辛いものは好きではありません。",
				targetQuote: "辛いもの",
			},
			sourceEpisodeIds: [episode.id],
		} as ExtractedFact;
		const spicyFood = fact("spicy", "辛い料理", "multi");
		spicyFood.structured = {
			...spicyFood.structured!,
			subject: "ユーザー",
			property: "食べ物の好み",
			propertyId: "preference:food",
		};
		const verifier = vi.fn<DeleteVerifier>(async (_ep, _fact, candidates) => ({
			authorized: true,
			targetFactId: candidates[0]?.id,
		}));

		const result = await resolveDeleteTarget({
			episode,
			fact: proposed,
			existingFacts: [spicyFood],
			verifier,
		});

		// Surface drift (辛いもの / 辛い料理) is no longer bridged: keeping a stale
		// preference is safer than archiving a fact the user did not name.
		expect(verifier).not.toHaveBeenCalled();
		expect(result).toEqual({ status: "denied", reason: "value-mismatch" });
	});

	it("authorizes all equivalent duplicate targets after one verifier selection", async () => {
		// Duplicates hold the named value itself.
		const proposed = {
			content: "ユーザーの食べ物の好み: 辛いもの",
			operation: "delete",
			structured: {
				subject: "ユーザー",
				property: "食べ物の好み",
				subjectId: "person:self",
				propertyId: "preference:food",
				value: "辛いもの",
				polarity: "affirmed",
				cardinality: "multi",
			},
			deleteEvidence: {
				kind: "durable_cessation",
				evidenceQuote: "もう辛いものは好きではありません。",
				targetQuote: "辛いもの",
			},
			sourceEpisodeIds: [episode.id],
		} as ExtractedFact;
		const first = fact("spicy-1", "辛いもの", "multi");
		const second = fact("spicy-2", "辛いもの", "multi");
		for (const candidate of [first, second]) {
			candidate.structured = {
				...candidate.structured!,
				subject: "ユーザー",
				property: "食べ物の好み",
				propertyId: "preference:food",
			};
		}
		const verifier = vi.fn<DeleteVerifier>(async () => ({
			authorized: true,
			targetFactId: first.id,
		}));

		const result = await resolveDeleteTarget({
			episode,
			fact: proposed,
			existingFacts: [first, second],
			verifier,
		});

		expect(verifier.mock.calls[0]?.[2]).toHaveLength(2);
		expect(result).toEqual({ status: "authorized", targets: [first, second], source: "structured" });
	});

	it("fails closed on value drift when an identity has multiple active values", async () => {
		const proposed = {
			content: "User food preference: hot dishes",
			operation: "delete",
			structured: {
				subject: "User",
				property: "food preference",
				subjectId: "person:self",
				propertyId: "preference:food",
				value: "hot dishes",
				polarity: "affirmed",
				cardinality: "multi",
			},
			deleteEvidence: {
				kind: "durable_cessation",
				evidenceQuote: "I no longer like hot dishes.",
				targetQuote: "hot dishes",
			},
			sourceEpisodeIds: [episode.id],
		} as ExtractedFact;
		const spicy = fact("spicy", "spicy food", "multi");
		const curry = fact("curry", "curry", "multi");
		for (const candidate of [spicy, curry]) {
			candidate.structured = {
				...candidate.structured!,
				subject: "User",
				property: "food preference",
				propertyId: "preference:food",
			};
		}
		const verifier = vi.fn<DeleteVerifier>(async () => ({ authorized: false }));

		const result = await resolveDeleteTarget({
			episode,
			fact: proposed,
			existingFacts: [spicy, curry],
			verifier,
		});

		expect(result).toEqual({ status: "denied", reason: "value-mismatch" });
		expect(verifier).not.toHaveBeenCalled();
	});

	it("never offers the kept booking when the cancelled booking was not stored", async () => {
		// Korean held-out ko-36: "book dentist and dermatology" stored only the
		// dentist fact; "cancel dermatology, keep dentist" must not archive it.
		const proposed = {
			content: "사용자 의료 예약: 피부과 예약 취소",
			operation: "delete",
			structured: { subject: "사용자", property: "의료 예약", subjectId: "person:self", propertyId: "plan:activity", value: "피부과 예약", polarity: "affirmed", cardinality: "single" },
			deleteEvidence: { kind: "explicit_removal_request", evidenceQuote: "피부과 예약은 취소하고 치과 예약만 유지해 줘.", targetQuote: "피부과 예약" },
			sourceEpisodeIds: [episode.id],
		} as ExtractedFact;
		const dentist = fact("dentist", "치과 예약", "single");
		dentist.structured = { ...dentist.structured!, property: "의료 예약", propertyId: "plan:activity" };
		const verifier = vi.fn<DeleteVerifier>(async (_e, _f, candidates) => ({ authorized: true, targetFactId: candidates[0]?.id }));

		const result = await resolveDeleteTarget({ episode, fact: proposed, existingFacts: [dentist], verifier });

		expect(verifier).not.toHaveBeenCalled();
		expect(result).toEqual({ status: "denied", reason: "value-mismatch" });
	});

	it("lets the verifier resolve extractor cardinality drift without pre-authorizing a target", async () => {
		const verifier = vi.fn<DeleteVerifier>(
			async (_episode, _proposed, candidates) => ({
				authorized: true as const,
				targetFactId:
					candidates.find(
						(candidate) => candidate.structured?.value === "우표 수집",
					)?.id ?? "missing",
			}),
		);
		const proposed = {
			content: "사용자 취미: 우표 수집",
			operation: "delete",
			structured: {
				subject: "사용자",
				property: "취미",
				subjectId: "person:self",
				propertyId: "profile:hobby",
				value: "우표 수집",
				polarity: "affirmed",
				cardinality: "multi",
			},
			deleteEvidence: {
				kind: "durable_cessation",
				evidenceQuote: episode.content,
				targetQuote: "우표 수집",
			},
			sourceEpisodeIds: [episode.id],
		} as ExtractedFact;
		const stamp = fact("stamp", "우표 수집", "single");
		const knitting = fact("knitting", "뜨개질", "multi");

		const result = await resolveDeleteTarget({
			episode,
			fact: proposed,
			existingFacts: [stamp, knitting],
			verifier,
		});

		expect(verifier.mock.calls[0]?.[2]).toEqual([
			expect.objectContaining({ id: "stamp" }),
		]);
		expect(result).toEqual({ status: "authorized", targets: [stamp], source: "structured" });
	});

	it("denies a verifier response that selects another value on the same property", async () => {
		const proposed = {
			content: "사용자 취미: 우표 수집",
			operation: "delete",
			structured: {
				subject: "사용자",
				property: "취미",
				subjectId: "person:self",
				propertyId: "profile:hobby",
				value: "우표 수집",
				polarity: "affirmed",
				cardinality: "multi",
			},
			deleteEvidence: {
				kind: "durable_cessation",
				evidenceQuote: episode.content,
				targetQuote: "우표 수집",
			},
			sourceEpisodeIds: [episode.id],
		} as ExtractedFact;
		const stamp = fact("stamp", "우표 수집", "single");
		const knitting = fact("knitting", "뜨개질", "multi");
		const verifier = vi.fn<DeleteVerifier>(async () => ({
			authorized: true,
			targetFactId: knitting.id,
		}));

		const result = await resolveDeleteTarget({
			episode,
			fact: proposed,
			existingFacts: [stamp, knitting],
			verifier,
		});

		expect(verifier.mock.calls[0]?.[2]).toEqual([
			expect.objectContaining({ id: "stamp" }),
		]);
		expect(result).toEqual({ status: "denied", reason: "verifier-denied" });
	});

	it("fails closed when more than 32 facts match the exact deletion value", async () => {
		const proposed = {
			content: "사용자 취미: 우표 수집",
			operation: "delete",
			structured: {
				subject: "사용자",
				property: "취미",
				subjectId: "person:self",
				propertyId: "profile:hobby",
				value: "우표 수집",
				polarity: "affirmed",
				cardinality: "multi",
			},
			deleteEvidence: {
				kind: "durable_cessation",
				evidenceQuote: episode.content,
				targetQuote: "우표 수집",
			},
			sourceEpisodeIds: [episode.id],
		} as ExtractedFact;
		const verifier = vi.fn<DeleteVerifier>(async () => ({ authorized: false }));

		const result = await resolveDeleteTarget({
			episode,
			fact: proposed,
			existingFacts: Array.from({ length: 33 }, (_unused, index) =>
				fact(`stamp-${index}`, "우표 수집", "single"),
			),
			verifier,
		});

		expect(result).toEqual({ status: "oversized" });
		expect(verifier).not.toHaveBeenCalled();
	});
});
