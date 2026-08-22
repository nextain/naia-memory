import { describe, expect, it } from "vitest";
import {
	QUERY_IDENTITY_PROPERTY_IDS,
	type QueryIdentityOracle,
	type QueryIdentityPredictionArtifact,
	buildQueryIdentityBlindPacket,
	scoreQueryIdentityArtifact,
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

function publicOracle(): QueryIdentityOracle {
	const languages = ["ko", "en", "ja"] as const;
	const reasons = ["ambiguous", "out-of-ontology", "not-personal"] as const;
	return {
		schemaVersion: "naia-memory-query-identity-oracle-v1",
		construction: "independent-native-reviewed",
		cases: languages.flatMap((language) =>
			Array.from({ length: 36 }, (_, index) => {
				const base = oracleCase(language, `${language}-${index}`);
				if (index < 21) {
					base.expectation.propertyId = QUERY_IDENTITY_PROPERTY_IDS[index % 10];
					return base;
				}
				return {
					...base,
					expectation: {
						kind: "abstain" as const,
						reason: reasons[(index - 21) % reasons.length],
					},
				};
			}),
		),
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
		current.provenance.reviewerId = "reviewer-ko";
		current.familyId = "가족";
		expect(() => validateQueryIdentityOracle(oracle)).toThrow("family id");
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

	it("unit-tests scoring mechanics with an explicit perfect test double", () => {
		const oracle = publicOracle();
		const packet = buildQueryIdentityBlindPacket(oracle);
		expect(JSON.stringify(packet)).not.toContain("expectation");
		expect(JSON.stringify(packet)).not.toContain("authorId");
		const artifact: QueryIdentityPredictionArtifact = {
			schemaVersion: "naia-memory-query-identity-predictions-v1",
			oracleSha256: packet.oracleSha256,
			run: {
				engine: "naia-memory",
				model: "test-double",
				createdAt: "2026-08-22T00:00:00.000Z",
			},
			predictions: oracle.cases.map((current) => ({
				caseId: current.id,
				prediction:
					current.expectation.kind === "identity"
						? {
								subjectId: current.expectation.subjectId,
								propertyId: current.expectation.propertyId,
							}
						: undefined,
			})),
		};
		const score = scoreQueryIdentityArtifact(oracle, artifact);
		expect(score.gate).toBe("pass");
		expect(score.overall.overallAccuracy).toBe(1);
		expect(score.byLanguage.ko.unsafeIdentityRate).toBe(0);
		expect(score.byLanguage.ko.identityAccuracyWilson95.lower).toBeLessThan(1);

		artifact.predictions.pop();
		expect(() => scoreQueryIdentityArtifact(oracle, artifact)).toThrow(
			"missing prediction",
		);
	});

	it("rejects malformed runtime metadata before scoring", () => {
		const oracle = publicOracle();
		expect(() =>
			scoreQueryIdentityArtifact(
				oracle,
				null as unknown as QueryIdentityPredictionArtifact,
			),
		).toThrow("must be an object");
		const invalid = oracleCase("ko");
		invalid.provenance.reviewDecision = "rejected" as "accepted";
		expect(() =>
			validateQueryIdentityOracle({
				schemaVersion: "naia-memory-query-identity-oracle-v1",
				construction: "independent-native-reviewed",
				cases: [invalid],
			}),
		).toThrow("provenance");
	});

	it("rejects an artifact sealed against another oracle", () => {
		const oracle = publicOracle();
		const packet = buildQueryIdentityBlindPacket(oracle);
		expect(() =>
			scoreQueryIdentityArtifact(oracle, {
				schemaVersion: "naia-memory-query-identity-predictions-v1",
				oracleSha256: `${packet.oracleSha256[0] === "0" ? "1" : "0"}${packet.oracleSha256.slice(1)}`,
				run: {
					engine: "naia-memory",
					model: "test-double",
					createdAt: "2026-08-22T00:00:00.000Z",
				},
				predictions: [],
			}),
		).toThrow("oracle hash mismatch");
	});
});
