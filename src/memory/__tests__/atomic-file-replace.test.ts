import { constants, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type AtomicFileOps,
	AtomicReplaceCommittedError,
	atomicReplaceFileSync,
} from "../adapters/atomic-file-replace.js";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

function recordingOps(
	failAt?: "write" | "file-sync" | "rename" | "dir-sync" | "dir-close",
) {
	const calls: string[] = [];
	let nextFd = 10;
	const fileFd = nextFd++;
	const directoryFd = nextFd++;
	const ops: AtomicFileOps = {
		mkdir: () => calls.push("mkdir"),
		open: (_path, flags) => {
			const isDirectory =
				flags === (constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
			calls.push(isDirectory ? "open-dir" : "open-file");
			return isDirectory ? directoryFd : fileFd;
		},
		write: () => {
			calls.push("write");
			if (failAt === "write") throw new Error("write failed");
		},
		fsync: (fd) => {
			calls.push(fd === directoryFd ? "sync-dir" : "sync-file");
			if (failAt === "file-sync" && fd === fileFd)
				throw new Error("file sync failed");
			if (failAt === "dir-sync" && fd === directoryFd)
				throw new Error("directory sync failed");
		},
		close: (fd) => {
			calls.push(fd === directoryFd ? "close-dir" : "close-file");
			if (failAt === "dir-close" && fd === directoryFd)
				throw new Error("directory close failed");
		},
		rename: () => {
			calls.push("rename");
			if (failAt === "rename") throw new Error("rename failed");
		},
		unlink: () => calls.push("unlink"),
	};
	return { calls, ops };
}

describe("atomicReplaceFileSync", () => {
	it("persists complete content with owner-only permissions", async () => {
		const directory = await mkdtemp(join(tmpdir(), "naia-atomic-replace-"));
		directories.push(directory);
		const target = join(directory, "memory.json");

		atomicReplaceFileSync(target, '{"current":true}');

		expect(readFileSync(target, "utf8")).toBe('{"current":true}');
		expect(statSync(target).mode & 0o777).toBe(0o600);
		expect(await readdir(directory)).toEqual(["memory.json"]);
	});

	it.each(["write", "file-sync", "rename"] as const)(
		"does not commit and cleans the temp when %s fails",
		(failAt) => {
			const { calls, ops } = recordingOps(failAt);
			expect(() =>
				atomicReplaceFileSync("/store/memory.json", "new", ops, "linux"),
			).toThrow(`${failAt === "file-sync" ? "file sync" : failAt} failed`);
			expect(calls).toContain("unlink");
			if (failAt !== "rename") expect(calls).not.toContain("rename");
		},
	);

	it("reports directory-sync failure as post-commit", () => {
		const { calls, ops } = recordingOps("dir-sync");
		expect(() =>
			atomicReplaceFileSync("/store/memory.json", "new", ops, "linux"),
		).toThrow(AtomicReplaceCommittedError);
		expect(calls).toContain("rename");
		expect(calls).not.toContain("unlink");
		expect(calls).toContain("close-dir");
	});

	it("reports directory-close failure as post-commit", () => {
		const { calls, ops } = recordingOps("dir-close");
		expect(() =>
			atomicReplaceFileSync("/store/memory.json", "new", ops, "linux"),
		).toThrow(AtomicReplaceCommittedError);
		expect(calls).toContain("rename");
		expect(calls).not.toContain("unlink");
	});

	it("skips unsupported directory sync on Windows", () => {
		const { calls, ops } = recordingOps();
		atomicReplaceFileSync("C:\\store\\memory.json", "new", ops, "win32");
		expect(calls).not.toContain("open-dir");
		expect(calls).not.toContain("sync-dir");
	});

	it("keeps the previous target when a real pre-rename failure occurs", async () => {
		const directory = await mkdtemp(join(tmpdir(), "naia-atomic-failure-"));
		directories.push(directory);
		const target = join(directory, "memory.json");
		writeFileSync(target, "previous", { mode: 0o600 });
		const { ops } = recordingOps("file-sync");

		expect(() => atomicReplaceFileSync(target, "new", ops, "linux")).toThrow();
		expect(readFileSync(target, "utf8")).toBe("previous");
	});
});
