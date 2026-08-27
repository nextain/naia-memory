#!/usr/bin/env node
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import {
	OFFLINE_MODEL_REVISIONS,
	OfflineEmbeddingProvider,
} from "../../memory/embeddings.js";
import {
	MULTILINGUAL_TRUE_BATCH_EQUIVALENCE_TEXTS,
	MULTILINGUAL_TRUE_BATCH_INPUT_COMPOSITION,
	MULTILINGUAL_TRUE_BATCH_MODEL,
	MULTILINGUAL_TRUE_BATCH_MODEL_REVISION,
	type MultilingualTrueBatchLanguage,
	multilingualEquivalenceInputSha256,
} from "./miracl-multilingual-true-batch-equivalence.js";
import {
	fullCorpusEmbeddingExecutionPolicy,
	parseOfflineBatchInferenceMode,
} from "./native-full-corpus-policy.js";

function requiredSha256(name: string): string {
	const value = process.env[name];
	if (!value || !/^[a-f0-9]{64}$/.test(value))
		throw new Error(`${name} must be a lowercase SHA-256`);
	return value;
}

if (process.env.CUDA_VISIBLE_DEVICES !== "")
	throw new Error(
		"CUDA_VISIBLE_DEVICES must be explicitly set empty by the parent runner",
	);
const language = process.env.MIRACL_MULTILINGUAL_EQUIVALENCE_LANGUAGE;
if (language !== "ar" && language !== "en")
	throw new Error("MIRACL_MULTILINGUAL_EQUIVALENCE_LANGUAGE must be ar or en");
const boundLanguage: MultilingualTrueBatchLanguage = language;
const mode = parseOfflineBatchInferenceMode(
	process.env.MIRACL_EMBEDDING_INFERENCE_MODE,
);
const output = process.env.MIRACL_MULTILINGUAL_EQUIVALENCE_OBSERVATION;
if (!output)
	throw new Error("MIRACL_MULTILINGUAL_EQUIVALENCE_OBSERVATION is required");
const expectedPolicySha256 = requiredSha256(
	"MIRACL_MULTILINGUAL_EQUIVALENCE_POLICY_SHA256",
);
const producerSourceSha256 = requiredSha256(
	"MIRACL_MULTILINGUAL_EQUIVALENCE_PRODUCER_SHA256",
);
if (
	OFFLINE_MODEL_REVISIONS["multilingual-e5-large"] !==
	MULTILINGUAL_TRUE_BATCH_MODEL_REVISION
)
	throw new Error("multilingual true-batch model revision drifted");

const embedder = new OfflineEmbeddingProvider(
	"multilingual-e5-large",
	"cpu",
	MULTILINGUAL_TRUE_BATCH_MODEL_REVISION,
	mode,
);
const policy = fullCorpusEmbeddingExecutionPolicy(
	embedder.policyReceipt,
	MULTILINGUAL_TRUE_BATCH_INPUT_COMPOSITION,
	"per-item-v1",
);
if (policy.embeddingPolicySha256 !== expectedPolicySha256)
	throw new Error("preregistered embedding policy hash mismatch");
const receipt = {
	schemaVersion: 1 as const,
	language: boundLanguage,
	mode,
	inputSha256: multilingualEquivalenceInputSha256(boundLanguage),
	policySha256: expectedPolicySha256,
	// The policy identity is held constant while `mode` records the treatment.
	policyBasisMode: "per-item-v1" as const,
	model: MULTILINGUAL_TRUE_BATCH_MODEL,
	modelRevision: MULTILINGUAL_TRUE_BATCH_MODEL_REVISION,
	producerSourceSha256,
	vectors: await embedder.embedBatch([
		...MULTILINGUAL_TRUE_BATCH_EQUIVALENCE_TEXTS[boundLanguage],
	]),
};
const bytes = `${JSON.stringify(receipt)}\n`;
writeFileSync(output, bytes, { flag: "wx", mode: 0o600 });
process.stdout.write(
	`${JSON.stringify({ schemaVersion: 1, language: boundLanguage, mode, output, receiptSha256: createHash("sha256").update(bytes).digest("hex") })}\n`,
);
