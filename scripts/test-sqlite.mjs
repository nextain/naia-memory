#!/usr/bin/env node
// Run ONLY the SqliteAdapter WIP suite (expected-RED until LocalAdapter parity).
// Cross-platform wrapper: sets SQLITE_WIP=1 so vitest.config.ts includes ONLY the
// SqliteAdapter tests (see vitest.config.ts `sqliteWipTests`). The default
// `pnpm test` excludes them and stays green. Why a wrapper: cross-env isn't a dep,
// and `SQLITE_WIP=1 vitest` doesn't work on Windows shells.
import { spawnSync } from "node:child_process";

const r = spawnSync("npx", ["vitest", "run"], {
	stdio: "inherit",
	env: { ...process.env, SQLITE_WIP: "1" },
	shell: true,
});
process.exit(r.status ?? 1);
