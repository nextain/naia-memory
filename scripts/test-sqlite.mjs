#!/usr/bin/env node
// Run the SqliteAdapter WIP suite or one of its explicit smoke/parity slices.
// Cross-platform wrapper: sets SQLITE_WIP=1 so vitest.config.ts includes the
// SQLite tests (see vitest.config.ts `sqliteWipTests`). Why a wrapper:
// cross-env isn't a dep, and `SQLITE_WIP=1 vitest` doesn't work on Windows shells.
import { spawnSync } from "node:child_process";

const sqliteTests = {
	smoke: ["src/memory/__tests__/sqlite-smoke.test.ts"],
	parity: [
		"src/memory/__tests__/daily-ground-benchmark.test.ts",
		"src/memory/__tests__/epoch-anchoring.test.ts",
		"src/memory/__tests__/flashbulb-memory.test.ts",
		"src/memory/__tests__/semantic-consolidation.test.ts",
	],
};
const requestedMode = process.argv[2];
const mode = requestedMode && Object.hasOwn(sqliteTests, requestedMode)
	? requestedMode
	: undefined;
if (requestedMode && !mode && !requestedMode.startsWith("-")) {
	console.error("Usage: node scripts/test-sqlite.mjs [smoke|parity] [vitest args]");
	process.exit(2);
}
const extraArgs = process.argv.slice(mode ? 3 : 2);
const r = spawnSync("npx", [
	"vitest",
	"run",
	...(mode ? sqliteTests[mode] : []),
	...extraArgs,
], {
	stdio: "inherit",
	env: { ...process.env, SQLITE_WIP: "1" },
	shell: true,
});
process.exit(r.status ?? 1);
