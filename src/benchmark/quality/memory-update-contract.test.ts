import { describe, expect, it } from "vitest";
import {
	type MemoryUpdateContract,
	computeFamilySplitDigest,
	validateMemoryUpdateContract,
	validateSemanticDiagnosticCoverage,
} from "./memory-update-contract.js";
import diagnostic from "./memory-update-semantic-diagnostic-v1.json";

function semanticCase(language: "ko" | "en" | "ja", id = language) {
	return {
		id,
		familyId: `family-${id}`,
		split: "test" as const,
		language,
		turns: [{ content: "value changed", at: "2026-01-01T00:00:00Z" }],
		query: `query-${id}`,
		expectedCurrentIds: ["current"],
		forbiddenStaleIds: ["stale"],
		expectedDeletedIds: [],
		noUpdateIds: [],
		expectedDecision: "update" as const,
	};
}

function reviewedCase(language: "ko" | "en" | "ja", id = language) {
	return {
		...semanticCase(language, id),
		provenance: {
			authorId: `author-${language}`,
			authorNativeLanguages: [language],
			authoredAt: "2026-01-02T00:00:00Z",
			reviewerId: `reviewer-${language}`,
			reviewerNativeLanguages: [language],
			reviewedAt: "2026-01-03T00:00:00Z",
			reviewDecision: "accepted" as const,
		},
	};
}

describe("memory update contract", () => {
	it("freezes update, delete, and no-update diagnostics in all three languages", () => {
		expect(() =>
			validateSemanticDiagnosticCoverage(diagnostic as MemoryUpdateContract),
		).not.toThrow();
		expect(diagnostic.cases).toHaveLength(9);
	});

	it("rejects a multilingual diagnostic with a missing decision cell", () => {
		const contract = structuredClone(diagnostic) as MemoryUpdateContract;
		contract.cases = contract.cases.filter(
			(current) =>
				!(current.language === "ja" && current.expectedDecision === "delete"),
		);
		expect(() => validateSemanticDiagnosticCoverage(contract)).toThrow(
			"requires ja/delete",
		);
	});

	it("accepts an independently reviewed multilingual semantic contract", () => {
		const cases = [reviewedCase("ko"), reviewedCase("en"), reviewedCase("ja")];
		const contract: MemoryUpdateContract = {
			schemaVersion: "naia-memory-update-contract-v1",
			tier: "semantic-update-interpretation",
			construction: "independent-native-reviewed",
			familySplitFreeze: {
				frozenAt: "2026-01-04T00:00:00Z",
				digest: computeFamilySplitDigest(cases) as `sha256:${string}`,
			},
			cases,
		};
		expect(() => validateMemoryUpdateContract(contract)).not.toThrow();
	});

	it("rejects self-reviewed evidence and a stale family split freeze", () => {
		const cases = [reviewedCase("ko"), reviewedCase("en"), reviewedCase("ja")];
		cases[0]!.provenance.reviewerId = cases[0]!.provenance.authorId;
		const contract: MemoryUpdateContract = {
			schemaVersion: "naia-memory-update-contract-v1",
			tier: "semantic-update-interpretation",
			construction: "independent-native-reviewed",
			familySplitFreeze: {
				frozenAt: "2026-01-04T00:00:00Z",
				digest: `sha256:${"0".repeat(64)}`,
			},
			cases,
		};
		expect(() => validateMemoryUpdateContract(contract)).toThrow(
			"author and reviewer must be independent",
		);
		cases[0]!.provenance.reviewerId = "reviewer-ko";
		expect(() => validateMemoryUpdateContract(contract)).toThrow(
			"freeze digest does not match",
		);
	});

	it("forbids oracle lifecycle operations in the semantic tier", () => {
		const current = {
			...semanticCase("ko"),
			split: "diagnostic" as const,
			lifecycleOperations: [
				{
					op: "delete" as const,
					logicalId: "stale",
					at: "2026-01-01T00:00:00Z",
				},
			],
		};
		const contract = {
			schemaVersion: "naia-memory-update-contract-v1",
			tier: "semantic-update-interpretation",
			construction: "generated-diagnostic",
			cases: [current],
		} as const;
		expect(() => validateMemoryUpdateContract(contract)).toThrow(
			"semantic tier forbids",
		);
	});

	it("rejects contradictory lifecycle labels", () => {
		const current = {
			...semanticCase("ko"),
			split: "diagnostic" as const,
			forbiddenStaleIds: ["current"],
		};
		const contract = {
			schemaVersion: "naia-memory-update-contract-v1",
			tier: "semantic-update-interpretation",
			construction: "generated-diagnostic",
			cases: [current],
		} as const;
		expect(() => validateMemoryUpdateContract(contract)).toThrow("overlap");
	});

	it("prevents semantic families from leaking across development and test", () => {
		const development = {
			...reviewedCase("ko", "dev"),
			familyId: "same-family",
			split: "development" as const,
		};
		const test = { ...reviewedCase("ko", "test"), familyId: "same-family" };
		const contract: MemoryUpdateContract = {
			schemaVersion: "naia-memory-update-contract-v1",
			tier: "semantic-update-interpretation",
			construction: "independent-native-reviewed",
			cases: [development, test, reviewedCase("en"), reviewedCase("ja")],
		};
		expect(() => validateMemoryUpdateContract(contract)).toThrow(
			"family crosses evaluation splits",
		);
	});

	it("rejects generated fixtures presented as held-out evidence", () => {
		const contract: MemoryUpdateContract = {
			schemaVersion: "naia-memory-update-contract-v1",
			tier: "semantic-update-interpretation",
			construction: "generated-diagnostic",
			cases: [semanticCase("ko")],
		};
		expect(() => validateMemoryUpdateContract(contract)).toThrow(
			"must remain diagnostic",
		);
	});

	it("rejects lifecycle labels that disagree with operation replay", () => {
		const current = {
			...semanticCase("ko"),
			split: "diagnostic" as const,
			lifecycleOperations: [
				{
					op: "add" as const,
					logicalId: "actual",
					content: "actual value",
					at: "2026-01-01T00:00:01Z",
				},
			],
		};
		const contract: MemoryUpdateContract = {
			schemaVersion: "naia-memory-update-contract-v1",
			tier: "lifecycle-conformance",
			construction: "generated-diagnostic",
			cases: [current],
		};
		expect(() => validateMemoryUpdateContract(contract)).toThrow(
			"labels do not match derived active state",
		);
	});

	it("rejects replacement of a predecessor that is not active", () => {
		const current = {
			...semanticCase("ko"),
			split: "diagnostic" as const,
			expectedCurrentIds: ["current"],
			lifecycleOperations: [
				{
					op: "replace" as const,
					logicalId: "current",
					replacesLogicalId: "missing",
					content: "current value",
					at: "2026-01-01T00:00:01Z",
				},
			],
		};
		const contract: MemoryUpdateContract = {
			schemaVersion: "naia-memory-update-contract-v1",
			tier: "lifecycle-conformance",
			construction: "generated-diagnostic",
			cases: [current],
		};
		expect(() => validateMemoryUpdateContract(contract)).toThrow(
			"predecessor is not active",
		);
	});
});
