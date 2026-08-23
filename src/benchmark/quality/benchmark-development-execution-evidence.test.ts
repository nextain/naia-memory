import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	type BenchmarkDevelopmentExecutionEvidence,
	type BenchmarkDevelopmentExecutionPlan,
	validateBenchmarkDevelopmentExecutionEvidence,
} from "./benchmark-development-execution-evidence.js";
import {
	evidenceObjectSha256,
	evidenceSignaturePayload,
} from "./public-evidence-crypto.js";

function fixture() {
	const administrator = generateKeyPairSync("ed25519");
	const executor = generateKeyPairSync("ed25519");
	const unsignedPlan = {
		schemaVersion:
			"naia-memory-benchmark-development-execution-plan-v1" as const,
		administrator: "plan-admin",
		selectionRuleSha256: "a".repeat(64),
		confirmatoryDatasetSha256: "b".repeat(64),
		candidates: [
			{ id: "baseline", policySha256: "c".repeat(64) },
			{ id: "selected", policySha256: "d".repeat(64) },
		],
		datasetSha256s: ["e".repeat(64), "f".repeat(64)],
		createdAt: "2026-01-01T00:00:00Z",
		signedAt: "2026-01-01T00:01:00Z",
		statement: "COMPLETE_DEVELOPMENT_MATRIX_FROZEN_BEFORE_EXECUTION" as const,
	};
	const plan: BenchmarkDevelopmentExecutionPlan = {
		...unsignedPlan,
		signatureBase64: sign(
			null,
			evidenceSignaturePayload(unsignedPlan),
			administrator.privateKey,
		).toString("base64"),
	};
	const planSha256 = evidenceObjectSha256(plan);
	const receipts = plan.candidates.flatMap((candidate, candidateIndex) =>
		plan.datasetSha256s.map((datasetSha256, datasetIndex) => {
			const index = candidateIndex * 2 + datasetIndex;
			const unsigned = {
				schemaVersion:
					"naia-memory-benchmark-development-execution-receipt-v1" as const,
				executor: "development-executor",
				planSha256,
				candidateId: candidate.id,
				policySha256: candidate.policySha256,
				datasetSha256,
				primaryMetricValue: 0.5 + index / 10,
				startedAt: `2026-01-02T0${index}:00:00Z`,
				finishedAt: `2026-01-02T0${index}:30:00Z`,
				signedAt: `2026-01-02T0${index}:31:00Z`,
				statement: "DEVELOPMENT_EXECUTION_CONFIRMED" as const,
			};
			return {
				...unsigned,
				signatureBase64: sign(
					null,
					evidenceSignaturePayload(unsigned),
					executor.privateKey,
				).toString("base64"),
			};
		}),
	);
	const evidence: BenchmarkDevelopmentExecutionEvidence = {
		schemaVersion: "naia-memory-benchmark-development-execution-evidence-v1",
		plan,
		receipts,
	};
	return {
		evidence,
		trustPolicy: {
			administratorPublicKeys: {
				"plan-admin": administrator.publicKey
					.export({ type: "spki", format: "pem" })
					.toString(),
			},
			executorPublicKeys: {
				"development-executor": executor.publicKey
					.export({ type: "spki", format: "pem" })
					.toString(),
			},
		},
	};
}

function validate(current: ReturnType<typeof fixture>) {
	return validateBenchmarkDevelopmentExecutionEvidence({
		...current,
		expectedSelectionRuleSha256: "a".repeat(64),
		expectedConfirmatoryDatasetSha256: "b".repeat(64),
		trustedPlanTimestampedAt: "2026-01-01T00:02:00Z",
		expectedObservations: current.evidence.receipts.map((receipt, index) => ({
			id: `observation-${index + 1}`,
			candidateId: receipt.candidateId,
			datasetSha256: receipt.datasetSha256,
			receiptSha256: evidenceObjectSha256(receipt),
			primaryMetricValue: receipt.primaryMetricValue,
			startedAt: receipt.startedAt,
			finishedAt: receipt.finishedAt,
			previousObservationSha256: null,
		})),
	});
}

describe("benchmark development execution evidence", () => {
	it("verifies a complete timestamped candidate-by-dataset matrix", () => {
		expect(validate(fixture())).toMatchObject({
			developmentObservationReceiptsExternallyVerified: true,
			timestampedDevelopmentMatrixCoverageVerified: true,
			selectionHistoryCompletenessExternallyVerified: false,
			developmentExecutionPlanTrustedTimestampVerified: true,
			receiptCount: 4,
		});
	});

	it("rejects a disclosure observation that does not exactly match its receipt", () => {
		const current = fixture();
		const observations = current.evidence.receipts.map((receipt, index) => ({
			id: `observation-${index + 1}`,
			candidateId: receipt.candidateId,
			datasetSha256: receipt.datasetSha256,
			receiptSha256: evidenceObjectSha256(receipt),
			primaryMetricValue: receipt.primaryMetricValue,
			startedAt: receipt.startedAt,
			finishedAt: receipt.finishedAt,
			previousObservationSha256: null,
		}));
		const first = observations[0];
		if (!first) throw new Error("fixture observation is missing");
		first.primaryMetricValue += 0.1;
		expect(() =>
			validateBenchmarkDevelopmentExecutionEvidence({
				...current,
				expectedSelectionRuleSha256: "a".repeat(64),
				expectedConfirmatoryDatasetSha256: "b".repeat(64),
				trustedPlanTimestampedAt: "2026-01-01T00:02:00Z",
				expectedObservations: observations,
			}),
		).toThrow("disclosure observation binding is invalid");
	});

	it("rejects omitted, duplicated, and mutated receipts", () => {
		const omitted = fixture();
		omitted.evidence.receipts.pop();
		expect(() => validate(omitted)).toThrow("coverage is incomplete");

		const duplicated = fixture();
		const firstReceipt = duplicated.evidence.receipts[0];
		if (!firstReceipt) throw new Error("fixture receipt is missing");
		duplicated.evidence.receipts[3] = firstReceipt;
		expect(() => validate(duplicated)).toThrow("receipt is invalid");

		const mutated = fixture();
		const receipt = mutated.evidence.receipts[0];
		if (!receipt) throw new Error("fixture receipt is missing");
		receipt.primaryMetricValue = 1;
		expect(() => validate(mutated)).toThrow("receipt is invalid");
	});

	it("rejects execution before the trusted plan timestamp and role overlap", () => {
		const current = fixture();
		expect(() =>
			validateBenchmarkDevelopmentExecutionEvidence({
				...current,
				expectedSelectionRuleSha256: "a".repeat(64),
				expectedConfirmatoryDatasetSha256: "b".repeat(64),
				trustedPlanTimestampedAt: "2026-01-03T00:00:00Z",
			}),
		).toThrow("receipt is invalid");

		expect(() =>
			validateBenchmarkDevelopmentExecutionEvidence({
				...fixture(),
				expectedSelectionRuleSha256: "a".repeat(64),
				expectedConfirmatoryDatasetSha256: "b".repeat(64),
				trustedPlanTimestampedAt: "2026-01-01T00:02:00Z",
				forbiddenTrustIdentities: ["development-executor"],
			}),
		).toThrow("role independence is invalid");
	});
});
