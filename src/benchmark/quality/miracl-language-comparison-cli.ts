import { open, readFile } from "node:fs/promises";
import { createMiraclLanguageComparison } from "./miracl-language-comparison.js";

export async function runMiraclLanguageComparisonCli(args: string[]) {
	if (args.length !== 2) {
		process.stderr.write(
			"Usage: pnpm benchmark:miracl-language-comparison <completion-evidence.json> <comparison.json>\n",
		);
		return 2;
	}
	const [inputPath, outputPath] = args;
	const evidenceText = await readFile(inputPath, "utf8");
	const comparison = createMiraclLanguageComparison(evidenceText);
	const handle = await open(outputPath, "wx");
	try {
		await handle.writeFile(`${JSON.stringify(comparison, null, 2)}\n`);
	} finally {
		await handle.close();
	}
	return 0;
}

if (import.meta.url === `file://${process.argv[1]}`)
	process.exitCode = await runMiraclLanguageComparisonCli(
		process.argv.slice(2),
	);
