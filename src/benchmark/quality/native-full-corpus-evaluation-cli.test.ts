import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const evaluator = resolve(
	repositoryRoot,
	"src/benchmark/quality/native-full-corpus-evaluation-cli.ts",
);

describe("native full-corpus evaluation CLI", () => {
	it("fails closed before Qdrant access when English primary authorization is absent", () => {
		const result = spawnSync(
			process.execPath,
			[
				"--require",
				resolve(repositoryRoot, "node_modules/tsx/dist/preflight.cjs"),
				"--import",
				resolve(repositoryRoot, "node_modules/tsx/dist/loader.mjs"),
				evaluator,
			],
			{
				cwd: repositoryRoot,
				encoding: "utf8",
				env: {
					...process.env,
					CUDA_VISIBLE_DEVICES: "",
					MIRACL_LANGUAGE: "en",
					MIRACL_EN_PRIMARY_EXECUTION: "",
					QDRANT_URL: "http://127.0.0.1:1",
				},
				timeout: 20_000,
			},
		);

		expect(result.status).not.toBe(0);
		expect(`${result.stdout}\n${result.stderr}`).toContain(
			"explicit English primary execution opt-in is required",
		);
	});
});
