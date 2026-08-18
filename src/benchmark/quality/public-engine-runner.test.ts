import { describe, expect, it, vi } from "vitest";
import { runPublicDatasetCase } from "./public-engine-runner.js";
import type { PublicDatasetCase } from "./public-evidence-types.js";

const benchmarkCase: PublicDatasetCase = {
	id: "ko-update-1",
	language: "ko",
	memories: [
		{ id: "stale", content: "예전 직장은 A", date: "2026-01-01T00:00:00Z" },
		{ id: "current", content: "현재 직장은 B", date: "2026-01-02T00:00:00Z" },
	],
	input: "현재 직장은 어디인가?",
	expected: ["current"],
	forbidden: ["stale"],
	inputSha256: "0".repeat(64),
};

describe("public engine runner", () => {
	it("replays ordered memories and returns only the frozen top-k IDs", async () => {
		const calls: string[] = [];
		const close = vi.fn(async () => undefined);
		const result = await runPublicDatasetCase(
			async () => ({
				identityPolicy: "dataset-id-round-trip-v1",
				addMemory: async (memory) => {
					calls.push(memory.id);
				},
				searchIds: async () => ["current", "stale", "distractor"],
				close,
			}),
			benchmarkCase,
			2,
		);
		expect(calls).toEqual(["stale", "current"]);
		expect(result).toEqual(["current", "stale"]);
		expect(close).toHaveBeenCalledOnce();
	});

	it("closes isolated engine state after a bridge failure", async () => {
		const close = vi.fn(async () => undefined);
		await expect(
			runPublicDatasetCase(
				async () => ({
					identityPolicy: "dataset-id-round-trip-v1",
					addMemory: async () => undefined,
					searchIds: async () => {
						throw new Error("engine failed");
					},
					close,
				}),
				benchmarkCase,
				2,
			),
		).rejects.toThrow("engine failed");
		expect(close).toHaveBeenCalledOnce();
	});

	it("fails closed when a bridge cannot round-trip dataset IDs", async () => {
		const close = vi.fn(async () => undefined);
		await expect(
			runPublicDatasetCase(
				async () => ({
					identityPolicy: "native-id" as "dataset-id-round-trip-v1",
					addMemory: async () => undefined,
					searchIds: async () => ["native-uuid"],
					close,
				}),
				benchmarkCase,
				2,
			),
		).rejects.toThrow("does not preserve dataset memory IDs");
		expect(close).toHaveBeenCalledOnce();
	});
});
