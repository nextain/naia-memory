import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { writeExclusiveEvidenceFile } from "./public-evidence-file-io.js";

describe("public evidence file output", () => {
	it("publishes exact bytes only after requesting parent-directory sync", async () => {
		const directory = mkdtempSync(join(tmpdir(), "naia-evidence-output-"));
		const output = join(directory, "evidence.json");
		const syncDirectory = vi.fn(async () => undefined);
		const bytes = Buffer.from('{"evidence":true}\n');

		await writeExclusiveEvidenceFile(output, bytes, { syncDirectory });

		expect(readFileSync(output)).toEqual(bytes);
		expect(syncDirectory).toHaveBeenCalledOnce();
		expect(syncDirectory).toHaveBeenCalledWith(output);
	});
});
