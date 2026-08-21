import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	evidenceObjectSha256,
	evidenceSignaturePayload,
} from "./public-evidence-crypto.js";
import {
	type SemanticAdjudicationEvidenceBundle,
	validateSemanticAdjudicationEvidence,
} from "./semantic-adjudication-evidence.js";
import { buildSemanticBlindArtifacts } from "./semantic-blind-packet-cli.js";
import { semanticBlindFixture } from "./semantic-blind-packet-fixture.js";

function fixture(directory: string) {
	const current = semanticBlindFixture(directory, {
		schemaVersion: "naia-memory-semantic-campaign-v3",
		engines: ["hindsight", "mem0", "naia"],
	});
	current.contract.familySplitFreeze = {
		frozenAt: "2026-08-19T00:00:00Z",
		digest: `sha256:${"0".repeat(64)}`,
	};
	const blindingSeed = "private-blinding-seed";
	const campaignBytes = Buffer.from(JSON.stringify(current.campaign));
	const hashes = {
		contractSha256: evidenceObjectSha256(current.contract),
		campaignSha256: createSha256(campaignBytes),
	};
	const artifacts = buildSemanticBlindArtifacts({
		contract: current.contract,
		campaign: current.campaign,
		campaignDirectory: directory,
		blindingSeed,
		...hashes,
	});
	const completedAt = "2026-08-20T00:00:00Z";
	const judgments = {
		schemaVersion: "naia-memory-semantic-judgments-v1",
		packetContentSha256: artifacts.packet.packetContentSha256,
		adjudicators: [
			{
				id: "independent-ko-judge",
				nativeLanguages: ["ko"],
				completedAt,
				independentFromEngineImplementers: true,
			},
		],
		samples: artifacts.packet.samples.map((sample) => ({
			sampleId: sample.sampleId,
			adjudicatorId: "independent-ko-judge",
			judgments: sample.retrieved.map((memory) => ({
				memoryId: memory.memoryId,
				label: "current",
				notes: "",
			})),
		})),
	};
	const judgmentsBytes = Buffer.from(JSON.stringify(judgments));
	return {
		current,
		blindingSeed,
		campaignBytes,
		artifacts,
		completedAt,
		judgmentsBytes,
		contractSha256: hashes.contractSha256,
		directory,
	};
}

function signedInput(directory: string) {
	const value = fixture(directory);
	const campaignSha256 = createSha256(value.campaignBytes);
	const sealSha256 = evidenceObjectSha256(value.artifacts.seal);
	const judgmentsFileSha256 = createSha256(value.judgmentsBytes);
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	const unsigned = {
		schemaVersion: "naia-memory-semantic-adjudication-receipt-v1" as const,
		adjudicatorId: "independent-ko-judge",
		contractSha256: value.contractSha256,
		campaignSha256,
		packetContentSha256: value.artifacts.packet.packetContentSha256,
		sealSha256,
		judgmentsFileSha256,
		completedAt: value.completedAt,
		signedAt: "2026-08-20T00:01:00Z",
		statement: "BLINDED_JUDGMENTS_CONFIRMED" as const,
	};
	const receipt = {
		...unsigned,
		signatureBase64: sign(
			null,
			evidenceSignaturePayload(unsigned),
			privateKey,
		).toString("base64"),
	};
	const bundle: SemanticAdjudicationEvidenceBundle = {
		schemaVersion: "naia-memory-semantic-adjudication-evidence-bundle-v1",
		contractSha256: value.contractSha256,
		campaignSha256,
		packetContentSha256: value.artifacts.packet.packetContentSha256,
		sealSha256,
		judgmentsFileSha256,
		receipts: [receipt],
	};
	const trustPolicy = {
		adjudicators: {
			"independent-ko-judge": {
				publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
				independentOfEngines: ["hindsight", "mem0", "naia"],
				profile: { kind: "human" as const, nativeLanguages: ["ko"] },
			},
		},
	};
	return { value, bundle, trustPolicy };
}

