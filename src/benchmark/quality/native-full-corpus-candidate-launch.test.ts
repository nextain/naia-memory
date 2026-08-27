import { describe, expect, it } from "vitest";
import {
	TRUE_BATCH_EVIDENCE,
	TRUE_BATCH_LAUNCH_RECEIPT,
	TRUE_BATCH_OUTPUT,
	TRUE_BATCH_RUNTIME_OBSERVATION,
	createTrueBatchLaunchPlan,
} from "./native-full-corpus-candidate-launch.js";

describe("true-batch full-corpus launch plan", () => {
	it("binds every downstream CLI to isolated candidate artifacts", () => {
		const plan = createTrueBatchLaunchPlan({ exists: () => false });
		expect(plan.treatment).toBe("padded-array-batch-v1");
		expect(plan.environment).toEqual({
			CUDA_VISIBLE_DEVICES: "",
			MIRACL_EMBEDDING_INFERENCE_MODE: "padded-array-batch-v1",
			MIRACL_FULL_OUTPUT: TRUE_BATCH_OUTPUT,
			MIRACL_FULL_LAUNCH_RECEIPT: TRUE_BATCH_LAUNCH_RECEIPT,
			MIRACL_FULL_RUNTIME_OBSERVATION: TRUE_BATCH_RUNTIME_OBSERVATION,
			MIRACL_FULL_EVIDENCE_OUTPUT: TRUE_BATCH_EVIDENCE,
		});
		expect(new Set(Object.values(plan.environment)).has("per-item-v1")).toBe(
			false,
		);
	});

	it("refuses to overwrite any candidate artifact", () => {
		expect(() =>
			createTrueBatchLaunchPlan({
				exists: (path) => path.endsWith(TRUE_BATCH_LAUNCH_RECEIPT),
			}),
		).toThrow(`true-batch output already exists: ${TRUE_BATCH_LAUNCH_RECEIPT}`);
	});
});
