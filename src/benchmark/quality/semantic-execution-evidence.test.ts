import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	evidenceObjectSha256,
	evidenceSignaturePayload,
} from "./public-evidence-crypto.js";
import { semanticBlindFixture } from "./semantic-blind-packet-fixture.js";
import { SUPPORTED_SEMANTIC_ENGINES } from "./semantic-campaign-cli.js";
import {
	type SemanticExecutionEvidenceBundle,
	semanticConfigurationSha256,
	semanticEngineRunSetSha256,
	validateSemanticConfigurationParity,
	validateSemanticExecutionEvidence,
} from "./semantic-execution-evidence.js";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

async function fixture(
	options: { competitive?: boolean; mismatch?: boolean } = {},
) {
	const directory = await mkdtemp(join(tmpdir(), "semantic-execution-"));
	roots.push(directory);
	const source = semanticBlindFixture(directory, {
		engines: [...SUPPORTED_SEMANTIC_ENGINES],
		schemaVersion: "naia-memory-semantic-campaign-v3",
	});
	source.contract.familySplitFreeze = {
		frozenAt: "2026-01-01T00:00:00Z",
		digest: `sha256:${"a".repeat(64)}`,
	};
	const configurationHashes = new Map<string, string>();
	if (options.competitive) {
		const campaign = source.campaign as typeof source.campaign & {
			schemaVersion: string;
			disclosure: Record<string, unknown>;
		};
		campaign.schemaVersion = "naia-memory-semantic-campaign-v5";
		Object.assign(campaign.disclosure, {
			eligibility: "competitive-candidate",
			analysisPlanSha256: "1".repeat(64),
			confirmatoryAuthorizationSha256: "2".repeat(64),
			analysisPlanTimestampEvidenceSha256: "3".repeat(64),
			analysisPlanTimestampTrustPolicyIdentitySha256: "4".repeat(64),
			claimScope: "declared-multi-class-competitive-report-v1",
			comparisonLanes: {
				directLifecycle: ["hindsight", "mem0"],
				nativeTemporalCharacterization: ["graphiti-historical"],
				agentManagedCharacterization: ["letta"],
				productIntegrationDiagnostic: ["graphiti"],
			},
			crossLaneAggregation: "prohibited",
		});
		for (const run of campaign.runs) {
			const path = join(directory, run.outputFile);
			const artifact = JSON.parse(await readFile(path, "utf8"));
			Object.assign(artifact.disclosure, {
				endpoint: "https://provider.example/v1/",
				...(run.engine === "naia" || run.engine === "mem0"
					? {
							embeddingModel: "embedding-model",
							embeddingRevision: "embedding-revision",
							embeddingDimensions: 768,
							llmModel: "llm-model",
							authScheme: "bearer",
						}
					: run.engine === "graphiti" || run.engine === "graphiti-historical"
						? {
								providerPolicy: "engine-server-native-configuration-v1",
								graphitiRuntime: {
									revision: "a".repeat(40),
									imageDigest: `sha256:${"b".repeat(64)}`,
									coreVersion: "1.0.0",
									llmModel: "llm-model",
									embeddingModel: "embedding-model",
								},
							}
						: run.engine === "hindsight"
							? {
									providerPolicy: "engine-server-native-configuration-v1",
									hindsightRuntime: {
										version: "1.0.0",
										imageDigest: `sha256:${"c".repeat(64)}`,
										llmProvider: "provider",
										llmModel: "llm-model",
									},
								}
							: {
									providerPolicy: "engine-server-native-configuration-v1",
									lettaRuntime: {
										version: "1.0.0",
										imageDigest: `sha256:${"d".repeat(64)}`,
										llmModel: "llm-model",
										embeddingModel: "embedding-model",
										embeddingDimensions: 768,
									},
								}),
			});
			configurationHashes.set(
				run.engine,
				semanticConfigurationSha256(artifact.disclosure),
			);
			const bytes = JSON.stringify(artifact);
			await writeFile(path, bytes);
			run.artifactSha256 = (await import("node:crypto"))
				.createHash("sha256")
				.update(bytes)
				.digest("hex");
		}
		await writeFile(source.campaignPath, JSON.stringify(campaign));
	}
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
			configurationSha256:
				options.competitive && !(options.mismatch && engine === "naia")
					? (configurationHashes.get(engine) as string)
					: "d".repeat(64),
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
		campaign: source.campaign,
		campaignBytes,
		bundle,
		trustPolicy: { executorPublicKeys },
	};
}

