import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	PublicEvidenceDirectorySyncError,
	writeExclusiveEvidenceFile,
} from "./public-evidence-file-io.js";

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

	it("distinguishes a complete output whose crash-durability is unconfirmed", async () => {
		const directory = mkdtempSync(join(tmpdir(), "naia-evidence-output-"));
		const output = join(directory, "evidence.json");
		const bytes = Buffer.from('{"evidence":true}\n');
		const cause = new Error("directory fsync failed");

		await expect(
			writeExclusiveEvidenceFile(output, bytes, {
				syncDirectory: async () => {
					throw cause;
				},
			}),
		).rejects.toMatchObject({
			name: "PublicEvidenceDirectorySyncError",
			path: output,
			cause,
		});
		expect(readFileSync(output)).toEqual(bytes);
		await expect(
			writeExclusiveEvidenceFile(output, Buffer.from("replacement")),
		).rejects.toMatchObject({ code: "EEXIST" });
		expect(readFileSync(output)).toEqual(bytes);
		expect(new PublicEvidenceDirectorySyncError(output, cause)).toBeInstanceOf(
			Error,
		);
	});
});
