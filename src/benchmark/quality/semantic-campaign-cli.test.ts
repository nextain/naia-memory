import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { MemoryUpdateCase } from "./memory-update-contract.js";
import {
	type SemanticCampaignRun,
	buildSemanticCampaignPlan,
	parseSemanticCampaignCliArgs,
	validateRawArtifact,
} from "./semantic-campaign-cli.js";

function sha256(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

describe("semantic campaign CLI", () => {
	it("requires an explicit seed and a three-engine-balanced repetition count", () => {
		expect(() =>
			parseSemanticCampaignCliArgs([
				"--contract=contract.json",
				"--output-dir=out",
			]),
		).toThrow("non-blank --seed");
		expect(() =>
			parseSemanticCampaignCliArgs([
				"--contract=contract.json",
				"--output-dir=out",
				"--seed=frozen",
				"--repetitions=2",
			]),
		).toThrow("positive multiple of 3");
	});

	it("rejects duplicate and unknown campaign arguments", () => {
		expect(() =>
			parseSemanticCampaignCliArgs([
				"--contract=contract.json",
				"--output-dir=out",
				"--seed=frozen",
				"--seed=alternate",
			]),
		).toThrow("duplicate argument: --seed");
		expect(() =>
			parseSemanticCampaignCliArgs([
				"--contract=contract.json",
				"--output-dir=out",
				"--seed=frozen",
				"--engine=naia",
			]),
		).toThrow("unknown argument: --engine");
	});

	it("builds a reproducible three-engine position-balanced schedule", () => {
		const first = buildSemanticCampaignPlan("frozen-campaign", 6);
		expect(first).toEqual(buildSemanticCampaignPlan("frozen-campaign", 6));
		expect(first).toHaveLength(18);
		for (const engine of ["hindsight", "mem0", "naia"] as const) {
			expect(
				first.filter(
					(run) => run.engine === engine && run.enginePosition === 1,
				),
			).toHaveLength(2);
			expect(
				first.filter(
					(run) => run.engine === engine && run.enginePosition === 2,
				),
			).toHaveLength(2);
			expect(
				first.filter(
					(run) => run.engine === engine && run.enginePosition === 3,
				),
			).toHaveLength(2);
		}
	});

	it("shares one case seed between engines and changes it per repetition", () => {
		const plan = buildSemanticCampaignPlan("frozen-campaign", 3);
		const first = plan.filter((run) => run.repetition === 1);
		const second = plan.filter((run) => run.repetition === 2);
		expect(new Set(first.map((run) => run.caseExecutionSeed))).toHaveLength(1);
		expect(new Set(second.map((run) => run.caseExecutionSeed))).toHaveLength(1);
		expect(first[0]?.caseExecutionSeed).not.toBe(second[0]?.caseExecutionSeed);
	});

	it("validates raw artifact identity, case count, and case output hashes", () => {
		const directory = mkdtempSync(resolve(tmpdir(), "semantic-campaign-"));
		const path = resolve(directory, "raw.json");
		const expected: SemanticCampaignRun = {
			repetition: 1,
			enginePosition: 1,
			engine: "naia",
			caseExecutionSeed: "case-seed",
			outputFile: "raw.json",
		};
		const rawOutput = {
			ingestionReceipts: [{ outcome: "opaque" }],
			nativeState: [{ nativeId: "1", content: "기억" }],
			retrieved: [{ nativeId: "1", content: "기억" }],
		};
		const benchmarkCase: MemoryUpdateCase = {
			id: "ko-update",
			familyId: "update",
			split: "diagnostic",
			language: "ko",
			turns: [{ content: "기억", at: "2026-01-01T00:00:00Z" }],
			query: "현재 기억은?",
			expectedCurrentIds: ["current"],
			forbiddenStaleIds: [],
			expectedDeletedIds: [],
			noUpdateIds: [],
			expectedDecision: "update",
		};
		const engineInput = {
			language: benchmarkCase.language,
			turns: benchmarkCase.turns.map((turn) => ({ content: turn.content })),
			query: benchmarkCase.query,
		};
		const artifact = {
			schemaVersion: "naia-memory-semantic-raw-artifact-v2",
			disclosure: { engine: "naia", executionSeed: "case-seed", topK: 1 },
			cases: [
				{
					caseId: benchmarkCase.id,
					executionPosition: 1,
					language: benchmarkCase.language,
					fixtureSha256: sha256({
						language: benchmarkCase.language,
						turns: benchmarkCase.turns,
						query: benchmarkCase.query,
					}),
					engineInputSha256: sha256(engineInput),
					ingestionPolicy: "sequential-turn-commit-v1",
					temporalInputPolicy: "engine-default-ingest-time-v1",
					retrievalSurface: "engine-native-semantic-memory-v1",
					...rawOutput,
					outputSha256: sha256(rawOutput),
				},
			],
		};
		try {
			writeFileSync(path, JSON.stringify(artifact));
			expect(() =>
				validateRawArtifact(path, expected, [benchmarkCase]),
			).not.toThrow();
			for (const mutate of [
				(current: typeof artifact) => {
					current.schemaVersion = "wrong";
				},
				(current: typeof artifact) => {
					current.disclosure.engine = "mem0";
				},
				(current: typeof artifact) => {
					current.disclosure.executionSeed = "wrong";
				},
				(current: typeof artifact) => {
					current.cases[0].caseId = "wrong";
				},
				(current: typeof artifact) => {
					current.cases[0].fixtureSha256 = "wrong";
				},
				(current: typeof artifact) => {
					current.cases[0].retrieved[0].content = "변조됨";
				},
				(current: typeof artifact) => {
					current.cases[0].retrieved[0].nativeId = "ghost";
				},
				(current: typeof artifact) => {
					current.cases[0].retrieved.push({
						nativeId: "1",
						content: "기억",
					});
					current.cases[0].outputSha256 = sha256({
						ingestionReceipts: current.cases[0].ingestionReceipts,
						nativeState: current.cases[0].nativeState,
						retrieved: current.cases[0].retrieved,
					});
				},
				(current: typeof artifact) => {
					current.disclosure.topK = 0;
				},
			]) {
				const tampered = structuredClone(artifact);
				mutate(tampered);
				writeFileSync(path, JSON.stringify(tampered));
				expect(() =>
					validateRawArtifact(path, expected, [benchmarkCase]),
				).toThrow("invalid semantic raw artifact");
			}
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
