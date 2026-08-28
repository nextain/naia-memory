import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildSemanticBlindArtifacts,
	parseSemanticBlindPacketCliArgs,
	runSemanticBlindPacketCli,
} from "./semantic-blind-packet-cli.js";
import { semanticBlindFixture } from "./semantic-blind-packet-fixture.js";

describe("semantic blind packet CLI", () => {
	it("requires explicit inputs and rejects duplicate arguments", () => {
		expect(() => parseSemanticBlindPacketCliArgs([])).toThrow("are required");
		expect(() =>
			parseSemanticBlindPacketCliArgs([
				"--contract=a",
				"--campaign=b",
				"--output-dir=c",
				"--seed=one",
				"--seed=two",
			]),
		).toThrow("duplicate argument: --seed");
	});

	it("removes explicit engine identity while preserving a sealed mapping", () => {
		const directory = mkdtempSync(resolve(tmpdir(), "semantic-blind-"));
		try {
			const current = semanticBlindFixture(directory);
			const artifacts = buildSemanticBlindArtifacts({
				contract: current.contract,
				campaign: current.campaign,
				campaignDirectory: directory,
				blindingSeed: "private-blinding-seed",
				contractSha256: "contract-hash",
				campaignSha256: "campaign-hash",
			});
			const { schemaVersion, ...identityBlindPacket } = artifacts.packet;
			expect(schemaVersion).toBe("naia-memory-semantic-blind-packet-v1");
			const blindedPayload = JSON.stringify(identityBlindPacket);
			expect(blindedPayload).not.toContain("mem0");
			expect(blindedPayload).not.toContain("naia");
			expect(blindedPayload).not.toContain("hindsight");
			expect(blindedPayload).not.toContain("native");
			expect(blindedPayload).not.toContain("repetition-");
			expect(artifacts.packet.samples).toHaveLength(9);
			expect(artifacts.packet.samples[0]?.judgments).toEqual([
				{ memoryId: "memory-01", label: null, notes: "" },
			]);
			expect(
				artifacts.seal.samples.map((sample) => sample.engine).sort(),
			).toEqual([
				"hindsight",
				"hindsight",
				"hindsight",
				"mem0",
				"mem0",
				"mem0",
				"naia",
				"naia",
				"naia",
			]);
			expect(artifacts.seal.packetContentSha256).toBe(
				artifacts.packet.packetContentSha256,
			);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("consumes a disclosed subset without inventing an absent engine arm", () => {
		const directory = mkdtempSync(resolve(tmpdir(), "semantic-blind-subset-"));
		try {
			const current = semanticBlindFixture(directory, {
				engines: ["naia", "mem0"],
				schemaVersion: "naia-memory-semantic-campaign-v3",
			});
			const artifacts = buildSemanticBlindArtifacts({
				contract: current.contract,
				campaign: current.campaign,
				campaignDirectory: directory,
				blindingSeed: "private-blinding-seed",
				contractSha256: "contract-hash",
				campaignSha256: "campaign-hash",
			});
			expect(artifacts.packet.samples).toHaveLength(4);
			expect(
				new Set(artifacts.seal.samples.map((sample) => sample.engine)),
			).toEqual(new Set(["naia", "mem0"]));
			expect(JSON.stringify(artifacts.seal)).not.toContain("hindsight");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("rejects malformed v3 engine disclosures before consuming artifacts", () => {
		const directory = mkdtempSync(resolve(tmpdir(), "semantic-blind-invalid-"));
		try {
			const current = semanticBlindFixture(directory, {
				engines: ["naia", "mem0"],
				schemaVersion: "naia-memory-semantic-campaign-v3",
			});
			const invalidCampaigns = [
				{ ...current.campaign, disclosure: undefined },
				{
					...current.campaign,
					disclosure: {
						...current.campaign.disclosure,
						engines: ["naia"],
					},
				},
				{
					...current.campaign,
					disclosure: {
						...current.campaign.disclosure,
						engines: ["naia", "naia"],
					},
				},
				{
					...current.campaign,
					disclosure: {
						...current.campaign.disclosure,
						engines: ["naia", "unknown"],
					},
				},
				{
					...current.campaign,
					disclosure: {
						...current.campaign.disclosure,
						engines: [1, 2],
					},
				},
				{
					...current.campaign,
					disclosure: { ...current.campaign.disclosure, repetitions: 3 },
				},
			];
			for (const campaign of invalidCampaigns)
				expect(() =>
					buildSemanticBlindArtifacts({
						contract: current.contract,
						campaign: campaign as typeof current.campaign,
						campaignDirectory: directory,
						blindingSeed: "seed",
						contractSha256: "contract",
						campaignSha256: "campaign",
					}),
				).toThrow("invalid semantic campaign manifest");
			const legacy = semanticBlindFixture(directory);
			expect(() =>
				buildSemanticBlindArtifacts({
					contract: legacy.contract,
					campaign: {
						...legacy.campaign,
						disclosure: {
							...legacy.campaign.disclosure,
							engines: ["naia", "mem0"],
						},
					},
					campaignDirectory: directory,
					blindingSeed: "seed",
					contractSha256: "contract",
					campaignSha256: "campaign",
				}),
			).toThrow("invalid semantic campaign manifest");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("rejects an empty v4 competitive comparison-lane disclosure", () => {
		const directory = mkdtempSync(
			resolve(tmpdir(), "semantic-blind-v4-lanes-"),
		);
		try {
			const current = semanticBlindFixture(directory, {
				engines: ["naia", "mem0"],
				schemaVersion: "naia-memory-semantic-campaign-v4",
			});
			current.campaign.disclosure.analysisPlanSha256 = "a".repeat(64);
			current.campaign.disclosure.claimScope =
				"direct-lifecycle-competitive-report-v1";
			current.campaign.disclosure.comparisonLanes = {};
			current.campaign.disclosure.crossLaneAggregation = "prohibited";
			expect(() =>
				buildSemanticBlindArtifacts({
					contract: current.contract,
					campaign: current.campaign,
					campaignDirectory: directory,
					blindingSeed: "seed",
					contractSha256: "contract",
					campaignSha256: "campaign",
				}),
			).toThrow("invalid semantic campaign manifest");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("rejects a v6 campaign whose retrieval baseline lane is missing", () => {
		const directory = mkdtempSync(
			resolve(tmpdir(), "semantic-blind-v6-lanes-"),
		);
		try {
			const current = semanticBlindFixture(directory, {
				engines: ["naia", "mem0", "plain-vector"],
				schemaVersion: "naia-memory-semantic-campaign-v3",
			});
			const disclosure = current.campaign.disclosure as Record<string, unknown>;
			(current.campaign as { schemaVersion: string }).schemaVersion =
				"naia-memory-semantic-campaign-v5";
			Object.assign(disclosure, {
				eligibility: "competitive-candidate",
				analysisPlanSha256: "a".repeat(64),
				analysisPlanSchemaVersion: "naia-memory-semantic-analysis-plan-v6",
				claimScope: "declared-multi-class-competitive-report-v1",
				comparisonLanes: {
					directLifecycle: ["hindsight", "mem0"],
					nativeTemporalCharacterization: ["graphiti-historical"],
					agentManagedCharacterization: ["letta"],
					productIntegrationDiagnostic: [],
					retrievalBaseline: [],
				},
				crossLaneAggregation: "prohibited",
				confirmatoryAuthorizationSha256: "b".repeat(64),
				analysisPlanTimestampEvidenceSha256: "c".repeat(64),
				analysisPlanTimestampTrustPolicyIdentitySha256: "d".repeat(64),
			});
			expect(() =>
				buildSemanticBlindArtifacts({
					contract: current.contract,
					campaign: current.campaign,
					campaignDirectory: directory,
					blindingSeed: "seed",
					contractSha256: "contract",
					campaignSha256: "campaign",
				}),
			).toThrow("invalid semantic campaign manifest");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it.each([
		undefined,
		null,
		"naia-memory-semantic-analysis-plan-v5",
		"unknown",
	])(
		"rejects plain-vector with a downgraded analysis-plan schema: %s",
		(analysisPlanSchemaVersion) => {
			const directory = mkdtempSync(
				resolve(tmpdir(), "semantic-blind-baseline-schema-"),
			);
			try {
				const current = semanticBlindFixture(directory, {
					engines: ["naia", "mem0", "plain-vector"],
					schemaVersion: "naia-memory-semantic-campaign-v3",
				});
				const disclosure = current.campaign.disclosure as Record<
					string,
					unknown
				>;
				(current.campaign as { schemaVersion: string }).schemaVersion =
					"naia-memory-semantic-campaign-v5";
				Object.assign(disclosure, {
					eligibility: "competitive-candidate",
					analysisPlanSha256: "a".repeat(64),
					analysisPlanSchemaVersion,
					claimScope: "declared-multi-class-competitive-report-v1",
					comparisonLanes: {
						directLifecycle: ["hindsight", "mem0"],
						nativeTemporalCharacterization: ["graphiti-historical"],
						agentManagedCharacterization: ["letta"],
						productIntegrationDiagnostic: [],
						retrievalBaseline: ["plain-vector"],
					},
					crossLaneAggregation: "prohibited",
					confirmatoryAuthorizationSha256: "b".repeat(64),
					analysisPlanTimestampEvidenceSha256: "c".repeat(64),
					analysisPlanTimestampTrustPolicyIdentitySha256: "d".repeat(64),
				});
				expect(() =>
					buildSemanticBlindArtifacts({
						contract: current.contract,
						campaign: current.campaign,
						campaignDirectory: directory,
						blindingSeed: "seed",
						contractSha256: "contract",
						campaignSha256: "campaign",
					}),
				).toThrow("invalid semantic campaign manifest");
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		},
	);

	it.each([
		[undefined, false],
		[null, true],
		["unknown", true],
	] as const)(
		"applies the legacy plan-schema compatibility boundary: %s",
		(analysisPlanSchemaVersion, rejects) => {
			const directory = mkdtempSync(resolve(tmpdir(), "semantic-blind-v5-schema-"));
			try {
				const current = semanticBlindFixture(directory, {
					engines: ["graphiti", "graphiti-historical", "hindsight", "letta", "mem0", "naia"],
					schemaVersion: "naia-memory-semantic-campaign-v3",
				});
				(current.campaign as { schemaVersion: string }).schemaVersion =
					"naia-memory-semantic-campaign-v5";
				Object.assign(current.campaign.disclosure, {
					eligibility: "competitive-candidate",
					analysisPlanSha256: "a".repeat(64),
					analysisPlanSchemaVersion,
					claimScope: "declared-multi-class-competitive-report-v1",
					comparisonLanes: {
						directLifecycle: ["hindsight", "mem0"],
						nativeTemporalCharacterization: ["graphiti-historical"],
						agentManagedCharacterization: ["letta"],
						productIntegrationDiagnostic: ["graphiti"],
					},
					crossLaneAggregation: "prohibited",
					confirmatoryAuthorizationSha256: "b".repeat(64),
					analysisPlanTimestampEvidenceSha256: "c".repeat(64),
					analysisPlanTimestampTrustPolicyIdentitySha256: "d".repeat(64),
				});
				const build = () => buildSemanticBlindArtifacts({
					contract: current.contract,
					campaign: current.campaign,
					campaignDirectory: directory,
					blindingSeed: "seed",
					contractSha256: "contract",
					campaignSha256: "campaign",
				});
				if (rejects) expect(build).toThrow("invalid semantic campaign manifest");
				else expect(build).not.toThrow();
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		},
	);

	it("accepts a legacy v2 manifest that explicitly declares the canonical engines", () => {
		const directory = mkdtempSync(resolve(tmpdir(), "semantic-blind-v2-"));
		try {
			const current = semanticBlindFixture(directory);
			const artifacts = buildSemanticBlindArtifacts({
				contract: current.contract,
				campaign: {
					...current.campaign,
					disclosure: {
						...current.campaign.disclosure,
						engines: ["hindsight", "mem0", "naia"],
					},
				},
				campaignDirectory: directory,
				blindingSeed: "seed",
				contractSha256: "contract",
				campaignSha256: "campaign",
			});
			expect(artifacts.packet.samples).toHaveLength(9);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("fails closed on a forged campaign schedule or artifact hash", () => {
		const directory = mkdtempSync(resolve(tmpdir(), "semantic-blind-"));
		try {
			const current = semanticBlindFixture(directory);
			const forgedPlan = structuredClone(current.campaign);
			forgedPlan.runs[0].enginePosition = 2;
			expect(() =>
				buildSemanticBlindArtifacts({
					contract: current.contract,
					campaign: forgedPlan,
					campaignDirectory: directory,
					blindingSeed: "seed",
					contractSha256: "contract",
					campaignSha256: "campaign",
				}),
			).toThrow("run plan");
			const forgedHash = structuredClone(current.campaign);
			forgedHash.runs[0].artifactSha256 = "0".repeat(64);
			expect(() =>
				buildSemanticBlindArtifacts({
					contract: current.contract,
					campaign: forgedHash,
					campaignDirectory: directory,
					blindingSeed: "seed",
					contractSha256: "contract",
					campaignSha256: "campaign",
				}),
			).toThrow("artifact hash mismatch");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("publishes both files atomically and refuses to overwrite output", () => {
		const directory = mkdtempSync(resolve(tmpdir(), "semantic-blind-"));
		try {
			const current = semanticBlindFixture(directory);
			const outputDir = resolve(directory, "blind-output");
			const args = [
				`--contract=${current.contractPath}`,
				`--campaign=${current.campaignPath}`,
				`--output-dir=${outputDir}`,
				"--seed=private-blinding-seed",
			];
			runSemanticBlindPacketCli(args);
			expect(
				JSON.parse(
					readFileSync(resolve(outputDir, "adjudication-packet.json"), "utf8"),
				),
			).toHaveProperty("packetContentSha256");
			expect(
				JSON.parse(
					readFileSync(resolve(outputDir, "adjudication-seal.json"), "utf8"),
				),
			).toHaveProperty("samples.0.engine");
			expect(() => runSemanticBlindPacketCli(args)).toThrow("already exists");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
