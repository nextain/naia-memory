#!/usr/bin/env node
import { runTrueBatchEquivalencePilot } from "./true-batch-equivalence-runner.js";

process.stdout.write(
	`${JSON.stringify(runTrueBatchEquivalencePilot(), null, 2)}\n`,
);