describe("semantic execution evidence", () => {
	it("verifies stable direct-comparator provider configuration", () => {
		const shared = {
			topK: 5,
			embeddingModel: "embedding-model",
			embeddingRevision: "embedding-revision",
			embeddingDimensions: 768,
			llmModel: "llm-model",
			authScheme: "bearer",
			endpoint: "https://provider.example/v1/",
		};
		expect(() =>
			validateSemanticConfigurationParity([
				{ ...shared, engine: "naia", executionSeed: "naia-1" },
				{ ...shared, engine: "naia", executionSeed: "naia-2" },
				{ ...shared, engine: "mem0", executionSeed: "mem0-1" },
				{ ...shared, engine: "mem0", executionSeed: "mem0-2" },
			]),
		).not.toThrow();
	});

	it("rejects missing disclosures, repetition drift, and favorable provider asymmetry", () => {
		const shared = {
			topK: 5,
			embeddingModel: "embedding-model",
			embeddingRevision: "embedding-revision",
			embeddingDimensions: 768,
			llmModel: "llm-model",
			authScheme: "bearer",
			endpoint: "https://provider.example/v1/",
		};
		expect(() =>
			validateSemanticConfigurationParity([
				{ ...shared, engine: "naia", executionSeed: "naia" },
				{
					...shared,
					engine: "mem0",
					executionSeed: "mem0",
					llmModel: "weaker-model",
				},
			]),
		).toThrow("provider parity mismatch");
		expect(() =>
			validateSemanticConfigurationParity([
				{ ...shared, engine: "naia", executionSeed: "one" },
				{
					...shared,
					engine: "naia",
					executionSeed: "two",
					embeddingDimensions: 384,
				},
			]),
		).toThrow("drifted across repetitions");
		expect(() =>
			validateSemanticConfigurationParity([
				{
					engine: "hindsight",
					executionSeed: "hindsight",
					topK: 5,
					providerPolicy: "engine-server-native-configuration-v1",
					endpoint: "http://127.0.0.1:18888/",
				},
			]),
		).toThrow("hindsight/hindsightRuntime");
	});

	it("requires immutable server images and identical Graphiti lane runtimes", () => {
		const runtime = {
			revision: "a".repeat(40),
			imageDigest: `sha256:${"b".repeat(64)}`,
			coreVersion: "1.0.0",
			llmModel: "llm-model",
			embeddingModel: "embedding-model",
		};
		expect(() =>
			validateSemanticConfigurationParity([
				{
					engine: "graphiti",
					executionSeed: "current",
					providerPolicy: "engine-server-native-configuration-v1",
					endpoint: "http://127.0.0.1:8000/",
					graphitiRuntime: runtime,
				},
				{
					engine: "graphiti-historical",
					executionSeed: "historical",
					providerPolicy: "engine-server-native-configuration-v1",
					endpoint: "http://127.0.0.1:8000/",
					graphitiRuntime: { ...runtime, coreVersion: "2.0.0" },
				},
			]),
		).toThrow("lane runtime parity mismatch");
	});

	it("rejects unsafe endpoint disclosures", () => {
		expect(() =>
			validateSemanticConfigurationParity([
				{
					engine: "naia",
					executionSeed: "seed",
					topK: 5,
					embeddingModel: "embedding-model",
					embeddingRevision: "embedding-revision",
					embeddingDimensions: 768,
					llmModel: "llm-model",
					authScheme: "bearer",
					endpoint: "https://secret@example.test/v1/?key=secret",
				},
			]),
		).toThrow("endpoint disclosure is unsafe");
	});

	it("canonically binds receipts to disclosed configuration", () => {
		const disclosure = {
			engine: "naia",
			executionSeed: "one",
			topK: 5,
			embeddingModel: "embedding-model",
		};
		expect(semanticConfigurationSha256(disclosure)).toBe(
			semanticConfigurationSha256({ ...disclosure, executionSeed: "two" }),
		);
		expect(semanticConfigurationSha256(disclosure)).not.toBe(
			semanticConfigurationSha256({
				...disclosure,
				embeddingModel: "other-model",
			}),
		);
	});

	it("rejects a validly signed receipt whose configuration hash differs from the raw disclosure", async () => {
		const value = await fixture({ competitive: true, mismatch: true });
		expect(() =>
			validateSemanticExecutionEvidence({
				contract: value.contract,
				campaign: value.campaign,
				campaignBytes: value.campaignBytes,
				campaignDirectory: value.directory,
				bundle: value.bundle,
				trustPolicy: value.trustPolicy,
			}),
		).toThrow("semantic execution receipt content is invalid");
	});

	it("accepts validly signed receipts bound to every competitive configuration", async () => {
		const value = await fixture({ competitive: true });
		expect(
			validateSemanticExecutionEvidence({
				contract: value.contract,
				campaign: value.campaign,
				campaignBytes: value.campaignBytes,
				campaignDirectory: value.directory,
				bundle: value.bundle,
				trustPolicy: value.trustPolicy,
			}),
		).toMatchObject({ engineCount: SUPPORTED_SEMANTIC_ENGINES.length });
	});

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
		).toEqual({ engineCount: 6, runCount: 36, costComplete: false });
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

	it("rejects an output path that differs from the deterministic campaign plan", async () => {
		const value = await fixture();
		const firstRun = value.campaign.runs[0];
		if (!firstRun) throw new Error("fixture campaign run is missing");
		firstRun.outputFile = "../outside.json";
		expect(() =>
			validateSemanticExecutionEvidence({
				contract: value.contract,
				campaign: value.campaign,
				campaignBytes: value.campaignBytes,
				campaignDirectory: value.directory,
				bundle: value.bundle,
				trustPolicy: value.trustPolicy,
			}),
		).toThrow("campaign plan is invalid");
	});

	it("rejects a v4 competitive campaign without a preregistered plan hash", async () => {
		const value = await fixture();
		const campaign = value.campaign as unknown as Record<string, unknown>;
		campaign.schemaVersion = "naia-memory-semantic-campaign-v4";
		const disclosure = campaign.disclosure as Record<string, unknown>;
		disclosure.claimScope = "direct-lifecycle-competitive-report-v1";
		disclosure.comparisonLanes = {
			directLifecycle: ["hindsight", "mem0"],
			nativeTemporalCharacterization: [],
			agentManagedCharacterization: [],
			productIntegrationDiagnostic: [],
		};
		disclosure.crossLaneAggregation = "prohibited";
		disclosure.analysisPlanSha256 = null;
		expect(() =>
			validateSemanticExecutionEvidence({
				contract: value.contract,
				campaign,
				campaignBytes: value.campaignBytes,
				campaignDirectory: value.directory,
				bundle: value.bundle,
				trustPolicy: value.trustPolicy,
			}),
		).toThrow("semantic execution campaign shape is invalid");
		disclosure.analysisPlanSha256 = "a".repeat(64);
		disclosure.comparisonLanes = {};
		expect(() =>
			validateSemanticExecutionEvidence({
				contract: value.contract,
				campaign,
				campaignBytes: value.campaignBytes,
				campaignDirectory: value.directory,
				bundle: value.bundle,
				trustPolicy: value.trustPolicy,
			}),
		).toThrow("semantic execution campaign shape is invalid");
	});
});
