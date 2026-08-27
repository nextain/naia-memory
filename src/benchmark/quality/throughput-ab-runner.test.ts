import { describe, expect, it } from "vitest";
import { runThroughputObservation } from "./throughput-ab-runner.js";

const policySha256 = "a".repeat(64);

const counts = { embeddedDocuments: 8, cachedDocuments: 0 };

function command(receipt: object, exitCode = 0) {
	return [
		process.execPath,
		"-e",
		`setTimeout(() => { process.stdout.write(JSON.stringify(${JSON.stringify(receipt)})); process.exit(${exitCode}); }, 180)`,
	];
}

describe("throughput A/B controlled runner", () => {
	it("observes and binds a successful child process", async () => {
		const observation = await runThroughputObservation({
			label: "warm-1-baseline",
			policySha256,
			command: command({
				schemaVersion: 1,
				label: "warm-1-baseline",
				policySha256,
				failures: 0,
				...counts,
			}),
			cwd: process.cwd(),
			env: { NAIA_THROUGHPUT_MODE: "per-item-v1" },
			expectedEmbeddedDocuments: 8,
			expectedCachedDocuments: 0,
		});
		expect(observation.process.samples).toBeGreaterThan(0);
		expect(observation.peakRssBytes).toBeGreaterThan(0);
		expect(observation.commandSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(observation.environment).toEqual({
			NAIA_THROUGHPUT_MODE: "per-item-v1",
		});
		expect(observation.process.cmdline.length).toBeGreaterThan(0);
		expect(observation.embeddedDocuments).toBe(8);
	});

	it("rejects failed or identity-drifting children", async () => {
		await expect(
			runThroughputObservation({
				label: "warm-1-baseline",
				policySha256,
				command: command({
					schemaVersion: 1,
					label: "wrong",
					policySha256,
					failures: 0,
					...counts,
				}),
				cwd: process.cwd(),
				expectedEmbeddedDocuments: 8,
				expectedCachedDocuments: 0,
			}),
		).rejects.toThrow("identity mismatch");
		await expect(
			runThroughputObservation({
				label: "warm-1-baseline",
				policySha256,
				command: command(
					{
						schemaVersion: 1,
						label: "warm-1-baseline",
						policySha256,
						failures: 0,
						...counts,
					},
					2,
				),
				cwd: process.cwd(),
				expectedEmbeddedDocuments: 8,
				expectedCachedDocuments: 0,
			}),
		).rejects.toThrow("child failed");
		await expect(
			runThroughputObservation({
				label: "warm-1-baseline",
				policySha256,
				command: command({
					schemaVersion: 1,
					label: "warm-1-baseline",
					policySha256,
					failures: 0,
					embeddedDocuments: 7,
					cachedDocuments: 0,
				}),
				cwd: process.cwd(),
				expectedEmbeddedDocuments: 8,
				expectedCachedDocuments: 0,
			}),
		).rejects.toThrow("identity mismatch");
		await expect(
			runThroughputObservation({
				label: "warm-1-baseline",
				policySha256,
				command: command({
					schemaVersion: 1,
					label: "warm-1-baseline",
					policySha256,
					failures: 0,
					...counts,
				}),
				cwd: process.cwd(),
				env: { API_TOKEN: "must-not-leak" },
				expectedEmbeddedDocuments: 8,
				expectedCachedDocuments: 0,
			}),
		).rejects.toThrow("secret-bearing environment");
	});
});
