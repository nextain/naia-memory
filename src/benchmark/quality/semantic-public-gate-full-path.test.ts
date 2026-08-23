import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	BenchmarkDevelopmentExecutionEvidence,
	BenchmarkDevelopmentExecutionPlan,
} from "./benchmark-development-execution-evidence.js";
import {
	type BenchmarkDevelopmentObservation,
	benchmarkObservationSha256,
} from "./benchmark-selection-disclosure.js";
import {
	evidenceObjectSha256,
	evidenceSignaturePayload,
} from "./public-evidence-crypto.js";
import {
	type SemanticCompetitiveQualification,
	type SemanticQualificationSubjects,
	validateSemanticCompetitiveQualification,
} from "./semantic-competitive-qualification.js";
import { semanticConfigurationSha256 } from "./semantic-execution-evidence.js";
import { buildSemanticPilotLaunch } from "./semantic-pilot-launch.js";
import {
	writeAdjudicationFixture,
	writeExecutionFixture,
	writeFixture,
} from "./semantic-public-gate-full-path-core.test-support.js";
import {
	buildParticipantDelivery,
	writeRealTimestampFixture,
} from "./semantic-public-gate-full-path-crypto.test-support.js";
import {
	writeAnalysisPlanFixture,
	writePowerReviewFixture,
} from "./semantic-public-gate-full-path-pilot.test-support.js";
import { runSemanticPublicGateManifestCli } from "./semantic-public-gate-manifest-cli.js";
import { runSemanticPublicGateManifestGeneratorCli } from "./semantic-public-gate-manifest-generator-cli.js";
import { SEMANTIC_PUBLIC_GATE_ARTIFACT_NAMES } from "./semantic-public-gate-manifest.js";

