#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderSemanticQualificationTrustAnchorModule } from "./semantic-competitive-qualification-trust-store.js";

async function main(): Promise<void> {
	const [policyPath, ...extra] = process.argv.slice(2);
	if (!policyPath || extra.length > 0)
		throw new Error(
			"usage: semantic-competitive-qualification-trust-anchor-cli <public-deployment-policy.json>",
		);
	const policy: unknown = JSON.parse(
		await readFile(resolve(policyPath), "utf8"),
	);
	process.stdout.write(renderSemanticQualificationTrustAnchorModule(policy));
}

main().catch((error) => {
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
});
