#!/usr/bin/env node
import { generateSemanticPublicGateManifest } from "./semantic-public-gate-manifest-generator.js";

export async function runSemanticPublicGateManifestGeneratorCli(
	args: string[],
): Promise<number> {
	if (args.length !== 2) {
		process.stderr.write(
			"Usage: pnpm benchmark:semantic-public-gate-manifest-generate <draft.json> <manifest.json>\n",
		);
		return 2;
	}
	try {
		const result = await generateSemanticPublicGateManifest(
			args[0] as string,
			args[1] as string,
		);
		process.stdout.write(`${JSON.stringify(result)}\n`);
		return 0;
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n`,
		);
		return 1;
	}
}

if (import.meta.url === `file://${process.argv[1]}`)
	process.exitCode = await runSemanticPublicGateManifestGeneratorCli(
		process.argv.slice(2),
	);
