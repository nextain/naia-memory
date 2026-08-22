import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	EQUIVALENCE_OUTPUTS,
	runTrueBatchEquivalencePilot,
} from "./true-batch-equivalence-runner.js";
import {
	TRUE_BATCH_EQUIVALENCE_TEXTS,
	equivalenceInputSha256,
} from "./true-batch-equivalence.js";

function root(): string {
	return mkdtempSync(join(tmpdir(), "naia-equivalence-runner-"));
}

function observe(
	_root: string,
	mode: "per-item-v1" | "padded-array-batch-v1",
	output: string,
): void {
	writeFileSync(
		output,
		`${JSON.stringify({
			schemaVersion: 1,
			mode,
			inputSha256: equivalenceInputSha256(),
			policySha256: "a".repeat(64),
			vectors: TRUE_BATCH_EQUIVALENCE_TEXTS.map((_, index) => [
				1,
				index / 100,
				0,
			]),
		})}\n`,
	);
}

describe("true batch equivalence runner", () => {
	it("promotes all three artifacts only after PASS", () => {
		const directory = root();
		expect(
			runTrueBatchEquivalencePilot({ root: directory, observe }).verdict,
		).toBe("PASS");
		for (const path of Object.values(EQUIVALENCE_OUTPUTS))
			expect(existsSync(resolve(directory, path))).toBe(true);
	});

	it("leaves no final artifacts when the second observation fails", () => {
		const directory = root();
		expect(() =>
			runTrueBatchEquivalencePilot({
				root: directory,
				observe: (projectRoot, mode, output) => {
					if (mode === "padded-array-batch-v1")
						throw new Error("injected failure");
					observe(projectRoot, mode, output);
				},
			}),
		).toThrow("injected failure");
		for (const path of Object.values(EQUIVALENCE_OUTPUTS))
			expect(existsSync(resolve(directory, path))).toBe(false);
	});

	it("refuses to overwrite any prior final artifact", () => {
		const directory = root();
		const existing = resolve(directory, EQUIVALENCE_OUTPUTS.baseline);
		mkdirSync(resolve(directory, "reports/quality"), { recursive: true });
		writeFileSync(existing, "owned");
		expect(() =>
			runTrueBatchEquivalencePilot({ root: directory, observe }),
		).toThrow("already exists");
		expect(existsSync(existing)).toBe(true);
	});
});
