import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type BenchmarkDevelopmentObservation,
	benchmarkObservationSha256,
} from "./benchmark-selection-disclosure.js";
import {
	evidenceObjectSha256,
	evidenceSignaturePayload,
} from "./public-evidence-crypto.js";
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
	await Promise.all(
		roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("semantic public gate CLI", () => {
	it("verifies the complete 28-artifact path with selection history, real signatures, and RFC 3161 tokens", async () => {
		const output: string[] = [];
		captureStdout(output);
		const directory = await root();
		const fixture = await writeFixture(directory);
		const executionPaths = await writeExecutionFixture(
			directory,
			fixture.contract,
			{
				startedAt: "2099-01-05T00:00:00Z",
				completedAt: "2099-01-05T00:01:00Z",
				signedAt: "2099-01-05T00:02:00Z",
			},
		);
		const adjudicationPaths = await writeAdjudicationFixture(
			directory,
			fixture.contract,
			executionPaths[0],
			undefined,
			"2099-01-06T00:00:00Z",
			"2099-01-06T00:01:00Z",
		);
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
		const candidates = [
			{
				id: "baseline",
				policySha256: "d".repeat(64),
				declaredAt: "2099-01-02T00:00:00Z",
			},
			{
				id: "selected",
				policySha256: "c".repeat(64),
				declaredAt: "2099-01-02T00:00:00Z",
			},
		];
		const observations: BenchmarkDevelopmentObservation[] = [];
		for (const [index, [candidateId, datasetSha256, metric]] of [
			["baseline", "e".repeat(64), 0.6],
			["selected", "e".repeat(64), 0.8],
			["baseline", "f".repeat(64), 0.7],
			["selected", "f".repeat(64), 0.9],
		].entries()) {
			observations.push({
				id: `observation-${index + 1}`,
				candidateId: candidateId as string,
				datasetSha256: datasetSha256 as string,
				receiptSha256: (index + 1).toString(16).repeat(64),
				primaryMetricValue: metric as number,
				startedAt: `2099-01-03T0${index}:00:00Z`,
				finishedAt: `2099-01-03T0${index}:30:00Z`,
				previousObservationSha256:
					index === 0
						? null
						: benchmarkObservationSha256(
								observations[index - 1] as BenchmarkDevelopmentObservation,
							),
			});
		}
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

		const gateArgs = [
			...fixture.paths,
			...executionPaths,
			...adjudicationPaths,
			...analysisPlanPaths,
			...power.paths,
			...extraPaths,
			...selectionPaths,
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
				schemaVersion: "naia-memory-semantic-public-gate-manifest-draft-v2",
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
		expect(result).toMatchObject({
			trustedTimestampVerified: true,
			priorAssignmentTimingVerified: true,
			launchReceiptInternalConsistencyVerified: true,
			participantDeliveryAcknowledgementSignaturesVerified: true,
			deliveryBundleTrustedTimestampVerified: true,
			selectionHistoryQualified: true,
			selectionDisclosureInternallyConsistent: true,
			developmentObservationReceiptsExternallyVerified: false,
			selectionHistoryCompletenessExternallyVerified: false,
			candidateCount: 2,
			developmentObservationCount: 4,
			selectedPolicySha256: "c".repeat(64),
			promotable: false,
		});
		expect(result.failure).toContain(
			"trusted prior existence of the complete acknowledgement bundle",
		);
		expect(result.failure).toContain(
			"development observation receipts and selection-history completeness are not externally verified",
		);
	}, 30_000);
});
