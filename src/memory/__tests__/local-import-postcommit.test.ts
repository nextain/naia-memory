import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Fact } from "../index.js";

const writeFailure = vi.hoisted(() => ({ afterCommit: false }));

vi.mock("../adapters/atomic-file-replace.js", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../adapters/atomic-file-replace.js")>();
	return {
		...actual,
		atomicReplaceFileSync: (
			...args: Parameters<typeof actual.atomicReplaceFileSync>
		) => {
			actual.atomicReplaceFileSync(...args);
			if (writeFailure.afterCommit)
				throw new actual.AtomicReplaceCommittedError(
					new Error("injected directory sync failure"),
				);
		},
	};
});

const { AtomicReplaceCommittedError } = await import(
	"../adapters/atomic-file-replace.js"
);
const { LocalAdapter } = await import("../adapters/local.js");
const directories: string[] = [];

afterEach(async () => {
	writeFailure.afterCommit = false;
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

function fact(content: string): Fact {
	const now = Date.now();
	return {
		id: randomUUID(),
		content,
		entities: [],
		topics: [],
		createdAt: now,
		updatedAt: now,
		importance: 1,
		recallCount: 0,
		lastAccessed: now,
		strength: 1,
		status: "active",
		sourceEpisodes: [],
	};
}

describe("LocalAdapter import post-commit failure", () => {
	it("keeps imported memory aligned with the already-replaced disk store", async () => {
		const directory = await mkdtemp(join(tmpdir(), "naia-import-postcommit-"));
		directories.push(directory);
		const source = new LocalAdapter(join(directory, "source.json"));
		const targetPath = join(directory, "target.json");
		const target = new LocalAdapter(targetPath);
		await source.semantic.upsert(fact("new imported fact"));
		await target.semantic.upsert(fact("old target fact"));
		await source.flush();
		await target.flush();
		const backup = await source.export("password123");

		writeFailure.afterCommit = true;
		await expect(target.import(backup, "password123")).rejects.toThrow(
			AtomicReplaceCommittedError,
		);
		writeFailure.afterCommit = false;

		expect(
			(await target.semantic.getAll()).map((item) => item.content),
		).toEqual(["new imported fact"]);
		const reopened = new LocalAdapter(targetPath);
		expect(
			(await reopened.semantic.getAll()).map((item) => item.content),
		).toEqual(["new imported fact"]);
	});
});
