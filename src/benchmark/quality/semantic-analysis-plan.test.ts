import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { MemoryUpdateContract } from "./memory-update-contract.js";
import {
	evidenceObjectSha256,
	evidenceSignaturePayload,
} from "./public-evidence-crypto.js";
import {
	type SemanticAnalysisPlan,
	isSemanticAnalysisPlan,
	isSemanticAnalysisPlanTrustPolicy,
	validateSemanticAnalysisPlan,
} from "./semantic-analysis-plan.js";

function fixture() {
	const contract: MemoryUpdateContract = {
		schemaVersion: "naia-memory-update-contract-v1",
		tier: "semantic-update-interpretation",
		construction: "independent-native-reviewed",
		familySplitFreeze: {
			frozenAt: "2026-01-01T00:00:00Z",
			digest: `sha256:${"0".repeat(64)}`,
		},
		cases: (["ko", "en", "ja"] as const).map((language) => ({
			id: `case-${language}`,
			familyId: `family-${language}`,
			split: "test",
			language,
			turns: [{ content: "x", at: "2026-01-01T00:00:00Z" }],
			query: "q",
			expectedCurrentIds: ["current"],
			forbiddenStaleIds: ["stale"],
			expectedDeletedIds: [],
			noUpdateIds: [],
			expectedDecision: "update",
		})),
	};
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	const unsigned = {
		schemaVersion: "naia-memory-semantic-analysis-plan-v2" as const,
		administrator: "external-statistician",
		contractSha256: evidenceObjectSha256(contract),
		engines: ["hindsight", "mem0", "naia"],
		primaryEngine: "naia" as const,
		primaryMetric: "currentAt1" as const,
		primaryComparisons: ["hindsight", "mem0"],
		familyWiseAlpha: 0.05,
		multiplicityAdjustment: "holm" as const,
		targetPower: 0.8,
		minimumDetectableDifference: 0.1,
		minimumPracticallyImportantDifference: 0.1,
		decisionRule: "holm-all-language-competitor-superiority" as const,
		requiredIndependentFamiliesByLanguage: { ko: 1, en: 1, ja: 1 },
		sampleSizeMethod: "paired-family simulation",
		sampleSizeAssumptionsSha256: "1".repeat(64),
		stoppingRule:
			"collect-all-frozen-test-families-no-outcome-peeking" as const,
		createdAt: "2026-01-02T00:00:00Z",
		signedAt: "2026-01-02T00:01:00Z",
		statement: "ANALYSIS_PLAN_PREREGISTERED" as const,
	};
	const plan: SemanticAnalysisPlan = {
		...unsigned,
		signatureBase64: sign(
			null,
			evidenceSignaturePayload(unsigned),
			privateKey,
		).toString("base64"),
	};
	const trustPolicy = {
		administratorPublicKeys: {
			"external-statistician": publicKey
				.export({ type: "spki", format: "pem" })
				.toString(),
		},
	};
	const campaign = {
		disclosure: { engines: ["hindsight", "mem0", "naia"] },
	};
	return { contract, plan, trustPolicy, campaign, privateKey };
}

function resign(current: ReturnType<typeof fixture>): void {
	current.plan.signatureBase64 = sign(
		null,
		evidenceSignaturePayload(current.plan),
		current.privateKey,
	).toString("base64");
}

describe("semantic analysis plan", () => {
	it("qualifies a signed pre-execution plan with met family targets", () => {
		const current = fixture();
		expect(isSemanticAnalysisPlan(current.plan)).toBe(true);
		expect(isSemanticAnalysisPlanTrustPolicy(current.trustPolicy)).toBe(true);
		expect(
			validateSemanticAnalysisPlan({
				...current,
				firstExecutionStartedAt: "2026-01-03T00:00:00Z",
			}),
		).toEqual({
			analysisPlanIntegrityQualified: true,
			plannedFamilyCount: 3,
			sampleSizeAdequacyVerified: false,
			trustedTimestampVerified: false,
		});
	});

	it("rejects post-execution signing, unmet targets, and outcome-plan mutation", () => {
		const late = fixture();
		expect(() =>
			validateSemanticAnalysisPlan({
				...late,
				firstExecutionStartedAt: late.plan.signedAt,
			}),
		).toThrow("semantic analysis plan content is invalid");

		const underpowered = fixture();
		underpowered.plan.requiredIndependentFamiliesByLanguage.ko = 2;
		resign(underpowered);
		expect(() =>
			validateSemanticAnalysisPlan({
				...underpowered,
				firstExecutionStartedAt: "2026-01-03T00:00:00Z",
			}),
		).toThrow("semantic analysis plan sample-size target is unmet");

		const mutated = fixture();
		mutated.plan.primaryMetric = "deletionLeakageRate";
		expect(() =>
			validateSemanticAnalysisPlan({
				...mutated,
				firstExecutionStartedAt: "2026-01-03T00:00:00Z",
			}),
		).toThrow("semantic analysis plan content is invalid");
	});

	it("rejects an administrator identity or key reused by another role", () => {
		const current = fixture();
		const key =
			current.trustPolicy.administratorPublicKeys["external-statistician"];
		expect(() =>
			validateSemanticAnalysisPlan({
				...current,
				firstExecutionStartedAt: "2026-01-03T00:00:00Z",
				forbiddenTrustIdentities: ["external-statistician"],
			}),
		).toThrow("semantic analysis administrator overlaps another role");
		expect(() =>
			validateSemanticAnalysisPlan({
				...current,
				firstExecutionStartedAt: "2026-01-03T00:00:00Z",
				forbiddenTrustPublicKeys: key ? [key] : [],
			}),
		).toThrow("semantic analysis administrator overlaps another role");
	});
});
