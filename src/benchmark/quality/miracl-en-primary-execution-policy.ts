import { createHash } from "node:crypto";
import type { OfflineEmbeddingPolicyReceipt } from "../../memory/embeddings.js";

export const MIRACL_EN_PRIMARY_EXECUTION = {
	artifactClass: "miracl-en-primary-execution-policy-v1",
	language: "en",
	passageInferenceMode: "padded-array-batch-v1",
	queryInferenceMode: "per-item-v1",
	passageComposition: 'title + "\\n" + text',
	embeddingBatchSize: 8,
	chunkSize: 512,
	upsertBatchSize: 64,
	corpusOrder: "source-lock-file-order-then-jsonl-record-order-v1",
	transformersPackage: "@huggingface/transformers@3.8.1",
	onnxRuntimePackage: "onnxruntime-node@1.21.0",
	cpuOnly: true,
} as const;

export const MIRACL_EN_PREFLIGHT_RETRIEVAL_QUERIES = 64;
export const MIRACL_EN_PRIMARY_EXPECTED_POLICY_SHA256 =
	"d2d6e0c505dbe11ff8e34999a7ddfff02f82ef977f739e7884153d63771e5856";

function canonical(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

export function miraclEnPrimaryExecutionPolicy(
	modelPolicy: OfflineEmbeddingPolicyReceipt,
) {
	const identity = { ...MIRACL_EN_PRIMARY_EXECUTION, modelPolicy };
	return {
		...identity,
		embeddingExecutionPolicySha256: createHash("sha256")
			.update(canonical(identity))
			.digest("hex"),
	};
}
