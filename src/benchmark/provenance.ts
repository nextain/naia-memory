import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { arch, cpus, platform, release } from "node:os";

function git(args: string[]): string | null {
	try {
		return execFileSync("git", args, {
			cwd: process.cwd(),
			encoding: "utf8",
		}).trim();
	} catch {
		return null;
	}
}

function hashes(paths: string[]): Record<string, string> {
	return Object.fromEntries(
		paths.map((path) => [
			path,
			createHash("sha256").update(readFileSync(path)).digest("hex"),
		]),
	);
}

export function benchmarkReceipt(
	datasetPaths: string[],
	config: Record<string, unknown>,
	implementationPaths: string[] = [],
	generatedAt = new Date().toISOString(),
) {
	return benchmarkReceiptFromDatasetHashes(
		hashes(datasetPaths),
		config,
		implementationPaths,
		generatedAt,
	);
}

export function benchmarkReceiptFromDatasetHashes(
	datasetHashes: Record<string, string>,
	config: Record<string, unknown>,
	implementationPaths: string[] = [],
	generatedAt = new Date().toISOString(),
) {
	return {
		schemaVersion: "naia-memory-benchmark-receipt-v1",
		generatedAt,
		git: {
			revision: git(["rev-parse", "HEAD"]),
			dirty: Boolean(git(["status", "--porcelain"])),
		},
		datasets: datasetHashes,
		implementations: hashes(implementationPaths),
		config,
		runtime: {
			node: process.version,
			platform: `${platform()} ${release()} ${arch()}`,
			cpu: cpus()[0]?.model ?? "unknown",
			cpuCount: cpus().length,
		},
	};
}
