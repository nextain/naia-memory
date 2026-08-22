import { describe, expect, it } from "vitest";
import {
	type QueryIdentityOracle,
	scoreQueryIdentityPrediction,
	validateQueryIdentityOracle,
	validateQueryIdentityPublicCoverage,
} from "./query-identity-oracle.js";

function oracleCase(language: "ko" | "en" | "ja", id = language) {
	return {
		id,
		language,
		query: `query-${id}`,
		familyId: `family-${id}`,
		split: "test" as const,
		expectation: {
			kind: "identity" as const,
			subjectId: "person:self" as const,
			propertyId: "profile:residence",
		},
		provenance: {
			authorId: `author-${id}`,
			authorNativeLanguages: [language],
			reviewerId: `reviewer-${id}`,
			reviewerNativeLanguages: [language],
			reviewDecision: "accepted" as const,
		},
	};
}

describe("query identity oracle", () => {
	it("requires independent native review and prevents family split leakage", () => {
		const current = oracleCase("ko");
		const oracle: QueryIdentityOracle = {
			schemaVersion: "naia-memory-query-identity-oracle-v1",
			construction: "independent-native-reviewed",
			cases: [current],
		};
		expect(() => validateQueryIdentityOracle(oracle)).not.toThrow();
		current.provenance.reviewerId = current.provenance.authorId;
		expect(() => validateQueryIdentityOracle(oracle)).toThrow("independent");
	});

	it("separates dangerous valid-but-wrong IDs from malformed and missed pairs", () => {
		const identity = oracleCase("ko").expectation;
		expect(scoreQueryIdentityPrediction(identity, undefined)).toBe(
			"missed-identity",
		);
		expect(
			scoreQueryIdentityPrediction(identity, { subjectId: "person:self" }),
		).toBe("partial-pair");
		expect(
			scoreQueryIdentityPrediction(identity, {
				subjectId: "person:self",
				propertyId: "profile:occupation",
			}),
		).toBe("wrong-valid-identity");
		expect(
			scoreQueryIdentityPrediction(identity, {
				subjectId: "person:self",
				propertyId: "invented:value",
			}),
		).toBe("unsupported-identity");
	});

	it("counts abstention separately and rejects undersized public evidence", () => {
		const expectation = {
			kind: "abstain" as const,
			reason: "ambiguous" as const,
		};
		expect(scoreQueryIdentityPrediction(expectation, undefined)).toBe(
			"correct-abstention",
		);
		expect(
			scoreQueryIdentityPrediction(expectation, {
				subjectId: "person:self",
				propertyId: "profile:residence",
			}),
		).toBe("false-positive-on-abstention");
		expect(
			scoreQueryIdentityPrediction(
				expectation,
				[] as unknown as { subjectId?: unknown; propertyId?: unknown },
			),
		).toBe("invalid-output");
		const oracle: QueryIdentityOracle = {
			schemaVersion: "naia-memory-query-identity-oracle-v1",
			construction: "independent-native-reviewed",
			cases: [oracleCase("ko"), oracleCase("en"), oracleCase("ja")],
		};
		expect(() => validateQueryIdentityPublicCoverage(oracle)).toThrow(
			"at least 100",
		);
	});
});
