import { readFileSync } from "node:fs";
import {
	type TrueBatchLaunchPlan,
	createTrueBatchLaunchPlan,
} from "./native-full-corpus-candidate-launch.js";
import {
	EXPECTED_EVALUATION_SOURCE_SHA256,
	MIRACL_FULL_BENCHMARK,
	sha256Bytes,
} from "./native-full-corpus-evidence.js";

export const BASELINE_RESULT =
	"reports/quality/miracl-ko-full-corpus-vector-exact.json";

interface BaselineEvidence {
	verdict?: string;
	benchmark?: string;
	artifacts?: { result?: { path?: string } };
	runtime?: {
		cpuOnly?: boolean;
		launchReceipt?: {
			outputPath?: string;
			evaluationSourceSha256?: string;
			embeddingInferenceMode?: string;
		};
	};
}

function canonical(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

export function authorizeTrueBatchLaunch(input: {
	plan: TrueBatchLaunchPlan;
	planBytes: Uint8Array;
	baselineEvidence: BaselineEvidence;
	baselineEvidenceBytes: Uint8Array;
}) {
	if (sha256Bytes(input.planBytes) !== sha256Bytes(canonical(input.plan)))
		throw new Error("true-batch plan bytes are not canonical or do not match");
	const expectedPlan = createTrueBatchLaunchPlan();
	if (canonical(input.plan) !== canonical(expectedPlan))
		throw new Error("true-batch plan does not match the locked launch policy");
	if (
		input.plan.treatment !== "padded-array-batch-v1" ||
		input.plan.environment.CUDA_VISIBLE_DEVICES !== "" ||
		input.plan.environment.MIRACL_EMBEDDING_INFERENCE_MODE !==
			"padded-array-batch-v1"
	)
		throw new Error("true-batch plan treatment mismatch");

	const evidence = input.baselineEvidence;
	const launch = evidence.runtime?.launchReceipt;
	if (
		evidence.verdict !== "PASS" ||
		evidence.benchmark !== MIRACL_FULL_BENCHMARK ||
		evidence.artifacts?.result?.path !== BASELINE_RESULT ||
		evidence.runtime?.cpuOnly !== true ||
		launch?.outputPath !== BASELINE_RESULT ||
		launch.evaluationSourceSha256 !== EXPECTED_EVALUATION_SOURCE_SHA256 ||
		(launch.embeddingInferenceMode !== undefined &&
			launch.embeddingInferenceMode !== "per-item-v1")
	)
		throw new Error("completed legacy baseline evidence is required");

	return {
		schemaVersion: 1 as const,
		verdict: "AUTHORIZED" as const,
		prerequisite: {
			benchmark: MIRACL_FULL_BENCHMARK,
			baselineEvidenceSha256: sha256Bytes(input.baselineEvidenceBytes),
		},
		candidate: {
			treatment: input.plan.treatment,
			launchPlanSha256: sha256Bytes(input.planBytes),
		},
	};
}

export function verifyTrueBatchLaunchAuthorizationFiles(
	environment: NodeJS.ProcessEnv,
): void {
	const planPath =
		environment.MIRACL_TRUE_BATCH_PLAN ??
		"reports/quality/miracl-ko-full-corpus-true-batch-launch-plan.json";
	const baselineEvidencePath =
		environment.MIRACL_BASELINE_EVIDENCE ??
		"reports/quality/miracl-ko-full-corpus-vector-exact.json.evidence.json";
	const authorizationPath =
		environment.MIRACL_TRUE_BATCH_AUTHORIZATION ??
		"reports/quality/miracl-ko-full-corpus-true-batch-launch-authorization.json";
	const planBytes = readFileSync(planPath);
	const baselineEvidenceBytes = readFileSync(baselineEvidencePath);
	const expected = authorizeTrueBatchLaunch({
		plan: JSON.parse(planBytes.toString("utf8")) as TrueBatchLaunchPlan,
		planBytes,
		baselineEvidence: JSON.parse(baselineEvidenceBytes.toString("utf8")),
		baselineEvidenceBytes,
	});
	const authorizationBytes = readFileSync(authorizationPath);
	let authorization: unknown;
	try {
		authorization = JSON.parse(authorizationBytes.toString("utf8"));
	} catch {
		throw new Error("true-batch launch authorization is invalid JSON");
	}
	if (
		sha256Bytes(authorizationBytes) !== sha256Bytes(canonical(authorization)) ||
		canonical(authorization) !== canonical(expected)
	)
		throw new Error("true-batch launch authorization mismatch");
}
