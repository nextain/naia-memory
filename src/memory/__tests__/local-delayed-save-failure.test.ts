import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const writeFailure = vi.hoisted(() => ({ remaining: 0 }));

vi.mock("../adapters/atomic-file-replace.js", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../adapters/atomic-file-replace.js")>();
	return {
		...actual,
		atomicReplaceFileSync: (
			...args: Parameters<typeof actual.atomicReplaceFileSync>
		) => {
			if (writeFailure.remaining > 0) {
				writeFailure.remaining--;
				throw new Error("injected delayed persistence failure");
			}
			return actual.atomicReplaceFileSync(...args);
		},
	};
});

const { LocalAdapter } = await import("../adapters/local.js");
const directories: string[] = [];

afterEach(async () => {
	writeFailure.remaining = 0;
	vi.useRealTimers();
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function dirtyAdapter(options?: {
	onPersistenceError?: (error: unknown) => void;
}): Promise<{
	adapter: InstanceType<typeof LocalAdapter>;
	storePath: string;
}> {
	const directory = await mkdtemp(join(tmpdir(), "naia-delayed-save-"));
	directories.push(directory);
	const storePath = join(directory, "memory.json");
	const adapter = new LocalAdapter({ storePath, ...options });
	await adapter.upsertEpoch({
		id: "epoch",
		name: "Delayed persistence",
		start: Date.now(),
		end: null,
	});
	return { adapter, storePath };
}

describe("LocalAdapter delayed persistence failures", () => {
	it("keeps a failed timer write retryable without an uncaught exception", async () => {
		vi.useFakeTimers();
		const onPersistenceError = vi.fn();
		const { adapter, storePath } = await dirtyAdapter({ onPersistenceError });
		writeFailure.remaining = 1;

		expect(() => vi.advanceTimersByTime(2_000)).not.toThrow();
		expect(onPersistenceError).toHaveBeenCalledWith(
			expect.objectContaining({
				message: "injected delayed persistence failure",
			}),
		);
		await adapter.flush();

		const reopened = new LocalAdapter(storePath);
		expect(reopened.getEpochs()).toHaveLength(1);
	});

	it("reports a persistent delayed-write failure through explicit flush", async () => {
		vi.useFakeTimers();
		const { adapter } = await dirtyAdapter({ onPersistenceError: vi.fn() });
		writeFailure.remaining = 2;

		expect(() => vi.advanceTimersByTime(2_000)).not.toThrow();
		await expect(adapter.flush()).rejects.toThrow(
			"injected delayed persistence failure",
		);
	});

	it("retries a failed timer write after a later mutation", async () => {
		vi.useFakeTimers();
		const { adapter, storePath } = await dirtyAdapter({
			onPersistenceError: vi.fn(),
		});
		writeFailure.remaining = 1;

		vi.advanceTimersByTime(2_000);
		await adapter.upsertEpoch({
			id: "second-epoch",
			name: "Retry trigger",
			start: Date.now(),
			end: null,
		});
		vi.advanceTimersByTime(2_000);

		const reopened = new LocalAdapter(storePath);
		expect(reopened.getEpochs()).toHaveLength(2);
	});

	it("contains observer failures inside the timer callback", async () => {
		vi.useFakeTimers();
		const { adapter } = await dirtyAdapter({
			onPersistenceError: () => {
				throw new Error("observer failed");
			},
		});
		writeFailure.remaining = 1;

		expect(() => vi.advanceTimersByTime(2_000)).not.toThrow();
		await adapter.flush();
	});

	it("emits a warning when no persistence observer is configured", async () => {
		vi.useFakeTimers();
		const emitWarning = vi
			.spyOn(process, "emitWarning")
			.mockImplementation(() => undefined);
		const { adapter } = await dirtyAdapter();
		writeFailure.remaining = 1;

		expect(() => vi.advanceTimersByTime(2_000)).not.toThrow();
		expect(emitWarning).toHaveBeenCalledWith(
			expect.objectContaining({
				message: "injected delayed persistence failure",
			}),
			{ code: "NAIA_MEMORY_DELAYED_SAVE_FAILED" },
		);
		await adapter.flush();
	});
});
