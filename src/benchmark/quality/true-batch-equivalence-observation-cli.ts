#!/usr/bin/env node
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import {
	OFFLINE_MODEL_REVISIONS,
	OfflineEmbeddingProvider,
} from "../../memory/embeddings.js";
import { verifyTrueBatchLaunchAuthorizationFiles } from "./native-full-corpus-candidate-authorization.js";
import {
	fullCorpusEmbeddingExecutionPolicy,
	parseOfflineBatchInferenceMode,
} from "./native-full-corpus-policy.js";
import {
	TRUE_BATCH_EQUIVALENCE_TEXTS,
	equivalenceInputSha256,
} from "./true-batch-equivalence.js";

if (process.env.CUDA_VISIBLE_DEVICES !== "")
	throw new Error("CUDA_VISIBLE_DEVICES must be empty");
verifyTrueBatchLaunchAuthorizationFiles(process.env);
const mode = parseOfflineBatchInferenceMode(
	process.env.MIRACL_EMBEDDING_INFERENCE_MODE,
);
const output = process.env.MIRACL_EQUIVALENCE_OBSERVATION;
if (!output) throw new Error("MIRACL_EQUIVALENCE_OBSERVATION is required");
const embedder = new OfflineEmbeddingProvider(
	"multilingual-e5-large",
	"cpu",
	OFFLINE_MODEL_REVISIONS["multilingual-e5-large"],
	mode,
);
const policy = fullCorpusEmbeddingExecutionPolicy(
	embedder.policyReceipt,
	'title + "\\n" + text',
	"per-item-v1",
);
const receipt = {
	schemaVersion: 1 as const,
	mode,
	inputSha256: equivalenceInputSha256(),
	policySha256: policy.embeddingPolicySha256,
	vectors: await embedder.embedBatch([...TRUE_BATCH_EQUIVALENCE_TEXTS]),
};
const bytes = `${JSON.stringify(receipt)}\n`;
writeFileSync(output, bytes, { flag: "wx", mode: 0o600 });
process.stdout.write(
	`${JSON.stringify({ schemaVersion: 1, mode, output, receiptSha256: createHash("sha256").update(bytes).digest("hex") })}\n`,
);
