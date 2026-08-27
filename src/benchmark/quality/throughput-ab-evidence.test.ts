import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	type ThroughputAbEvidence,
	verifyAndAnalyzeThroughputAbEvidence,
} from "./throughput-ab-evidence.js";

const hash = (character: string) => character.repeat(64);
const bootId = "11111111-2222-4333-8444-555555555555";

function evidence(): ThroughputAbEvidence {
	const observation = (
		label: string,
		policySha256: string,
		milliseconds: number,
		startedAtMilliseconds = 0,
	) => ({
		...(() => {
			const command = ["node", "benchmark.js", label];
			const stdout = `${JSON.stringify({ label, policySha256 })}\n`;
			const environment = { NAIA_THROUGHPUT_MODE: "test" };
			const cmdline = [process.execPath, "benchmark.js", label];
			return {
				command,
				commandSha256: createHash("sha256")
					.update(JSON.stringify(command))
					.digest("hex"),
				environment,
				environmentSha256: createHash("sha256")
					.update(JSON.stringify(Object.entries(environment)))
					.digest("hex"),
				stdout,
				stdoutSha256: createHash("sha256").update(stdout).digest("hex"),
				process: {
					pid: 123,
					procStartTicks: "456",
					cmdline,
					cmdlineSha256: createHash("sha256")
						.update(JSON.stringify(cmdline))
						.digest("hex"),
					pollMilliseconds: 100,
					samples: 2,
					rssObservation:
						"100ms-sampled-process-tree-aggregate-vmrss-v1" as const,
				},
			};
		})(),
		label,
		policySha256,
		hostBootId: bootId,
		cwd: process.cwd(),
		startedAt: new Date(
			Date.parse("2026-08-22T00:00:00.000Z") + startedAtMilliseconds,
		).toISOString(),
		completedAt: new Date(
			Date.parse("2026-08-22T00:00:00.000Z") +
				startedAtMilliseconds +
				milliseconds,
		).toISOString(),
		milliseconds,
		peakRssBytes: 1_000,
		failures: 0,
	});
	return {
		schemaVersion: 1,
		benchmark: "miracl-ko-per-item-vs-true-batch-throughput-ab-v1",
		hostBootId: bootId,
		policies: {
			baseline: {
				label: "baseline",
				policySha256: hash("a"),
				inferenceMode: "per-item-v1",
				embeddingBatchSize: 8,
				inputOrder: "corpus-ordinal-stable-v1",
				transformersVersion: "3.7.2",
			},
			candidate: {
				label: "candidate",
				policySha256: hash("b"),
				inferenceMode: "padded-array-batch-v1",
				embeddingBatchSize: 8,
				inputOrder: "corpus-ordinal-stable-v1",
				transformersVersion: "3.7.2",
			},
		},
		warmPairs: Array.from({ length: 6 }, (_, offset) => {
			const pairStart = offset * 20_000;
			const order = offset % 2 === 0 ? ("AB" as const) : ("BA" as const);
			return {
				pairIndex: offset + 1,
				order,
				baseline: observation(
					`warm-${offset + 1}-baseline`,
					hash("a"),
					10_000,
					pairStart + (order === "AB" ? 0 : 4_000),
				),
				candidate: observation(
					`warm-${offset + 1}-candidate`,
					hash("b"),
					4_000,
					pairStart + (order === "AB" ? 10_000 : 0),
				),
			};
		}),
		fullCorpus: {
			baseline: {
				...observation("full-corpus-baseline", hash("a"), 50_000),
				embeddedDocuments: 1_486_752,
				cachedDocuments: 0,
			},
			candidate: {
				...observation("full-corpus-candidate", hash("b"), 25_000),
				embeddedDocuments: 1_486_752,
				cachedDocuments: 0,
			},
		},
	};
}

function firstWarmPair(value: ThroughputAbEvidence) {
	const pair = value.warmPairs[0];
	if (!pair) throw new Error("test fixture has no warm pair");
	return pair;
}

describe("throughput A/B evidence", () => {
	it("binds valid same-host observations before analysis", () => {
		const result = verifyAndAnalyzeThroughputAbEvidence(evidence());
		expect(result.analysis.passed).toBe(true);
		expect(result.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
	});

	it.each([
		[
			"host",
			(value: ThroughputAbEvidence) => {
				firstWarmPair(value).baseline.hostBootId =
					"22222222-2222-4333-8444-555555555555";
			},
			"host boot identity",
		],
		[
			"policy",
			(value: ThroughputAbEvidence) => {
				firstWarmPair(value).baseline.policySha256 = hash("b");
			},
			"policy identity",
		],
		[
			"command",
			(value: ThroughputAbEvidence) => {
				firstWarmPair(value).baseline.command.push("drift");
			},
			"command hash mismatch",
		],
		[
			"environment",
			(value: ThroughputAbEvidence) => {
				firstWarmPair(value).baseline.environment.NAIA_THROUGHPUT_MODE =
					"drift";
			},
			"environment hash mismatch",
		],
		[
			"process cmdline",
			(value: ThroughputAbEvidence) => {
				firstWarmPair(value).baseline.process.cmdline.push("drift");
			},
			"process cmdline hash mismatch",
		],
		[
			"chronology",
			(value: ThroughputAbEvidence) => {
				firstWarmPair(value).baseline.milliseconds = 1;
			},
			"chronology",
		],
		[
			"declared order",
			(value: ThroughputAbEvidence) => {
				firstWarmPair(value).order = "BA";
			},
			"contradict declared",
		],
	])("rejects %s provenance drift", (_, mutate, message) => {
		const value = evidence();
		mutate(value);
		expect(() => verifyAndAnalyzeThroughputAbEvidence(value)).toThrow(message);
	});
});
