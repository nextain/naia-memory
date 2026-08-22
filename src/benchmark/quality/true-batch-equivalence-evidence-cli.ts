#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import {
	type EquivalenceObservation,
	analyzeTrueBatchEquivalence,
} from "./true-batch-equivalence.js";

const baselinePath =
	process.env.MIRACL_EQUIVALENCE_BASELINE ??
	"reports/quality/miracl-ko-true-batch-equivalence-per-item.json";
const candidatePath =
	process.env.MIRACL_EQUIVALENCE_CANDIDATE ??
	"reports/quality/miracl-ko-true-batch-equivalence-true-batch.json";
const outputPath =
	process.env.MIRACL_TRUE_BATCH_EQUIVALENCE_EVIDENCE ??
	"reports/quality/miracl-ko-true-batch-equivalence.evidence.json";
const evidence = analyzeTrueBatchEquivalence(
	JSON.parse(readFileSync(baselinePath, "utf8")) as EquivalenceObservation,
	JSON.parse(readFileSync(candidatePath, "utf8")) as EquivalenceObservation,
);
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
	flag: "wx",
	mode: 0o600,
});
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
