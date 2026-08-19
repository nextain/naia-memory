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
