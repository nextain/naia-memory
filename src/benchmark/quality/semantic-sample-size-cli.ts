import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedEvidenceFile } from "./public-evidence-file-io.js";
import {
	type SemanticAnalysisPlan,
	isSemanticAnalysisPlan,
} from "./semantic-analysis-plan.js";
import {
	isSemanticSampleSizeAssumptions,
	simulateSemanticSampleSize,
} from "./semantic-sample-size-simulation.js";

const MAX_INPUT_BYTES = 1024 * 1024;

async function readJson(path: string, label: string): Promise<unknown> {
	let bytes: Buffer;
	try {
		bytes = await readBoundedEvidenceFile(resolve(path), MAX_INPUT_BYTES);
	} catch {
		throw new Error(`${label} is unreadable or exceeds 1 MiB`);
	}
	try {
		return JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new Error(`${label} is not valid JSON`);
	}
}

export async function runSemanticSampleSizeCli(
	args: string[],
): Promise<number> {
	if (args.length !== 2) {
		process.stderr.write(
			"Usage: pnpm benchmark:semantic-sample-size <assumptions.json> <analysis-plan.json>\n",
		);
		return 2;
	}
	try {
		const assumptions = await readJson(args[0] ?? "", "assumptions");
		const plan = await readJson(args[1] ?? "", "analysis plan");
		if (!isSemanticSampleSizeAssumptions(assumptions))
			throw new Error("semantic sample-size assumptions are invalid");
		if (!isSemanticAnalysisPlan(plan))
			throw new Error("semantic analysis plan is invalid");
		process.stdout.write(
			`${JSON.stringify(
				simulateSemanticSampleSize({
					assumptions,
					plan: plan as SemanticAnalysisPlan,
				}),
			)}\n`,
		);
		return 0;
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : "sample-size simulation failed"}\n`,
		);
		return 1;
	}
}

const invokedPath =
	process.argv[1] && pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url)
	process.exitCode = await runSemanticSampleSizeCli(process.argv.slice(2));
