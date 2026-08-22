import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAdapter, LocalStoreLoadError } from "../index.js";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function temporaryStore(name: string): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "naia-load-failure-"));
	directories.push(directory);
	return join(directory, name);
}

describe("LocalAdapter load failures", () => {
	it("starts fresh only when the store does not exist", async () => {
		const storePath = await temporaryStore("missing.json");
		const adapter = new LocalAdapter(storePath);

		expect(adapter.getStore().facts).toEqual([]);
		await adapter.upsertEpoch({
			id: "first",
			name: "First write",
			start: Date.now(),
			end: null,
		});
		await adapter.close();
		expect(JSON.parse(await readFile(storePath, "utf8")).version).toBe(1);
	});

	it.each([
		["invalid JSON", "{not-json"],
		[
			"unsupported version",
			JSON.stringify({
				version: 2,
				episodes: [],
				facts: [],
				skills: [],
				reflections: [],
				associations: {},
			}),
		],
		[
			"invalid shape",
			JSON.stringify({
				version: 1,
				episodes: [],
				facts: "not-an-array",
				skills: [],
				reflections: [],
				associations: {},
			}),
		],
	])(
		"rejects %s without modifying the original file",
		async (_label, contents) => {
			const storePath = await temporaryStore("memory.json");
			await writeFile(storePath, contents);

			expect(() => new LocalAdapter(storePath)).toThrow(LocalStoreLoadError);
			expect(await readFile(storePath, "utf8")).toBe(contents);
		},
	);

	it("rejects a read error instead of treating it as an empty store", async () => {
		const directory = await mkdtemp(join(tmpdir(), "naia-load-directory-"));
		directories.push(directory);

		expect(() => new LocalAdapter(directory)).toThrow(LocalStoreLoadError);
	});
});
