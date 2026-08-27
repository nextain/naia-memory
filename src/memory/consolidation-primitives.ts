import type { Episode } from "./types.js";
import type { MemoryAlgorithm } from "./algorithms/base.js";
import { AlgorithmVariantA } from "./algorithms/variantA.js";
import { AlgorithmVariantB } from "./algorithms/variantB.js";
import type { ExtractedFact } from "./memory-system-api.js";

/** Korean particles stripped from token tails when stem length >= 2. */
export const ALLOWED_KOREAN_PARTICLES: readonly string[] = [
	"을",
	"를",
	"은",
	"는",
	"이",
	"가",
	"로",
	"으로",
	"에",
	"에서",
	"의",
	"과",
	"와",
	"도",
	"만",
	"까지",
	"부터",
	"에게",
	"한테",
];

/** Jaccard threshold above which two fact contents are treated as duplicates. */
export const DEDUP_JACCARD_THRESHOLD = 0.85;

export function stripKoreanParticle(token: string): string {
	for (const particle of ALLOWED_KOREAN_PARTICLES) {
		if (token.endsWith(particle)) {
			const stem = token.slice(0, -particle.length);
			// Only strip when stem length >= 2 (CT-09)
			if (stem.length >= 2) return stem;
		}
	}
	return token;
}

export function contentTokens(text: string): Set<string> {
	const cleaned = text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, " ");
	const tokens = cleaned.split(/\s+/).filter((t) => t.length > 0);
	const out = new Set<string>();
	for (const raw of tokens) {
		const stemmed = stripKoreanParticle(raw);
		if (stemmed.length >= 3) {
			out.add(stemmed);
		}
	}
	return out;
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
	// Fail-safe: empty sets are NOT treated as duplicates (JS-03).
	if (a.size === 0 && b.size === 0) return 0;
	if (a.size === 0 || b.size === 0) return 0;
	let intersection = 0;
	for (const x of a) {
		if (b.has(x)) intersection++;
	}
	const union = a.size + b.size - intersection;
	if (union === 0) return 0;
	return intersection / union;
}

const TEMPORAL_GROUP_WINDOW_MS = 30 * 60 * 1000;
export const MAX_EPISODES_PER_CYCLE = 200;

function unionDedup<T>(a: readonly T[], b: readonly T[]): T[] {
	const seen = new Set<T>();
	const out: T[] = [];
	for (const x of a) {
		if (!seen.has(x)) {
			seen.add(x);
			out.push(x);
		}
	}
	for (const x of b) {
		if (!seen.has(x)) {
			seen.add(x);
			out.push(x);
		}
	}
	return out;
}

function factsWithinTemporalWindow(
	a: ExtractedFact,
	b: ExtractedFact,
	episodes: readonly Episode[],
): boolean {
	// If source-episode timestamps unavailable, fall back to content-only merge.
	if (episodes.length === 0) return true;
	const tsById = new Map<string, number>();
	for (const ep of episodes) tsById.set(ep.id, ep.timestamp);
	const aTimestamps = a.sourceEpisodeIds
		.map((id) => tsById.get(id))
		.filter((t): t is number => t !== undefined);
	const bTimestamps = b.sourceEpisodeIds
		.map((id) => tsById.get(id))
		.filter((t): t is number => t !== undefined);
	if (aTimestamps.length === 0 || bTimestamps.length === 0) return true;
	const minA = Math.min(...aTimestamps);
	const maxA = Math.max(...aTimestamps);
	const minB = Math.min(...bTimestamps);
	const maxB = Math.max(...bTimestamps);
	// Facts merge only if either fact's nearest timestamp is within
	// TEMPORAL_GROUP_WINDOW_MS of the other's nearest.
	const gap = Math.max(0, Math.max(minA, minB) - Math.min(maxA, maxB));
	return gap <= TEMPORAL_GROUP_WINDOW_MS;
}

/** Standalone fact-merge 유틸리티(MR-* 단위테스트로 검증). ⚠️ 현재 consolidate **hot-path 에는
 *  배선되지 않음** — 실제 발화하는 dedup 은 consolidate 루프의 inline jaccard 중복탐지다(적대검증
 *  2026-06-21 확인). export 유지(공개 유틸/미래 배선 후보)하되, "라이브 dedup=이 함수"로 오해 금지. */
function mergeRelatedFacts(
	facts: ExtractedFact[],
	sourceEpisodes?: Episode[],
): ExtractedFact[] {
	if (facts.length === 0) return [];
	const episodes = sourceEpisodes ?? [];
	const tokenCache: Set<string>[] = facts.map((f) => contentTokens(f.content));
	const merged: boolean[] = new Array(facts.length).fill(false);
	const out: ExtractedFact[] = [];

	for (let i = 0; i < facts.length; i++) {
		if (merged[i]) continue;
		let acc = facts[i] as ExtractedFact;
		merged[i] = true;
		for (let j = i + 1; j < facts.length; j++) {
			if (merged[j]) continue;
			const other = facts[j] as ExtractedFact;
			const sim = jaccardSimilarity(
				tokenCache[i] as Set<string>,
				tokenCache[j] as Set<string>,
			);
			if (
				sim > DEDUP_JACCARD_THRESHOLD &&
				factsWithinTemporalWindow(acc, other, episodes)
			) {
				acc = {
				        content: acc.content,
				        entities: unionDedup(acc.entities, other.entities),
				        topics: unionDedup(acc.topics, other.topics),
				        importance: Math.max(acc.importance, other.importance),
				        maxEmotion: Math.max(acc.maxEmotion ?? 0, other.maxEmotion ?? 0),
				        sourceEpisodeIds: unionDedup(
				                acc.sourceEpisodeIds,
				                other.sourceEpisodeIds,
				        ),
				};				merged[j] = true;
			}
		}
		out.push(acc);
	}
	return out;
}

/** @internal Test-only export for Phase D.1 primitives. */
export const __testables = {
	contentTokens,
	jaccardSimilarity,
	mergeRelatedFacts,
};

// Factory function to get the correct memory algorithm variant
export function getMemoryAlgorithm(variant: string): MemoryAlgorithm {
	switch (variant) {
		case "control":
			return new AlgorithmVariantA();
		case "treatment":
			return new AlgorithmVariantB();
		default:
			console.warn(
				`Unknown memory algorithm variant: ${variant}. Defaulting to 'control'.`,
			);
			return new AlgorithmVariantA(); // Default to control
	}
}
