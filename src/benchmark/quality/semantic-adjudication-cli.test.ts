import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { scoreSemanticAdjudication } from "./semantic-adjudication-cli.js";
import { buildSemanticBlindArtifacts } from "./semantic-blind-packet-cli.js";
import { semanticBlindFixture } from "./semantic-blind-packet-fixture.js";

function setup(directory: string) {
	const current = semanticBlindFixture(directory);
	const hashes = {
		contractSha256: "contract-hash",
		campaignSha256: "campaign-hash",
	};
	const blindingSeed = "private-blinding-seed";
	const artifacts = buildSemanticBlindArtifacts({
		contract: current.contract,
		campaign: current.campaign,
		campaignDirectory: directory,
		blindingSeed,
		...hashes,
	});
	const judgments = {
		schemaVersion: "naia-memory-semantic-judgments-v1",
		packetContentSha256: artifacts.packet.packetContentSha256,
		adjudicators: [
			{
				id: "reviewer-opaque-1",
				nativeLanguages: ["ko"],
				completedAt: "2026-08-19T08:00:00Z",
				independentFromEngineImplementers: true,
			},
		],
		samples: artifacts.packet.samples.map((sample) => ({
			sampleId: sample.sampleId,
			adjudicatorId: "reviewer-opaque-1",
			judgments: sample.retrieved.map((memory) => ({
				memoryId: memory.memoryId,
				label: "current",
				notes: "",
			})),
		})),
	};
	return { current, hashes, blindingSeed, artifacts, judgments };
}

describe("semantic adjudication scorer", () => {
	it("unseals complete judgments and reports transparent sample counts", () => {
		const directory = mkdtempSync(resolve(tmpdir(), "semantic-score-"));
		try {
			const value = setup(directory);
			const score = scoreSemanticAdjudication({
				contract: value.current.contract,
				campaign: value.current.campaign,
				campaignDirectory: directory,
				blindingSeed: value.blindingSeed,
				...value.hashes,
				packet: value.artifacts.packet,
				seal: value.artifacts.seal,
				judgmentsBytes: JSON.stringify(value.judgments),
			});
			expect(score.cells["naia/ko"]).toMatchObject({
				samples: 3,
				currentAt1: 3,
			});
			expect(score.cells["mem0/ko"]).toMatchObject({
				samples: 3,
				currentAt1: 3,
			});
			expect(score.cells["hindsight/ko"]).toMatchObject({
				samples: 3,
				currentAt1: 3,
			});
			expect(score.samples).toHaveLength(9);
			expect(score.disclosure.judgmentsFileSha256).toMatch(/^[0-9a-f]{64}$/);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("rejects unused adjudicator provenance entries", () => {
		const directory = mkdtempSync(resolve(tmpdir(), "semantic-score-"));
		try {
			const value = setup(directory);
			value.judgments.adjudicators.push({
				id: "reviewer-opaque-unused",
				nativeLanguages: ["ko"],
				completedAt: "2026-08-19T08:00:00Z",
				independentFromEngineImplementers: true,
			});
			expect(() =>
				scoreSemanticAdjudication({
					contract: value.current.contract,
					campaign: value.current.campaign,
					campaignDirectory: directory,
					blindingSeed: value.blindingSeed,
					...value.hashes,
					packet: value.artifacts.packet,
					seal: value.artifacts.seal,
					judgmentsBytes: JSON.stringify(value.judgments),
				}),
			).toThrow("every declared adjudicator");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("rejects seal tampering, incomplete coverage, and ambiguous labels without notes", () => {
		const directory = mkdtempSync(resolve(tmpdir(), "semantic-score-"));
		try {
			const value = setup(directory);
			const base = {
				contract: value.current.contract,
				campaign: value.current.campaign,
				campaignDirectory: directory,
				blindingSeed: value.blindingSeed,
				...value.hashes,
				packet: value.artifacts.packet,
				seal: value.artifacts.seal,
				judgmentsBytes: JSON.stringify(value.judgments),
			};
			const forgedSeal = structuredClone(value.artifacts.seal);
			forgedSeal.samples[0].engine =
				forgedSeal.samples[0].engine === "naia" ? "mem0" : "naia";
			expect(() =>
				scoreSemanticAdjudication({ ...base, seal: forgedSeal }),
			).toThrow("seal does not match");
			const incomplete = structuredClone(value.judgments);
			incomplete.samples.pop();
			expect(() =>
				scoreSemanticAdjudication({
					...base,
					judgmentsBytes: JSON.stringify(incomplete),
				}),
			).toThrow("cover every packet sample");
			const uncertain = structuredClone(value.judgments);
			uncertain.samples[0].judgments[0].label = "uncertain";
			expect(() =>
				scoreSemanticAdjudication({
					...base,
					judgmentsBytes: JSON.stringify(uncertain),
				}),
			).toThrow("requires notes");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("requires each sample to be assigned to a native-language adjudicator", () => {
		const directory = mkdtempSync(resolve(tmpdir(), "semantic-score-"));
		try {
			const value = setup(directory);
			value.judgments.adjudicators[0].nativeLanguages = ["en"];
			expect(() =>
				scoreSemanticAdjudication({
					contract: value.current.contract,
					campaign: value.current.campaign,
					campaignDirectory: directory,
					blindingSeed: value.blindingSeed,
					...value.hashes,
					packet: value.artifacts.packet,
					seal: value.artifacts.seal,
					judgmentsBytes: JSON.stringify(value.judgments),
				}),
			).toThrow("uncovered judgments");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("accepts explicitly disclosed model adjudication without a native-language claim", () => {
		const directory = mkdtempSync(resolve(tmpdir(), "semantic-score-"));
		try {
			const value = setup(directory);
			const modelJudgments = {
				...value.judgments,
				schemaVersion: "naia-memory-semantic-judgments-v2",
				adjudicators: [
					{
						id: "model-1",
						kind: "model",
						languageCoverage: ["ko"],
						completedAt: "2026-08-19T08:00:00Z",
						independentFromEngineImplementers: true,
						provider: "test",
						model: "judge-1",
						promptSha256: "a".repeat(64),
					},
				],
				samples: value.judgments.samples.map((sample) => ({
					...sample,
					adjudicatorId: "model-1",
				})),
			};
			const score = scoreSemanticAdjudication({
				contract: value.current.contract,
				campaign: value.current.campaign,
				campaignDirectory: directory,
				blindingSeed: value.blindingSeed,
				...value.hashes,
				packet: value.artifacts.packet,
				seal: value.artifacts.seal,
				judgmentsBytes: JSON.stringify(modelJudgments),
			});
			expect(score.disclosure.adjudicators[0]).toMatchObject({
				kind: "model",
				model: "judge-1",
			});
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
