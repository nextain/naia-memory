import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	EXPECTED_TRUE_BATCH_EVALUATION_SOURCE_SHA256,
	sha256Bytes,
} from "./native-full-corpus-evidence.js";

export const TRUE_BATCH_OUTPUT =
	"reports/quality/miracl-ko-full-corpus-vector-exact-true-batch.json";
export const TRUE_BATCH_LAUNCH_RECEIPT =
	"reports/quality/miracl-ko-full-corpus-launch-receipt-true-batch.json";
export const TRUE_BATCH_RUNTIME_OBSERVATION =
	"reports/quality/miracl-ko-full-corpus-runtime-observation-true-batch.json";
export const TRUE_BATCH_EVIDENCE = `${TRUE_BATCH_OUTPUT}.evidence.json`;

const BASELINE_PATHS = new Set([
	"reports/quality/miracl-ko-full-corpus-vector-exact.json",
	"reports/quality/miracl-ko-full-corpus-launch-receipt.json",
	"reports/quality/miracl-ko-full-corpus-runtime-observation.json",
	"reports/quality/miracl-ko-full-corpus-vector-exact.json.evidence.json",
]);

export interface TrueBatchLaunchPlan {
	schemaVersion: 1;
	treatment: "padded-array-batch-v1";
	evaluationSource: { path: string; sha256: string };
	environment: Record<string, string>;
}

export function createTrueBatchLaunchPlan(
	input: {
		root?: string;
		exists?: (path: string) => boolean;
	} = {},
): TrueBatchLaunchPlan {
	const root = resolve(input.root ?? ".");
	const exists = input.exists ?? existsSync;
	const evaluationSource = resolve(
		root,
		"src/benchmark/quality/native-full-corpus-evaluation-cli.ts",
	);
	const actualSourceSha256 = sha256Bytes(readFileSync(evaluationSource));
	if (actualSourceSha256 !== EXPECTED_TRUE_BATCH_EVALUATION_SOURCE_SHA256)
		throw new Error("true-batch evaluation source hash mismatch");

	const relativeOutputs = [
		TRUE_BATCH_OUTPUT,
		`${TRUE_BATCH_OUTPUT}.trec`,
		TRUE_BATCH_LAUNCH_RECEIPT,
		TRUE_BATCH_RUNTIME_OBSERVATION,
		TRUE_BATCH_EVIDENCE,
	];
	if (relativeOutputs.some((path) => BASELINE_PATHS.has(path)))
		throw new Error("true-batch output aliases a baseline artifact");
	if (new Set(relativeOutputs).size !== relativeOutputs.length)
		throw new Error("true-batch output paths are not unique");
	for (const path of relativeOutputs)
		if (exists(resolve(root, path)))
			throw new Error(`true-batch output already exists: ${path}`);

	return {
		schemaVersion: 1,
		treatment: "padded-array-batch-v1",
		evaluationSource: {
			path: evaluationSource,
			sha256: actualSourceSha256,
		},
		environment: {
			CUDA_VISIBLE_DEVICES: "",
			MIRACL_EMBEDDING_INFERENCE_MODE: "padded-array-batch-v1",
			MIRACL_FULL_OUTPUT: TRUE_BATCH_OUTPUT,
			MIRACL_FULL_LAUNCH_RECEIPT: TRUE_BATCH_LAUNCH_RECEIPT,
			MIRACL_FULL_RUNTIME_OBSERVATION: TRUE_BATCH_RUNTIME_OBSERVATION,
			MIRACL_FULL_EVIDENCE_OUTPUT: TRUE_BATCH_EVIDENCE,
		},
	};
}
