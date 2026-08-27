import { createHash } from "node:crypto";
import type {
	OfflineBatchInferenceMode,
	OfflineEmbeddingPolicyReceipt,
} from "../../memory/embeddings.js";

export interface FullCorpusEmbeddingExecutionPolicy {
	batchInferenceMode: OfflineBatchInferenceMode;
	embeddingPolicySha256: string;
	checkpointLeaf: string;
}

function canonical(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function parseOfflineBatchInferenceMode(
	value: string | undefined,
): OfflineBatchInferenceMode {
	if (value === undefined || value === "per-item-v1") return "per-item-v1";
	if (value === "padded-array-batch-v1") return value;
	throw new Error(
		"MIRACL_EMBEDDING_INFERENCE_MODE must be per-item-v1 or padded-array-batch-v1",
	);
}

export function fullCorpusEmbeddingExecutionPolicy(
	modelPolicy: OfflineEmbeddingPolicyReceipt,
	passageComposition: string,
	batchInferenceMode: OfflineBatchInferenceMode,
): FullCorpusEmbeddingExecutionPolicy {
	// Preserve the completed/active baseline identity byte-for-byte. Only the
	// opt-in candidate gets a new namespace, so it cannot consume baseline
	// vectors or write into the baseline Qdrant collection.
	const identity =
		batchInferenceMode === "per-item-v1"
			? { modelPolicy, passageComposition }
			: { modelPolicy, passageComposition, batchInferenceMode };
	return {
		batchInferenceMode,
		embeddingPolicySha256: sha256(canonical(identity)),
		checkpointLeaf:
			batchInferenceMode === "per-item-v1"
				? "vectors"
				: `vectors-${batchInferenceMode}`,
	};
}
