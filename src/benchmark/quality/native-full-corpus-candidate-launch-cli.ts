#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { createTrueBatchLaunchPlan } from "./native-full-corpus-candidate-launch.js";

const output =
	process.env.MIRACL_TRUE_BATCH_PLAN ??
	"reports/quality/miracl-ko-full-corpus-true-batch-launch-plan.json";
const plan = createTrueBatchLaunchPlan();
writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`, {
	flag: "wx",
	mode: 0o600,
});
process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
