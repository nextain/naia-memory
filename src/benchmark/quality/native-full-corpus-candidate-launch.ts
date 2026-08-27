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
const EQUIVALENCE_SOURCE_SHA256 = {
	"src/benchmark/quality/true-batch-equivalence.ts":
		"5ade0b0cf64bdbc28f6610c24a0d10c0f395c24df69ac87291565c872a166e8d",
	"src/benchmark/quality/true-batch-equivalence-observation-cli.ts":
		"1b6664ca151f71711361db6033322a225906d2373b00439906d50d07d6c82fd4",
	"src/benchmark/quality/true-batch-equivalence-evidence-cli.ts":
		"77ee7bfda10d3435948ddc7ba1ce672722b19e518372395d0d84e2d477ee9407",
	"src/benchmark/quality/true-batch-equivalence-runner.ts":
		"1095d1e9221e948a31d585b93abb7c9fa7e40d9fd51be9970ed23524ad880651",
	"src/benchmark/quality/true-batch-equivalence-runner-cli.ts":
		"f817cd91a3d565107a31de61527823006c9f916e0a5168497c7fe79ca3db76cb",
} as const;

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
	equivalenceSources: Array<{ path: string; sha256: string }>;
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
	const equivalenceSources = Object.entries(EQUIVALENCE_SOURCE_SHA256).map(
		([relativePath, expectedSha256]) => {
			const path = resolve(root, relativePath);
			const sha256 = sha256Bytes(readFileSync(path));
			if (sha256 !== expectedSha256)
				throw new Error(
					`true-batch equivalence source hash mismatch: ${relativePath}`,
				);
			return { path, sha256 };
		},
	);

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
		equivalenceSources,
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
