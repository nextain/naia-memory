import { describe, expect, it } from "vitest";
import { miraclEnPrimaryExecutionPolicy } from "./miracl-en-primary-execution-policy.js";
import { MIRACL_EMBEDDING_POLICY } from "./native-full-corpus-evidence.js";

describe("MIRACL English primary execution policy", () => {
	it("binds model identity and inference semantics into one digest", () => {
		const policy = miraclEnPrimaryExecutionPolicy(MIRACL_EMBEDDING_POLICY);
		const changed = miraclEnPrimaryExecutionPolicy({
			...MIRACL_EMBEDDING_POLICY,
			tokenizerMaxLength: MIRACL_EMBEDDING_POLICY.tokenizerMaxLength + 1,
		});
		expect(policy.embeddingExecutionPolicySha256).toMatch(/^[a-f0-9]{64}$/u);
		expect(changed.embeddingExecutionPolicySha256).not.toBe(
			policy.embeddingExecutionPolicySha256,
		);
	});
});
