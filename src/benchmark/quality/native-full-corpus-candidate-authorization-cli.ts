#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { authorizeTrueBatchLaunch } from "./native-full-corpus-candidate-authorization.js";
import type { TrueBatchLaunchPlan } from "./native-full-corpus-candidate-launch.js";

const planPath =
	process.env.MIRACL_TRUE_BATCH_PLAN ??
	"reports/quality/miracl-ko-full-corpus-true-batch-launch-plan.json";
const baselineEvidencePath =
	process.env.MIRACL_BASELINE_EVIDENCE ??
	"reports/quality/miracl-ko-full-corpus-vector-exact.json.evidence.json";
const outputPath =
	process.env.MIRACL_TRUE_BATCH_AUTHORIZATION ??
	"reports/quality/miracl-ko-full-corpus-true-batch-launch-authorization.json";

const planBytes = readFileSync(planPath);
const baselineEvidenceBytes = readFileSync(baselineEvidencePath);
const authorization = authorizeTrueBatchLaunch({
	plan: JSON.parse(planBytes.toString("utf8")) as TrueBatchLaunchPlan,
	planBytes,
	baselineEvidence: JSON.parse(baselineEvidenceBytes.toString("utf8")),
	baselineEvidenceBytes,
});
writeFileSync(outputPath, `${JSON.stringify(authorization, null, 2)}\n`, {
	flag: "wx",
	mode: 0o600,
});
process.stdout.write(`${JSON.stringify(authorization, null, 2)}\n`);
