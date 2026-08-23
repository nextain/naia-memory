import { createHash } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { MemoryUpdateCase } from "./memory-update-contract.js";
import { buildSemanticBlindArtifacts } from "./semantic-blind-packet-cli.js";
import {
	type SemanticCampaignRun,
	buildSemanticCampaignPlan,
	parseSemanticCampaignCliArgs,
	runSemanticCampaignCli,
	validateRawArtifact,
} from "./semantic-campaign-cli.js";
import { expectedSemanticRetrievalSurface } from "./semantic-raw-cli.js";

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
		).toThrow("6-engine matrix");
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
		for (const engines of ["naia", "naia,naia", "naia,unknown", ",naia"]) {
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

	it("accepts an explicit preregistered analysis plan path", () => {
		const parsed = parseSemanticCampaignCliArgs([
			"--contract=contract.json",
			"--output-dir=out",
			"--seed=frozen",
			"--engines=naia,mem0",
			"--analysis-plan=analysis-plan.json",
			"--analysis-plan-trust-policy=analysis-plan-trust-policy.json",
		]);
		expect(parsed.analysisPlanPath).toBe("analysis-plan.json");
		expect(parsed.analysisPlanTrustPolicyPath).toBe(
			"analysis-plan-trust-policy.json",
		);
	});

	it("rejects a malformed analysis plan before creating campaign output", async () => {
		const directory = mkdtempSync(resolve(tmpdir(), "semantic-campaign-plan-"));
		const contractPath = resolve(directory, "contract.json");
		const analysisPlanPath = resolve(directory, "analysis-plan.json");
		const analysisPlanTrustPolicyPath = resolve(
			directory,
			"analysis-plan-trust-policy.json",
		);
		const outputDir = resolve(directory, "output");
		writeFileSync(
			contractPath,
			JSON.stringify({
				schemaVersion: "naia-memory-update-contract-v1",
				tier: "semantic-update-interpretation",
				construction: "generated-diagnostic",
				familySplitFreeze: {
					frozenAt: "2026-01-01T00:00:00Z",
					digest: `sha256:${"0".repeat(64)}`,
				},
				cases: [
					{
						id: "case-ko",
						familyId: "family-ko",
						split: "diagnostic",
						language: "ko",
						turns: [{ content: "기억", at: "2026-01-01T00:00:00Z" }],
						query: "현재 기억은?",
						expectedCurrentIds: ["current"],
						forbiddenStaleIds: ["stale"],
						expectedDeletedIds: [],
						noUpdateIds: [],
						expectedDecision: "update",
					},
				],
			}),
		);
		writeFileSync(analysisPlanPath, JSON.stringify({ schemaVersion: "wrong" }));
		writeFileSync(analysisPlanTrustPolicyPath, JSON.stringify({}));
		try {
			await expect(
				runSemanticCampaignCli([
					`--contract=${contractPath}`,
					`--output-dir=${outputDir}`,
					"--seed=frozen",
					"--engines=naia,mem0",
					`--analysis-plan=${analysisPlanPath}`,
					`--analysis-plan-trust-policy=${analysisPlanTrustPolicyPath}`,
				]),
			).rejects.toThrow("valid semantic analysis plan");
			expect(existsSync(outputDir)).toBe(false);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("runs the production campaign launcher into the blind-packet gate", async () => {
		const directory = mkdtempSync(resolve(tmpdir(), "semantic-launcher-path-"));
		const contractPath = resolve(directory, "contract.json");
		const outputDir = resolve(directory, "campaign");
		const benchmarkCase: MemoryUpdateCase = {
			id: "case-ko",
			familyId: "family-ko",
			split: "diagnostic",
			language: "ko",
			turns: [
				{ content: "부산에서 서울로 이사했어요.", at: "2026-01-01T00:00:00Z" },
			],
			query: "지금 어디에 살고 있나요?",
			expectedCurrentIds: ["seoul"],
			forbiddenStaleIds: ["busan"],
			expectedDeletedIds: [],
			noUpdateIds: [],
			expectedDecision: "update",
		};
		const contract = {
			schemaVersion: "naia-memory-update-contract-v1" as const,
			tier: "semantic-update-interpretation" as const,
			construction: "generated-diagnostic" as const,
			cases: [benchmarkCase],
		};
		writeFileSync(contractPath, JSON.stringify(contract));
		try {
			await runSemanticCampaignCli(
				[
					`--contract=${contractPath}`,
					`--output-dir=${outputDir}`,
					"--seed=frozen",
					"--engines=naia,mem0",
				],
				{
					runSemanticRawCli: async (args) => {
						const values = new Map(
							args.map((arg) => {
								const [key, ...parts] = arg.split("=");
								return [key, parts.join("=")] as const;
							}),
						);
						const engine = values.get("--engine");
						const seed = values.get("--seed");
						const output = values.get("--output");
						if (!engine || !seed || !output)
							throw new Error("invalid injected raw arguments");
						const result = {
							ingestionReceipts: [{ outcome: "test-adapter" }],
							nativeState: [
								{ nativeId: `${engine}-current`, content: "서울 거주" },
							],
							retrieved: [
								{ nativeId: `${engine}-current`, content: "서울 거주" },
							],
						};
						writeFileSync(
							output,
							JSON.stringify({
								schemaVersion: "naia-memory-semantic-raw-artifact-v2",
								disclosure: { engine, executionSeed: seed, topK: 5 },
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
										engineInputSha256: sha256({
											language: benchmarkCase.language,
											turns: benchmarkCase.turns.map(({ content }) => ({
												content,
											})),
											query: benchmarkCase.query,
										}),
										ingestionPolicy: "sequential-turn-commit-v1",
										temporalInputPolicy: "engine-default-ingest-time-v1",
										retrievalSurface: expectedSemanticRetrievalSurface(
											engine as "naia" | "mem0",
										),
										...result,
										outputSha256: sha256(result),
									},
								],
							}),
						);
					},
				},
			);
			const campaign = JSON.parse(
				readFileSync(resolve(outputDir, "campaign.json"), "utf8"),
			);
			const artifacts = buildSemanticBlindArtifacts({
				contract,
				campaign,
				campaignDirectory: outputDir,
				blindingSeed: "blind-seed",
				contractSha256: "contract",
				campaignSha256: "campaign",
			});
			expect(campaign.runs).toHaveLength(4);
			expect(artifacts.packet.samples).toHaveLength(4);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("builds a reproducible six-engine position-balanced schedule", () => {
		const first = buildSemanticCampaignPlan("frozen-campaign", 12);
		expect(first).toEqual(buildSemanticCampaignPlan("frozen-campaign", 12));
		expect(first).toHaveLength(72);
		for (const engine of [
			"graphiti",
			"graphiti-historical",
			"hindsight",
			"letta",
			"mem0",
			"naia",
		] as const) {
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
			for (const enginePosition of [5, 6])
				expect(
					first.filter(
						(run) =>
							run.engine === engine && run.enginePosition === enginePosition,
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
		const plan = buildSemanticCampaignPlan("frozen-campaign", 6);
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
				(current: typeof artifact) => {
					current.cases[0].retrievalSurface =
						"engine-current-state-projected-semantic-memory-v1";
				},
			]) {
				const tampered = structuredClone(artifact);
				mutate(tampered);
				writeFileSync(path, JSON.stringify(tampered));
				expect(() =>
					validateRawArtifact(path, expected, [benchmarkCase], 1),
				).toThrow("invalid semantic raw artifact");
			}

			const surfaceByEngine = {
				graphiti: "engine-current-state-projected-semantic-memory-v1",
				hindsight: "engine-native-semantic-memory-v1",
				letta: "engine-native-core-first-and-semantic-archive-v1",
				mem0: "engine-native-semantic-memory-v1",
				naia: "engine-native-semantic-memory-v1",
			} as const;
			const allSurfaces = [
				"engine-native-semantic-memory-v1",
				"engine-current-state-projected-semantic-memory-v1",
				"engine-native-core-state-v1",
				"engine-native-core-first-and-semantic-archive-v1",
			] as const;
			for (const [engine, allowedSurface] of Object.entries(surfaceByEngine)) {
				const matching = structuredClone(artifact);
				matching.disclosure.engine = engine;
				matching.cases[0].retrievalSurface = allowedSurface;
				writeFileSync(path, JSON.stringify(matching));
				expect(() =>
					validateRawArtifact(
						path,
						{ ...expected, engine },
						[benchmarkCase],
						1,
					),
				).not.toThrow();

				for (const rejectedSurface of allSurfaces) {
					if (rejectedSurface === allowedSurface) continue;
					const mislabeled = structuredClone(matching);
					mislabeled.cases[0].retrievalSurface = rejectedSurface;
					writeFileSync(path, JSON.stringify(mislabeled));
					expect(() =>
						validateRawArtifact(
							path,
							{ ...expected, engine },
							[benchmarkCase],
							1,
						),
					).toThrow("invalid semantic raw artifact");
				}
			}
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
