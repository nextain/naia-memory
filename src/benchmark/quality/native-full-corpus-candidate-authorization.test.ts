import { describe, expect, it } from "vitest";
import { authorizeTrueBatchLaunch } from "./native-full-corpus-candidate-authorization.js";
import { createTrueBatchLaunchPlan } from "./native-full-corpus-candidate-launch.js";
import {
	EXPECTED_EVALUATION_SOURCE_SHA256,
	MIRACL_FULL_BENCHMARK,
} from "./native-full-corpus-evidence.js";

const bytes = (value: unknown) =>
	Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

function baselineEvidence(mode: string | undefined = "per-item-v1") {
	return {
		verdict: "PASS",
		benchmark: MIRACL_FULL_BENCHMARK,
		artifacts: {
			result: {
				path: "reports/quality/miracl-ko-full-corpus-vector-exact.json",
			},
		},
		runtime: {
			cpuOnly: true,
			launchReceipt: {
				outputPath: "reports/quality/miracl-ko-full-corpus-vector-exact.json",
				evaluationSourceSha256: EXPECTED_EVALUATION_SOURCE_SHA256,
				embeddingInferenceMode: mode,
			},
		},
	};
}

describe("true-batch launch authorization", () => {
	it("binds a canonical candidate plan to completed baseline evidence", () => {
		const plan = createTrueBatchLaunchPlan({ exists: () => false });
		const evidence = baselineEvidence();
		const authorization = authorizeTrueBatchLaunch({
			plan,
			planBytes: bytes(plan),
			baselineEvidence: evidence,
			baselineEvidenceBytes: bytes(evidence),
		});
		expect(authorization.verdict).toBe("AUTHORIZED");
		expect(authorization.prerequisite.baselineEvidenceSha256).toHaveLength(64);
	});

	it.each(["padded-array-batch-v1", "unknown"])(
		"rejects a baseline with treatment mode %s",
		(mode) => {
			const plan = createTrueBatchLaunchPlan({ exists: () => false });
			const evidence = baselineEvidence(mode);
			expect(() =>
				authorizeTrueBatchLaunch({
					plan,
					planBytes: bytes(plan),
					baselineEvidence: evidence,
					baselineEvidenceBytes: bytes(evidence),
				}),
			).toThrow("completed legacy baseline evidence is required");
		},
	);

	it("rejects plan bytes that differ from the parsed plan", () => {
		const plan = createTrueBatchLaunchPlan({ exists: () => false });
		const evidence = baselineEvidence();
		expect(() =>
			authorizeTrueBatchLaunch({
				plan,
				planBytes: Buffer.from(JSON.stringify(plan)),
				baselineEvidence: evidence,
				baselineEvidenceBytes: bytes(evidence),
			}),
		).toThrow("true-batch plan bytes are not canonical or do not match");
	});

	it("rejects a canonical plan with a substituted output path", () => {
		const plan = createTrueBatchLaunchPlan({ exists: () => false });
		plan.environment.MIRACL_FULL_OUTPUT =
			"reports/quality/substituted-candidate.json";
		const evidence = baselineEvidence();
		expect(() =>
			authorizeTrueBatchLaunch({
				plan,
				planBytes: bytes(plan),
				baselineEvidence: evidence,
				baselineEvidenceBytes: bytes(evidence),
			}),
		).toThrow("true-batch plan does not match the locked launch policy");
	});
});
