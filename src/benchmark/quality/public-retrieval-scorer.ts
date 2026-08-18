export const PUBLIC_RETRIEVAL_SCORING_POLICY_ID = "exact-current-hit-at-k-v1";

export function publicRetrievalMetricName(topK: number): string {
	if (!Number.isInteger(topK) || topK < 1)
		throw new Error("topK must be a positive integer");
	return `current-hit@${topK}`;
}

export const PUBLIC_RETRIEVAL_SCORING_POLICY = {
	schemaVersion: "naia-memory-public-scoring-policy-v1",
	policyId: PUBLIC_RETRIEVAL_SCORING_POLICY_ID,
	outputSchema: "json-array-of-opaque-retrieval-ids",
	window: "first-top-k-ids",
	passCondition: "expected-id-present-and-no-forbidden-id-present",
	invalidOutputScore: 0,
} as const;

export type PublicRetrievalExpectation = {
	expected: string[];
	forbidden?: string[];
};

export type PublicRetrievalJudgment = {
	score: 0 | 1;
	judgment: string;
};

/**
 * Engine-neutral scorer for public evidence. Engine output is a JSON array of
 * opaque retrieval IDs. A case passes only when an expected current ID is in
 * the frozen top-k window and no forbidden/stale ID is present there.
 */
export function scorePublicRetrieval(
	output: string,
	expectation: PublicRetrievalExpectation,
	topK: number,
): PublicRetrievalJudgment {
	if (!Number.isInteger(topK) || topK < 1)
		throw new Error("topK must be a positive integer");
	if (expectation.expected.length === 0)
		throw new Error("expected IDs must not be empty");
	let decoded: unknown;
	try {
		decoded = JSON.parse(output);
	} catch {
		return { score: 0, judgment: "invalid-output-json" };
	}
	if (!Array.isArray(decoded)) {
		return { score: 0, judgment: "invalid-retrieval-id-list" };
	}
	const retrieved = decoded.slice(0, topK);
	if (retrieved.some((item) => typeof item !== "string" || !item.trim())) {
		return { score: 0, judgment: "invalid-retrieval-id-list" };
	}
	const expected = new Set(expectation.expected);
	const forbidden = new Set(expectation.forbidden ?? []);
	const expectedHit = retrieved.some((id) => expected.has(id));
	const forbiddenHit = retrieved.some((id) => forbidden.has(id));
	if (forbiddenHit) return { score: 0, judgment: "forbidden-id-retrieved" };
	if (!expectedHit) return { score: 0, judgment: "expected-id-absent" };
	return { score: 1, judgment: "expected-id-present-without-forbidden-id" };
}
