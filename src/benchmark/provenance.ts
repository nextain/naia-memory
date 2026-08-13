import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { cpus, platform, release, arch } from "node:os";
import { execFileSync } from "node:child_process";

function git(args: string[]): string | null {
	try {
		return execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8" }).trim();
	} catch {
		return null;
	}
}

export function benchmarkReceipt(datasetPaths: string[], config: Record<string, unknown>) {
	const datasets = Object.fromEntries(datasetPaths.map((path) => [
		path,
		createHash("sha256").update(readFileSync(path)).digest("hex"),
	]));
	return {
		schemaVersion: "naia-memory-benchmark-receipt-v1",
		generatedAt: new Date().toISOString(),
		git: { revision: git(["rev-parse", "HEAD"]), dirty: Boolean(git(["status", "--porcelain"])) },
		datasets,
		config,
		runtime: {
			node: process.version,
			platform: `${platform()} ${release()} ${arch()}`,
			cpu: cpus()[0]?.model ?? "unknown",
			cpuCount: cpus().length,
		},
	};
}
