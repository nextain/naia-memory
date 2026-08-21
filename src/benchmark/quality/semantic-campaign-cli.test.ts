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
	it("requires an explicit seed and an engine-matrix-balanced repetition count", () => {
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
		).toThrow("4-engine matrix");
		expect(() =>
			parseSemanticCampaignCliArgs([
				"--contract=contract.json",
				"--output-dir=out",
				"--seed=frozen",
				"--top-k=0",
			]),
		).toThrow("--top-k must be a positive integer");
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
				"--unknown=naia",
			]),
		).toThrow("unknown argument: --unknown");
	});

	it("accepts only unique executable engine subsets", () => {
		const parsed = parseSemanticCampaignCliArgs([
			"--contract=contract.json",
			"--output-dir=out",
			"--seed=frozen",
			"--engines=naia,mem0",
		]);
		expect(parsed.engines).toEqual(["naia", "mem0"]);
		expect(parsed.repetitions).toBe(2);
		for (const engines of ["naia", "naia,naia", "naia,graphiti", ",naia"]) {
			expect(() =>
				parseSemanticCampaignCliArgs([
					"--contract=contract.json",
					"--output-dir=out",
					"--seed=frozen",
					`--engines=${engines}`,
				]),
			).toThrow("at least two unique engines");
		}
	});

	it("builds a reproducible four-engine position-balanced schedule", () => {
		const first = buildSemanticCampaignPlan("frozen-campaign", 8);
		expect(first).toEqual(buildSemanticCampaignPlan("frozen-campaign", 8));
		expect(first).toHaveLength(32);
		for (const engine of ["hindsight", "letta", "mem0", "naia"] as const) {
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
			expect(
				first.filter(
					(run) => run.engine === engine && run.enginePosition === 4,
				),
			).toHaveLength(2);
		}
	});

	it("balances arbitrary engine matrices without treating missing arms as scores", () => {
		for (const engines of [
			["a", "b"],
			["a", "b", "c"],
			["a", "b", "c", "d"],
		]) {
			const plan = buildSemanticCampaignPlan(
				"matrix-seed",
				engines.length,
				engines,
			);
			expect(plan).toHaveLength(engines.length ** 2);
			for (const engine of engines)
				expect(
					Array.from(
						{ length: engines.length },
						(_unused, index) =>
							plan.filter(
								(run) =>
									run.engine === engine && run.enginePosition === index + 1,
							).length,
					),
				).toEqual(Array.from({ length: engines.length }, () => 1));
		}
		expect(() => buildSemanticCampaignPlan("seed", 2, ["a", "a"])).toThrow(
			"at least two unique names",
		);
	});

	it("balances every position across repeated Latin cycles", () => {
		const engines = ["a", "b", "c", "d"];
		const plan = buildSemanticCampaignPlan("multi-cycle", 8, engines);
		for (const engine of engines)
			for (let position = 1; position <= engines.length; position += 1)
				expect(
					plan.filter(
						(run) => run.engine === engine && run.enginePosition === position,
					),
				).toHaveLength(2);
	});

	it("shares one case seed between engines and changes it per repetition", () => {
		const plan = buildSemanticCampaignPlan("frozen-campaign", 4);
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
				validateRawArtifact(path, expected, [benchmarkCase], 1),
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
					current.disclosure.topK = 50;
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
					current.cases[0].retrieved[0].content = 123 as unknown as string;
					current.cases[0].outputSha256 = sha256({
						ingestionReceipts: current.cases[0].ingestionReceipts,
						nativeState: current.cases[0].nativeState,
						retrieved: current.cases[0].retrieved,
					});
				},
				(current: typeof artifact) => {
					current.cases[0].nativeState[0].content = 123 as unknown as string;
					current.cases[0].outputSha256 = sha256({
						ingestionReceipts: current.cases[0].ingestionReceipts,
						nativeState: current.cases[0].nativeState,
						retrieved: current.cases[0].retrieved,
					});
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
					validateRawArtifact(path, expected, [benchmarkCase], 1),
				).toThrow("invalid semantic raw artifact");
			}
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