function createSha256(value: Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function validate(current: ReturnType<typeof signedInput>) {
	return validateSemanticAdjudicationEvidence({
		contract: current.value.current.contract,
		campaign: current.value.current.campaign,
		campaignBytes: current.value.campaignBytes,
		campaignDirectory: current.value.directory,
		blindingSeed: current.value.blindingSeed,
		packet: current.value.artifacts.packet,
		seal: current.value.artifacts.seal,
		judgmentsBytes: current.value.judgmentsBytes,
		bundle: current.bundle,
		trustPolicy: current.trustPolicy,
	});
}

describe("semantic adjudication evidence", () => {
	it("recomputes scores from signed raw judgments and scopes human coverage", () => {
		const directory = mkdtempSync(resolve(tmpdir(), "adjudication-evidence-"));
		try {
			const result = validate(signedInput(directory));
			expect(result.adjudicatorCount).toBe(1);
			expect(result.humanJudgedLanguages).toEqual(["ko"]);
			expect(result.modelOnlyLanguages).toEqual([]);
			expect(result.score.cells["naia/ko"].currentAt1).toBe(3);
			expect(result).toMatchObject({
				evidenceScope: "signed-artifact-integrity-and-coverage",
				blindnessVerified: false,
				organizationalIndependenceVerified: false,
				interRaterAgreementEvaluated: false,
			});
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("rejects identity and key reuse across evidence roles", () => {
		const directory = mkdtempSync(resolve(tmpdir(), "adjudication-evidence-"));
		try {
			const identityReuse = signedInput(directory);
			expect(() =>
				validateSemanticAdjudicationEvidence({
					contract: identityReuse.value.current.contract,
					campaign: identityReuse.value.current.campaign,
					campaignBytes: identityReuse.value.campaignBytes,
					campaignDirectory: identityReuse.value.directory,
					blindingSeed: identityReuse.value.blindingSeed,
					packet: identityReuse.value.artifacts.packet,
					seal: identityReuse.value.artifacts.seal,
					judgmentsBytes: identityReuse.value.judgmentsBytes,
					bundle: identityReuse.bundle,
					trustPolicy: identityReuse.trustPolicy,
					forbiddenTrustIdentities: ["independent-ko-judge"],
				}),
			).toThrow("overlaps another evidence role");

			const keyReuse = signedInput(directory);
			expect(() =>
				validateSemanticAdjudicationEvidence({
					contract: keyReuse.value.current.contract,
					campaign: keyReuse.value.current.campaign,
					campaignBytes: keyReuse.value.campaignBytes,
					campaignDirectory: keyReuse.value.directory,
					blindingSeed: keyReuse.value.blindingSeed,
					packet: keyReuse.value.artifacts.packet,
					seal: keyReuse.value.artifacts.seal,
					judgmentsBytes: keyReuse.value.judgmentsBytes,
					bundle: keyReuse.bundle,
					trustPolicy: keyReuse.trustPolicy,
					forbiddenTrustPublicKeys: [
						keyReuse.trustPolicy.adjudicators["independent-ko-judge"].publicKey,
					],
				}),
			).toThrow("overlaps another evidence role");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("rejects changed bytes, forged independence, and key reuse", () => {
		const directory = mkdtempSync(resolve(tmpdir(), "adjudication-evidence-"));
		try {
			const changed = signedInput(directory);
			changed.value.judgmentsBytes = Buffer.concat([
				changed.value.judgmentsBytes,
				Buffer.from("\n"),
			]);
			expect(() => validate(changed)).toThrow("not bound");

			const partial = signedInput(directory);
			partial.trustPolicy.adjudicators[
				"independent-ko-judge"
			].independentOfEngines = ["naia"];
			expect(() => validate(partial)).toThrow("receipt content");

			const reused = signedInput(directory);
			reused.trustPolicy.adjudicators["second-identity"] = structuredClone(
				reused.trustPolicy.adjudicators["independent-ko-judge"],
			);
			expect(() => validate(reused)).toThrow("trust keys overlap");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("rejects profile drift, invalid timing, and missing receipts", () => {
		const directory = mkdtempSync(resolve(tmpdir(), "adjudication-evidence-"));
		try {
			const profile = signedInput(directory);
			profile.trustPolicy.adjudicators["independent-ko-judge"].profile = {
				kind: "human",
				nativeLanguages: ["en"],
			};
			expect(() => validate(profile)).toThrow("receipt content");

			const timing = signedInput(directory);
			timing.bundle.receipts[0].completedAt = "2026-08-18T23:59:59Z";
			expect(() => validate(timing)).toThrow("receipt content");

			const missing = signedInput(directory);
			missing.bundle.receipts = [];
			expect(() => validate(missing)).toThrow("do not cover every judge");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
