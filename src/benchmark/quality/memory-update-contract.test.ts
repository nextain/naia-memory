import { describe, expect, it } from "vitest";
import {
	type MemoryUpdateContract,
	validateMemoryUpdateContract,
} from "./memory-update-contract.js";

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

describe("memory update contract", () => {
	it("accepts an independently reviewed multilingual semantic contract", () => {
		const contract: MemoryUpdateContract = {
			schemaVersion: "naia-memory-update-contract-v1",
			tier: "semantic-update-interpretation",
			construction: "independent-native-reviewed",
			cases: [semanticCase("ko"), semanticCase("en"), semanticCase("ja")],
		};
		expect(() => validateMemoryUpdateContract(contract)).not.toThrow();
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
			...semanticCase("ko", "dev"),
			familyId: "same-family",
			split: "development" as const,
		};
		const test = { ...semanticCase("ko", "test"), familyId: "same-family" };
		const contract: MemoryUpdateContract = {
			schemaVersion: "naia-memory-update-contract-v1",
			tier: "semantic-update-interpretation",
			construction: "independent-native-reviewed",
			cases: [development, test, semanticCase("en"), semanticCase("ja")],
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
