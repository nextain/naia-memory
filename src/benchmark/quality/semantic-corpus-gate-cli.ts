import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runSemanticCorpusGateCli } from "./semantic-public-gate-cli.js";

export { runSemanticCorpusGateCli };

const invokedPath =
	process.argv[1] && pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url)
	process.exitCode = await runSemanticCorpusGateCli(process.argv.slice(2));