const roots: string[] = [];
async function root(): Promise<string> {
	const path = await mkdtemp(
		join(tmpdir(), "naia-semantic-public-gate-full-path-"),
	);
	roots.push(path);
	return path;
}
function captureStdout(output: string[]): void {
	vi.spyOn(process.stdout, "write").mockImplementation((value) => {
		output.push(String(value));
		return true;
	});
}
afterEach(async () => {
	vi.restoreAllMocks();
	vi.doUnmock("./semantic-competitive-qualification-trust-anchor.js");
	vi.resetModules();
	await Promise.all(
		roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("semantic public gate CLI", () => {
	it("fails closed without an anchor and verifies a signed qualification with a pinned test anchor", async () => {
		const output: string[] = [];
		captureStdout(output);
		const directory = await root();
		const fixture = await writeFixture(directory);
		const power = await writePowerReviewFixture(
			directory,
			fixture.contract,
			true,
		);
		const analysisPlanPaths = await writeAnalysisPlanFixture(
			directory,
			fixture.contract,
			power.assumptionsSha256,
			"2099-01-04T00:00:00Z",
			"2099-01-04T00:01:00Z",
		);
		const analysisPlan = JSON.parse(
			await readFile(analysisPlanPaths[0] as string, "utf8"),
		);
		const tsa = await writeRealTimestampFixture(directory);
		const analysisPlanToken = await tsa.issue(
			evidenceObjectSha256(analysisPlan),
			"analysis-plan",
		);
		const analysisPlanTimestampEvidence = {
			schemaVersion:
				"naia-memory-rfc3161-digest-timestamp-evidence-v1" as const,
			artifactSha256: evidenceObjectSha256(analysisPlan),
			...analysisPlanToken,
		};
		const authorization = {
			schemaVersion:
				"naia-memory-semantic-confirmatory-execution-authorization-v1",
			authorizedAt: "2099-01-04T00:02:00.000Z",
			expiresAt: "2099-01-05T00:02:00.000Z",
		};
		const executionPaths = await writeExecutionFixture(
			directory,
			fixture.contract,
			{
				startedAt: "2099-01-05T00:00:00.000Z",
				completedAt: "2099-01-05T00:01:00.000Z",
				signedAt: "2099-01-05T00:02:00.000Z",
			},
			evidenceObjectSha256(analysisPlan),
			{
				confirmatoryAuthorizationSha256: evidenceObjectSha256(authorization),
				analysisPlanTimestampEvidenceSha256: evidenceObjectSha256(
					analysisPlanTimestampEvidence,
				),
				analysisPlanTimestampTrustPolicyIdentitySha256: "f".repeat(64),
			},
		);
		const adjudicationPaths = await writeAdjudicationFixture(
			directory,
			fixture.contract,
			executionPaths[0],
			undefined,
			"2099-01-06T00:00:00.000Z",
			"2099-01-06T00:01:00.000Z",
		);
		const planToken = await tsa.issue(
			evidenceObjectSha256(power.collectionPlan),
			"collection-plan",
		);
		const planEvidence = {
			schemaVersion: "naia-memory-rfc3161-timestamp-evidence-v1" as const,
			collectionPlanSha256: evidenceObjectSha256(power.collectionPlan),
			...planToken,
		};
		const launch = buildSemanticPilotLaunch({
			collectionPlan: power.collectionPlan,
			timestampEvidence: planEvidence,
			timestampTrustPolicy: tsa.trustPolicy,
		});
		const delivery = buildParticipantDelivery(
			power.collectionPlan,
			launch.receipt.receiptSha256,
			launch.receipt.timestampedAt,
		);
		const deliveryToken = await tsa.issue(
			delivery.bundle.bundleSha256,
			"delivery",
		);
		const deliveryEvidence = {
			schemaVersion:
				"naia-memory-rfc3161-digest-timestamp-evidence-v1" as const,
			artifactSha256: delivery.bundle.bundleSha256,
			...deliveryToken,
		};
		const extraPaths = [
			join(directory, "timestamp-evidence.json"),
			join(directory, "timestamp-trust-policy.json"),
			join(directory, "launch-receipt.json"),
			join(directory, "delivery-acknowledgements.json"),
			join(directory, "participant-trust-policy.json"),
			join(directory, "delivery-timestamp-evidence.json"),
			join(directory, "delivery-timestamp-trust-policy.json"),
		];
		await Promise.all([
			writeFile(extraPaths[0], JSON.stringify(planEvidence)),
			writeFile(extraPaths[1], JSON.stringify(tsa.trustPolicy)),
			writeFile(extraPaths[2], JSON.stringify(launch.receipt)),
			writeFile(extraPaths[3], JSON.stringify(delivery.bundle)),
			writeFile(extraPaths[4], JSON.stringify(delivery.trustPolicy)),
			writeFile(extraPaths[5], JSON.stringify(deliveryEvidence)),
			writeFile(extraPaths[6], JSON.stringify(tsa.trustPolicy)),
		]);
		const { privateKey: selectionPrivateKey, publicKey: selectionPublicKey } =
			generateKeyPairSync("ed25519");
		const selectedConfigurationSha256 = semanticConfigurationSha256({
			engine: "naia",
			executionSeed: "ignored-by-configuration-hash",
			topK: 5,
			endpoint: "https://provider.example/v1/",
			embeddingModel: "embedding-model",
			embeddingRevision: "embedding-revision",
			embeddingDimensions: 768,
			llmModel: "llm-model",
			authScheme: "bearer",
		});
		const candidates = [
			{
				id: "baseline",
				policySha256: "d".repeat(64),
				declaredAt: "2026-01-02T00:00:00Z",
			},
			{
				id: "selected",
				policySha256: selectedConfigurationSha256,
				declaredAt: "2026-01-02T00:00:00Z",
			},
		];
		const {
			privateKey: developmentAdministratorPrivateKey,
			publicKey: developmentAdministratorPublicKey,
		} = generateKeyPairSync("ed25519");
		const {
			privateKey: developmentExecutorPrivateKey,
			publicKey: developmentExecutorPublicKey,
		} = generateKeyPairSync("ed25519");
		const unsignedDevelopmentPlan = {
			schemaVersion:
				"naia-memory-benchmark-development-execution-plan-v1" as const,
			administrator: "development-plan-administrator",
			selectionRuleSha256: "a".repeat(64),
			confirmatoryDatasetSha256: evidenceObjectSha256(fixture.contract),
			candidates: candidates.map(({ id, policySha256 }) => ({
				id,
				policySha256,
			})),
			datasetSha256s: ["e".repeat(64), "f".repeat(64)],
			createdAt: "2026-01-01T00:00:00Z",
			signedAt: "2026-01-01T00:01:00Z",
			statement: "COMPLETE_DEVELOPMENT_MATRIX_FROZEN_BEFORE_EXECUTION" as const,
		};
		const developmentPlan: BenchmarkDevelopmentExecutionPlan = {
			...unsignedDevelopmentPlan,
			signatureBase64: sign(
				null,
				evidenceSignaturePayload(unsignedDevelopmentPlan),
				developmentAdministratorPrivateKey,
			).toString("base64"),
		};
		const developmentPlanToken = await tsa.issue(
			evidenceObjectSha256(developmentPlan),
			"development-plan",
		);
		const developmentRows = [
			["baseline", "e".repeat(64), 0.6],
			["selected", "e".repeat(64), 0.8],
			["baseline", "f".repeat(64), 0.7],
			["selected", "f".repeat(64), 0.9],
		] as const;
		const registrySequenceStartedAt = Date.now() + 8_000;
		const developmentReceipts = developmentRows.map(
			([candidateId, datasetSha256, primaryMetricValue], index) => {
				const unsignedReceipt = {
					schemaVersion:
						"naia-memory-benchmark-development-execution-receipt-v1" as const,
					executor: "development-matrix-executor",
					planSha256: evidenceObjectSha256(developmentPlan),
					candidateId,
					policySha256: candidates.find(({ id }) => id === candidateId)
						?.policySha256 as string,
					datasetSha256,
					primaryMetricValue,
					startedAt: new Date(
						registrySequenceStartedAt + index * 500,
					).toISOString(),
					finishedAt: new Date(
						registrySequenceStartedAt + index * 500 + 250,
					).toISOString(),
					signedAt: new Date(
						registrySequenceStartedAt + index * 500 + 400,
					).toISOString(),
					statement: "DEVELOPMENT_EXECUTION_CONFIRMED" as const,
				};
				return {
					...unsignedReceipt,
					signatureBase64: sign(
						null,
						evidenceSignaturePayload(unsignedReceipt),
						developmentExecutorPrivateKey,
					).toString("base64"),
				};
			},
		);
		const observations: BenchmarkDevelopmentObservation[] = [];
		for (const [index, receipt] of developmentReceipts.entries()) {
			observations.push({
				id: `observation-${index + 1}`,
				candidateId: receipt.candidateId,
				datasetSha256: receipt.datasetSha256,
				receiptSha256: evidenceObjectSha256(receipt),
				primaryMetricValue: receipt.primaryMetricValue,
				startedAt: receipt.startedAt,
				finishedAt: receipt.finishedAt,
				previousObservationSha256:
					index === 0
						? null
						: benchmarkObservationSha256(
								observations[index - 1] as BenchmarkDevelopmentObservation,
							),
			});
		}
		const developmentEvidence: BenchmarkDevelopmentExecutionEvidence = {
			schemaVersion: "naia-memory-benchmark-development-execution-evidence-v1",
			plan: developmentPlan,
			receipts: developmentReceipts,
		};
		const developmentTrustPolicy = {
			administratorPublicKeys: {
				"development-plan-administrator": developmentAdministratorPublicKey
					.export({ type: "spki", format: "pem" })
					.toString(),
			},
			executorPublicKeys: {
				"development-matrix-executor": developmentExecutorPublicKey
					.export({ type: "spki", format: "pem" })
					.toString(),
			},
		};
		const developmentTimestampEvidence = {
			schemaVersion:
				"naia-memory-rfc3161-digest-timestamp-evidence-v1" as const,
			artifactSha256: evidenceObjectSha256(developmentPlan),
			...developmentPlanToken,
		};
		const { privateKey: registrarPrivateKey, publicKey: registrarPublicKey } =
			generateKeyPairSync("ed25519");
		let previousRegistryEntrySha256: string | null = null;
		let registryOrdinal = 0;
		const registryRecords: Array<{
			entry: Record<string, unknown>;
			timestampEvidence: Record<string, unknown>;
		}> = [];
		const appendRegistryEntry = async (
			receipt: (typeof developmentReceipts)[number],
			event: "started" | "finished",
		) => {
			registryOrdinal += 1;
			const eventTime = new Date(
				Math.floor(Date.now() / 1000) * 1000 - 1_000,
			).toISOString();
			const unsignedEntry = {
				schemaVersion:
					"naia-memory-benchmark-development-execution-registry-entry-v1" as const,
				registrar: "independent-execution-registrar",
				ordinal: registryOrdinal,
				previousEntrySha256: previousRegistryEntrySha256,
				planSha256: evidenceObjectSha256(developmentPlan),
				event,
				candidateId: receipt.candidateId,
				policySha256: receipt.policySha256,
				datasetSha256: receipt.datasetSha256,
				executor: receipt.executor,
				receiptSha256:
					event === "finished" ? evidenceObjectSha256(receipt) : null,
				declaredAt: eventTime,
				signedAt: eventTime,
				statement: "DEVELOPMENT_EXECUTION_REGISTRY_EVENT" as const,
			};
			const entry = {
				...unsignedEntry,
				signatureBase64: sign(
					null,
					evidenceSignaturePayload(unsignedEntry),
					registrarPrivateKey,
				).toString("base64"),
			};
			previousRegistryEntrySha256 = evidenceObjectSha256(entry);
			const token = await tsa.issue(
				previousRegistryEntrySha256,
				`development-registry-${registryOrdinal}`,
			);
			registryRecords.push({
				entry,
				timestampEvidence: {
					schemaVersion: "naia-memory-rfc3161-digest-timestamp-evidence-v1",
					artifactSha256: previousRegistryEntrySha256,
					...token,
				},
			});
		};
		for (const receipt of developmentReceipts)
			await appendRegistryEntry(receipt, "started");
		await new Promise((resolve) => setTimeout(resolve, 13_000));
		for (const receipt of developmentReceipts)
			await appendRegistryEntry(receipt, "finished");
		const registryEvidence = {
			schemaVersion:
				"naia-memory-benchmark-development-execution-registry-evidence-v1",
			records: registryRecords,
		};
		const registryTrustPolicy = {
			registrarPublicKeys: {
				"independent-execution-registrar": registrarPublicKey
					.export({ type: "spki", format: "pem" })
					.toString(),
			},
		};
		const unsignedSelection = {
			schemaVersion: "naia-memory-benchmark-selection-disclosure-v1" as const,
			auditor: "independent-selection-auditor",
			contractSha256: evidenceObjectSha256(fixture.contract),
			analysisPlanSha256: evidenceObjectSha256(analysisPlan),
			confirmatoryDatasetSha256: evidenceObjectSha256(fixture.contract),
			candidates,
			developmentObservations: observations,
			selectedCandidateId: "selected",
			selectionRule: "frozen-rule-applied-to-development-only" as const,
			selectionAggregation:
				"unweighted-mean-over-identical-development-datasets" as const,
			selectionObjective: "maximize" as const,
			selectionRuleSha256: "a".repeat(64),
			selectedAt: "2099-01-04T02:00:00Z",
			signedAt: "2099-01-04T03:00:00Z",
			statement:
				"ALL_KNOWN_SELECTION_TRIALS_DISCLOSED_BEFORE_CONFIRMATORY_RUN" as const,
		};
		const selectionPaths = [
			join(directory, "selection-disclosure.json"),
			join(directory, "selection-disclosure-trust-policy.json"),
		];
		await Promise.all([
			writeFile(
				selectionPaths[0],
				JSON.stringify({
					...unsignedSelection,
					signatureBase64: sign(
						null,
						evidenceSignaturePayload(unsignedSelection),
						selectionPrivateKey,
					).toString("base64"),
				}),
			),
			writeFile(
				selectionPaths[1],
				JSON.stringify({
					auditorPublicKeys: {
						"independent-selection-auditor": selectionPublicKey
							.export({ type: "spki", format: "pem" })
							.toString(),
					},
				}),
			),
		]);
		const developmentPaths = [
			join(directory, "development-execution-evidence.json"),
			join(directory, "development-execution-trust-policy.json"),
			join(directory, "development-plan-timestamp-evidence.json"),
			join(directory, "development-plan-timestamp-trust-policy.json"),
			join(directory, "development-execution-registry.json"),
			join(directory, "development-execution-registry-trust-policy.json"),
		];
		await Promise.all([
			writeFile(developmentPaths[0], JSON.stringify(developmentEvidence)),
			writeFile(developmentPaths[1], JSON.stringify(developmentTrustPolicy)),
			writeFile(
				developmentPaths[2],
				JSON.stringify(developmentTimestampEvidence),
			),
			writeFile(developmentPaths[3], JSON.stringify(tsa.trustPolicy)),
			writeFile(developmentPaths[4], JSON.stringify(registryEvidence)),
			writeFile(developmentPaths[5], JSON.stringify(registryTrustPolicy)),
		]);
		const qualificationPaths = [
			join(directory, "confirmatory-authorization.json"),
			join(directory, "analysis-plan-timestamp-evidence.json"),
			join(directory, "competitive-qualification.json"),
		];
		const { privateKey: gatePrivateKey, publicKey: gatePublicKey } =
			generateKeyPairSync("ed25519");
		const qualificationTrustAnchor = {
			deploymentId: "fixture-deployment",
			trustStoreSha256: "a".repeat(64),
			gatePublicKeys: {
				"fixture-gate": gatePublicKey
					.export({ type: "spki", format: "pem" })
					.toString(),
			},
		};
		const qualificationSubjects: SemanticQualificationSubjects = {
			contract: fixture.contract,
			campaign: JSON.parse(await readFile(executionPaths[0], "utf8")),
			analysisPlan,
			authorization,
			timestampEvidence: analysisPlanTimestampEvidence,
			executionEvidence: JSON.parse(await readFile(executionPaths[1], "utf8")),
			adjudicationEvidence: JSON.parse(
				await readFile(adjudicationPaths[3], "utf8"),
			),
		};
		const unsignedQualification = {
			schemaVersion:
				"naia-memory-semantic-competitive-qualification-v1" as const,
			verdict: "qualified" as const,
			deploymentId: qualificationTrustAnchor.deploymentId,
			trustStoreSha256: qualificationTrustAnchor.trustStoreSha256,
			gateKeyId: "fixture-gate",
			subjects: Object.fromEntries(
				Object.entries(qualificationSubjects).map(([subject, value]) => [
					`${subject}Sha256`,
					evidenceObjectSha256(value),
				]),
			),
			authorizationWindow: {
				authorizedAt: authorization.authorizedAt,
				expiresAt: authorization.expiresAt,
			},
			issuedAt: "2099-01-05T00:02:00.000Z",
			statement:
				"COMPETITIVE_CANDIDATE_VERIFIED_AGAINST_DEPLOYMENT_TRUST_STORE" as const,
		};
		const qualification: SemanticCompetitiveQualification = {
			...unsignedQualification,
			subjects:
				unsignedQualification.subjects as SemanticCompetitiveQualification["subjects"],
			signatureBase64: sign(
				null,
				evidenceSignaturePayload(unsignedQualification),
				gatePrivateKey,
			).toString("base64"),
		};
		await Promise.all([
			writeFile(qualificationPaths[0], JSON.stringify(authorization)),
			writeFile(
				qualificationPaths[1],
				JSON.stringify(analysisPlanTimestampEvidence),
			),
			writeFile(qualificationPaths[2], JSON.stringify(qualification)),
		]);

		const gateArgs = [
			...fixture.paths,
			...executionPaths,
			...adjudicationPaths,
			...analysisPlanPaths,
			...power.paths,
			...extraPaths,
			...selectionPaths,
			...developmentPaths,
			...qualificationPaths,
		];
		const filePaths = gateArgs.filter((_, index) => index !== 11);
		const artifacts = Object.fromEntries(
			SEMANTIC_PUBLIC_GATE_ARTIFACT_NAMES.map((name, index) => [
				name,
				basename(filePaths[index] as string),
			]),
		);
		const draftPath = join(directory, "public-gate-manifest-draft.json");
		await writeFile(
			draftPath,
			JSON.stringify({
				schemaVersion: "naia-memory-semantic-public-gate-manifest-draft-v5",
				blindingSeed: gateArgs[11],
				artifacts,
			}),
		);
		const manifestPath = join(directory, "public-gate-manifest.json");
		expect(
			await runSemanticPublicGateManifestGeneratorCli([
				draftPath,
				manifestPath,
			]),
		).toBe(0);
		output.pop();

		expect(await runSemanticPublicGateManifestCli([manifestPath])).toBe(1);
		const result = JSON.parse(output.pop() ?? "{}");
		expect(result).toEqual({
			promotable: false,
			failure:
				"semantic competitive qualification trust anchor is not provisioned",
		});
		expect(
			validateSemanticCompetitiveQualification({
				qualification,
				trustAnchor: qualificationTrustAnchor,
				subjects: qualificationSubjects,
				executionReceipts: (
					qualificationSubjects.executionEvidence as {
						receipts: Array<{ startedAt: string; completedAt: string }>;
					}
				).receipts,
			}),
		).toMatchObject({
			competitiveQualificationVerified: true,
			deploymentId: qualificationTrustAnchor.deploymentId,
			gateKeyId: "fixture-gate",
		});

		vi.resetModules();
		vi.doMock("./semantic-competitive-qualification-trust-anchor.js", () => ({
			SEMANTIC_COMPETITIVE_QUALIFICATION_TRUST_ANCHOR: qualificationTrustAnchor,
		}));
		const { runSemanticPublicGateManifestCli: runWithTrustAnchor } =
			await import("./semantic-public-gate-manifest-cli.js");
		expect(await runWithTrustAnchor([manifestPath])).toBe(1);
		const qualifiedResult = JSON.parse(output.pop() ?? "{}");
		expect(qualifiedResult.promotable).toBe(false);
		expect(qualifiedResult.failure).toMatch(
			/^pilot review, prior-assignment timing/u,
		);
		expect(qualifiedResult.failure).toContain(
			"competitive thresholds, simultaneous uncertainty, latency, and released-commit evidence are not evaluated by this gate",
		);
	}, 45_000);
});
