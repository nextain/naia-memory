import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { MemoryUpdateContract } from "./memory-update-contract.js";
import {
	buildSemanticBlindArtifacts,
	parseSemanticBlindPacketCliArgs,
	runSemanticBlindPacketCli,
} from "./semantic-blind-packet-cli.js";
import { buildSemanticCampaignPlan } from "./semantic-campaign-cli.js";

function sha256(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function sha256Json(value: unknown): string {
	return sha256(JSON.stringify(value));
}

function fixture(directory: string) {
	const contract: MemoryUpdateContract = {
		schemaVersion: "naia-memory-update-contract-v1",
		tier: "semantic-update-interpretation",
		construction: "generated-diagnostic",
		cases: [
			{
				id: "ko-update",
				familyId: "update",
				split: "diagnostic",
				language: "ko",
				turns: [
					{ content: "저는 부산에 살아요.", at: "2026-01-01T00:00:00Z" },
					{ content: "이제 서울로 이사했어요.", at: "2026-02-01T00:00:00Z" },
				],
				query: "지금 어디에 살고 있나요?",
				expectedCurrentIds: ["seoul"],
				forbiddenStaleIds: ["busan"],
				expectedDeletedIds: [],
				noUpdateIds: [],
				expectedDecision: "update",
			},
		],
	};
	const contractPath = resolve(directory, "contract.json");
	writeFileSync(contractPath, JSON.stringify(contract));
	const executionSeed = "frozen-campaign";
	const runs = buildSemanticCampaignPlan(executionSeed, 2).map((run) => {
		const output = {
			ingestionReceipts: [{ outcome: "opaque" }],
			nativeState: [{ nativeId: `${run.engine}-native`, content: "서울 거주" }],
			retrieved: [{ nativeId: `${run.engine}-native`, content: "서울 거주" }],
		};
		const benchmarkCase = contract.cases[0];
		const artifact = {
			schemaVersion: "naia-memory-semantic-raw-artifact-v2",
			disclosure: { engine: run.engine, executionSeed: run.caseExecutionSeed },
			cases: [
				{
					caseId: benchmarkCase.id,
					executionPosition: 1,
					language: benchmarkCase.language,
					fixtureSha256: sha256Json({
						language: benchmarkCase.language,
						turns: benchmarkCase.turns,
						query: benchmarkCase.query,
					}),
					engineInputSha256: sha256Json({
						language: benchmarkCase.language,
						turns: benchmarkCase.turns.map(({ content }) => ({ content })),
						query: benchmarkCase.query,
					}),
					ingestionPolicy: "sequential-turn-commit-v1",
					temporalInputPolicy: "engine-default-ingest-time-v1",
					retrievalSurface: "engine-native-semantic-memory-v1",
					...output,
					outputSha256: sha256Json(output),
				},
			],
		};
		const bytes = JSON.stringify(artifact);
		writeFileSync(resolve(directory, run.outputFile), bytes);
		return { ...run, artifactSha256: sha256(bytes) };
	});
	const campaign = {
		schemaVersion: "naia-memory-semantic-campaign-v1" as const,
		disclosure: { executionSeed, repetitions: 2, topK: 5 },
		runs,
	};
	const campaignPath = resolve(directory, "campaign.json");
	writeFileSync(campaignPath, JSON.stringify(campaign));
	return { contract, contractPath, campaign, campaignPath };
}

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
			const current = fixture(directory);
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
			expect(blindedPayload).not.toContain("native");
			expect(blindedPayload).not.toContain("repetition-");
			expect(artifacts.packet.samples).toHaveLength(4);
			expect(artifacts.packet.samples[0]?.judgments).toEqual([
				{ memoryId: "memory-01", label: null, notes: "" },
			]);
			expect(
				artifacts.seal.samples.map((sample) => sample.engine).sort(),
			).toEqual(["mem0", "mem0", "naia", "naia"]);
			expect(artifacts.seal.packetContentSha256).toBe(
				artifacts.packet.packetContentSha256,
			);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("fails closed on a forged campaign schedule or artifact hash", () => {
		const directory = mkdtempSync(resolve(tmpdir(), "semantic-blind-"));
		try {
			const current = fixture(directory);
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
			const current = fixture(directory);
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
