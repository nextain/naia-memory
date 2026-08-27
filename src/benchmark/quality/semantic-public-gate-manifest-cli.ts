import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runSemanticPublicGateCli } from "./semantic-public-gate-cli.js";
import { loadSemanticPublicGateManifest } from "./semantic-public-gate-manifest.js";

export async function runSemanticPublicGateManifestCli(
	args: string[],
): Promise<number> {
	if (args.length !== 1) {
		process.stderr.write(
			"Usage: pnpm benchmark:semantic-public-gate-manifest <manifest.json>\n",
		);
		return 2;
	}
	try {
		const loaded = await loadSemanticPublicGateManifest(args[0]);
		return runSemanticPublicGateCli(loaded.args);
	} catch (error) {
		process.stdout.write(
			`${JSON.stringify({
				promotable: false,
				failure:
					error instanceof Error ? error.message : "manifest intake failed",
			})}\n`,
		);
		return 1;
	}
}

const invokedPath =
	process.argv[1] && pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url)
	process.exitCode = await runSemanticPublicGateManifestCli(
		process.argv.slice(2),
	);
