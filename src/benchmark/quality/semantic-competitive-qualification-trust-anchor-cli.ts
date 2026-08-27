#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { renderSemanticQualificationTrustAnchorModule } from "./semantic-competitive-qualification-trust-store.js";

const USAGE =
	"usage: semantic-competitive-qualification-trust-anchor-cli <public-deployment-policy.json> [--output <generated-module.ts> | --check <generated-module.ts>]";

async function writeAtomically(path: string, source: string): Promise<void> {
	try {
		if ((await lstat(path)).isSymbolicLink())
			throw new Error(
				"semantic qualification trust anchor module path must not be a symbolic link",
			);
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!("code" in error) ||
			error.code !== "ENOENT"
		)
			throw error;
	}
	const temporaryPath = resolve(
		dirname(path),
		`.${basename(path)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
	);
	try {
		await writeFile(temporaryPath, source, { encoding: "utf8", flag: "wx" });
		await rename(temporaryPath, path);
	} finally {
		await rm(temporaryPath, { force: true });
	}
}

async function main(): Promise<void> {
	const [policyPath, mode, modulePath, ...extra] = process.argv.slice(2);
	if (
		!policyPath ||
		extra.length > 0 ||
		(mode !== undefined && mode !== "--output" && mode !== "--check") ||
		(mode === undefined) !== (modulePath === undefined)
	)
		throw new Error(USAGE);
	const resolvedPolicyPath = resolve(policyPath);
	const resolvedModulePath = modulePath ? resolve(modulePath) : undefined;
	if (resolvedModulePath === resolvedPolicyPath)
		throw new Error(
			"semantic qualification trust anchor module path must differ from public deployment policy path",
		);
	const policy: unknown = JSON.parse(
		await readFile(resolvedPolicyPath, "utf8"),
	);
	const source = renderSemanticQualificationTrustAnchorModule(policy);
	if (!mode) {
		process.stdout.write(source);
		return;
	}
	if (mode === "--output") {
		await writeAtomically(resolvedModulePath as string, source);
		return;
	}
	let current: string;
	try {
		current = await readFile(resolvedModulePath as string, "utf8");
	} catch {
		throw new Error(
			"semantic qualification trust anchor module is missing or unreadable",
		);
	}
	if (current !== source)
		throw new Error(
			"semantic qualification trust anchor module drifted from public deployment policy",
		);
}

main().catch((error) => {
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
});
