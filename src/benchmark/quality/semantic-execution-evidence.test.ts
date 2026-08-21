import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	evidenceObjectSha256,
	evidenceSignaturePayload,
} from "./public-evidence-crypto.js";
import { semanticBlindFixture } from "./semantic-blind-packet-fixture.js";
import {
	type SemanticExecutionEvidenceBundle,
	semanticEngineRunSetSha256,
	validateSemanticExecutionEvidence,
} from "./semantic-execution-evidence.js";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "semantic-execution-"));
	roots.push(directory);
	const source = semanticBlindFixture(directory, {
		engines: ["hindsight", "mem0", "naia"],
		schemaVersion: "naia-memory-semantic-campaign-v3",
	});
	source.contract.familySplitFreeze = {
		frozenAt: "2026-01-01T00:00:00Z",
		digest: `sha256:${"a".repeat(64)}`,
	};
	const campaignBytes = await readFile(source.campaignPath);
	const campaignSha256 = (await import("node:crypto"))
		.createHash("sha256")
		.update(campaignBytes)
		.digest("hex");
	const contractSha256 = evidenceObjectSha256(source.contract);
	const executorPublicKeys: Record<string, string> = {};
	const receipts = source.campaign.disclosure.engines.map((engine) => {
		const executor = `executor-${engine}`;
		const { privateKey, publicKey } = generateKeyPairSync("ed25519");
		executorPublicKeys[executor] = publicKey
			.export({ type: "spki", format: "pem" })
			.toString();
		const unsigned = {
			schemaVersion: "naia-memory-semantic-execution-receipt-v1" as const,
			executor,
			engine,
			contractSha256,
			campaignSha256,
			campaignRunSetSha256: semanticEngineRunSetSha256(source.campaign, engine),
			implementationRevision: "b".repeat(40),
			workspaceClean: true as const,
			implementationArtifactSha256: "c".repeat(64),
			configurationSha256: "d".repeat(64),
			startedAt: "2026-01-02T00:00:00Z",
			completedAt: "2026-01-02T00:01:00Z",
			elapsedMs: 60_000,
			estimatedCostUsd: null,
			costDisclosure: "unknown" as const,
			signedAt: "2026-01-02T00:02:00Z",
			statement: "EXECUTION_ARTIFACTS_CONFIRMED" as const,
		};
		return {
			...unsigned,
			signatureBase64: sign(
				null,
				evidenceSignaturePayload(unsigned),
				privateKey,
			).toString("base64"),
		};
	});
	const bundle: SemanticExecutionEvidenceBundle = {
		schemaVersion: "naia-memory-semantic-execution-evidence-bundle-v1",
		contractSha256,
		campaignSha256,
		receipts,
	};
	return {
		directory,
		...source,
		campaignBytes,
		bundle,
		trustPolicy: { executorPublicKeys },
	};
}

describe("semantic execution evidence", () => {
	it("qualifies complete signed execution artifacts without claiming cost completeness", async () => {
		const value = await fixture();
		expect(
			validateSemanticExecutionEvidence({
				contract: value.contract,
				campaign: value.campaign,
				campaignBytes: value.campaignBytes,
				campaignDirectory: value.directory,
				bundle: value.bundle,
				trustPolicy: value.trustPolicy,
			}),
		).toEqual({ engineCount: 3, runCount: 9, costComplete: false });
	});

	it("rejects forged signatures and incomplete engine coverage", async () => {
		const forged = await fixture();
		const firstReceipt = forged.bundle.receipts[0];
		if (!firstReceipt) throw new Error("fixture receipt is missing");
		firstReceipt.signatureBase64 = Buffer.alloc(64).toString("base64");
		expect(() =>
			validateSemanticExecutionEvidence({
				contract: forged.contract,
				campaign: forged.campaign,
				campaignBytes: forged.campaignBytes,
				campaignDirectory: forged.directory,
				bundle: forged.bundle,
				trustPolicy: forged.trustPolicy,
			}),
		).toThrow("signature is untrusted or invalid");

		const incomplete = await fixture();
		incomplete.bundle.receipts.pop();
		expect(() =>
			validateSemanticExecutionEvidence({
				contract: incomplete.contract,
				campaign: incomplete.campaign,
				campaignBytes: incomplete.campaignBytes,
				campaignDirectory: incomplete.directory,
				bundle: incomplete.bundle,
				trustPolicy: incomplete.trustPolicy,
			}),
		).toThrow("do not cover every engine");
	});

	it("rejects a campaign artifact symlink before reading its target", async () => {
		const value = await fixture();
		const outputFile = value.campaign.runs[0]?.outputFile;
		if (!outputFile) throw new Error("fixture campaign run is missing");
		const artifactPath = join(value.directory, outputFile);
		await rm(artifactPath);
		await symlink("/etc/hosts", artifactPath);
		expect(() =>
			validateSemanticExecutionEvidence({
				contract: value.contract,
				campaign: value.campaign,
				campaignBytes: value.campaignBytes,
				campaignDirectory: value.directory,
				bundle: value.bundle,
				trustPolicy: value.trustPolicy,
			}),
		).toThrow("artifact is not a regular file");
	});
});
