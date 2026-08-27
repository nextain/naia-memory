#!/usr/bin/env node
import { runMultilingualTrueBatchEquivalencePilot } from "./miracl-multilingual-true-batch-runner.js";

const language = process.argv[2];
if (language !== "ar" && language !== "en") {
	process.stderr.write(
		"Usage: pnpm benchmark:miracl-multilingual-true-batch <ar|en>\n",
	);
	process.exit(1);
}

process.stdout.write(
	`${JSON.stringify(runMultilingualTrueBatchEquivalencePilot(language), null, 2)}\n`,
);
