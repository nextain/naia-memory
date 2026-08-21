import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import { buildSemanticPilotLaunch } from "./semantic-pilot-launch.js";
import { runSemanticPublicGateCli } from "./semantic-public-gate-cli.js";
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
	it("verifies the complete 26-artifact path with real signatures and RFC 3161 tokens", async () => {
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

		expect(
			await runSemanticPublicGateCli([
				...fixture.paths,
				...executionPaths,
				...adjudicationPaths,
				...analysisPlanPaths,
				...power.paths,
				...extraPaths,
			]),
		).toBe(1);
		const result = JSON.parse(output.pop() ?? "{}");
		expect(result).toMatchObject({
			trustedTimestampVerified: true,
			priorAssignmentTimingVerified: true,
			launchReceiptInternalConsistencyVerified: true,
			participantDeliveryAcknowledgementSignaturesVerified: true,
			deliveryBundleTrustedTimestampVerified: true,
			promotable: false,
		});
		expect(result.failure).toContain(
			"trusted prior existence of the complete acknowledgement bundle",
		);
	}, 30_000);
});
