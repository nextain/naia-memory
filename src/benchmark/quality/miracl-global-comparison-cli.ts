#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createMiraclGlobalComparison } from "./miracl-global-comparison.js";
import {
	readBoundedEvidenceFile,
	writeExclusiveEvidenceFile,
} from "./public-evidence-file-io.js";

const MAX_RECEIPT_BYTES = 16 * 1024 * 1024;

export async function runMiraclGlobalComparisonCli(args: string[]) {
	if (args.length !== 2) {
		process.stderr.write(
			"Usage: pnpm benchmark:miracl-global-comparison <evidence.json> <comparison.json>\n",
		);
		return 2;
	}
	const [receiptPath, outputPath] = args as [string, string];
	const receiptText = (
		await readBoundedEvidenceFile(resolve(receiptPath), MAX_RECEIPT_BYTES)
	).toString("utf8");
	const comparison = createMiraclGlobalComparison(receiptText);
	await writeExclusiveEvidenceFile(
		resolve(outputPath),
		Buffer.from(`${JSON.stringify(comparison, null, 2)}\n`),
	);
	process.stdout.write(`${JSON.stringify(comparison)}\n`);
	return 0;
}

const invokedPath =
	process.argv[1] && pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url)
	process.exitCode = await runMiraclGlobalComparisonCli(process.argv.slice(2));
