import { describe, expect, it } from "vitest";
import {
	type MemoryUpdateContract,
	computeFamilySplitDigest,
	validateMemoryUpdateContract,
	validateSemanticDiagnosticCoverage,
	validateSemanticPublicEvidenceCoverage,
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
			constructionClusterId: `construction-${id}`,
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

	it("keeps small independent pilots out of the public semantic gate", () => {
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
		expect(() => validateSemanticPublicEvidenceCoverage(contract)).toThrow(
			"at least 100 test cases",
		);
	});

	it("requires every public test language to cover update/delete/no-update", () => {
		const languages: readonly ["ko", "en", "ja"] = ["ko", "en", "ja"];
		const cases = Array.from({ length: 102 }, (_, index) => {
			const language = languages[index % languages.length] ?? "ko";
			return reviewedCase(language, `public-${index}`);
		});
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
		expect(() => validateSemanticPublicEvidenceCoverage(contract)).toThrow(
			"at least 10 ko/delete test cases",
		);
		for (const [index, current] of cases.entries())
			current.expectedDecision = ["update", "delete", "no-update"][
				Math.floor(index / languages.length) % 3
			] as "update" | "delete" | "no-update";
		for (const current of cases) {
			if (current.expectedDecision === "delete")
				current.expectedDeletedIds = ["deleted"];
			if (current.expectedDecision === "no-update")
				current.noUpdateIds = ["unchanged"];
		}
		expect(() =>
			validateSemanticPublicEvidenceCoverage(contract),
		).not.toThrow();
		const deleteCase = cases.find(
			(current) => current.expectedDecision === "delete",
		);
		if (!deleteCase) throw new Error("fixture requires a delete case");
		deleteCase.expectedDeletedIds = [];
		expect(() => validateSemanticPublicEvidenceCoverage(contract)).toThrow(
			"public delete decision requires deleted labels",
		);
		deleteCase.expectedDeletedIds = ["deleted"];
		for (const current of cases) current.familyId = "one-public-family";
		if (!contract.familySplitFreeze)
			throw new Error("fixture requires a family split freeze");
		contract.familySplitFreeze.digest = computeFamilySplitDigest(
			cases,
		) as `sha256:${string}`;
		expect(() => validateSemanticPublicEvidenceCoverage(contract)).toThrow(
			"at least 100 distinct test families",
		);
		for (const [index, current] of cases.entries())
			current.familyId = `family-public-${index}`;
		contract.familySplitFreeze.digest = computeFamilySplitDigest(
			cases,
		) as `sha256:${string}`;
		for (const current of cases)
			current.provenance.constructionClusterId = "one-construction-template";
		contract.familySplitFreeze.digest = computeFamilySplitDigest(
			cases,
		) as `sha256:${string}`;
		expect(() => validateSemanticPublicEvidenceCoverage(contract)).toThrow(
			"construction clusters shared across test families",
		);
		for (const [index, current] of cases.entries())
			current.provenance.constructionClusterId = `construction-public-${index}`;
		contract.familySplitFreeze.digest = computeFamilySplitDigest(
			cases,
		) as `sha256:${string}`;
		const [firstPublicCase] = cases;
		if (!firstPublicCase) throw new Error("fixture requires a first case");
		firstPublicCase.expectedDecision = "create";
		expect(() => validateSemanticPublicEvidenceCoverage(contract)).toThrow(
			"does not admit create decisions",
		);
	});

	it("rejects self-reviewed evidence and a stale family split freeze", () => {
		const cases = [reviewedCase("ko"), reviewedCase("en"), reviewedCase("ja")];
		const [firstCase] = cases;
		if (!firstCase) throw new Error("fixture requires a first case");
		firstCase.provenance.reviewerId = firstCase.provenance.authorId;
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
		firstCase.provenance.reviewerId = "reviewer-ko";
		expect(() => validateMemoryUpdateContract(contract)).toThrow(
			"freeze digest does not match",
		);
		contract.familySplitFreeze.digest = computeFamilySplitDigest(
			cases,
		) as `sha256:${string}`;
		firstCase.provenance.constructionClusterId = "post-freeze-cluster-swap";
		expect(() => validateMemoryUpdateContract(contract)).toThrow(
			"freeze digest does not match",
		);
	});

	it("binds each case to its frozen construction cluster", () => {
		const firstCase = reviewedCase("ko", "shared-family");
		const secondCase = reviewedCase("ko", "shared-family");
		secondCase.id = "semantic-ko-shared-family-second";
		secondCase.query = "두 번째 고유 질의";
		secondCase.provenance.constructionClusterId = "construction-second";
		const cases = [firstCase, secondCase];
		const frozenDigest = computeFamilySplitDigest(cases);
		const firstCluster = firstCase.provenance.constructionClusterId;
		firstCase.provenance.constructionClusterId =
			secondCase.provenance.constructionClusterId;
		secondCase.provenance.constructionClusterId = firstCluster;
		expect(computeFamilySplitDigest(cases)).not.toBe(frozenDigest);
	});

	it("rejects non-canonical construction cluster identifiers", () => {
		const cases = [reviewedCase("ko"), reviewedCase("en"), reviewedCase("ja")];
		const [firstCase] = cases;
		if (!firstCase) throw new Error("fixture requires a first case");
		firstCase.provenance.constructionClusterId += " ";
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
		expect(() => validateMemoryUpdateContract(contract)).toThrow(
			"constructionClusterId must use canonical form",
		);
	});

	it("keeps construction clusters isolated from held-out splits", () => {
		const developmentCase = reviewedCase("ko", "development-cluster");
		developmentCase.split = "development";
		const testCase = reviewedCase("en", "test-cluster");
		testCase.provenance.constructionClusterId =
			developmentCase.provenance.constructionClusterId;
		const japaneseCase = reviewedCase("ja", "japanese-cluster");
		const cases = [developmentCase, testCase, japaneseCase];
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
		expect(() => validateMemoryUpdateContract(contract)).toThrow(
			"construction cluster crosses evaluation splits",
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
