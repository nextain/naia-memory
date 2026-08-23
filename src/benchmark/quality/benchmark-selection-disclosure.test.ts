import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { evidenceSignaturePayload } from "./public-evidence-crypto.js";
import {
	benchmarkObservationSha256,
	type BenchmarkSelectionDisclosure,
	validateBenchmarkSelectionDisclosure,
} from "./benchmark-selection-disclosure.js";

function fixture() {
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	const first = {
		id: "trial-a",
		candidateId: "policy-a",
		datasetSha256: "3".repeat(64),
		receiptSha256: "4".repeat(64),
		primaryMetricValue: 0.7,
		startedAt: "2026-01-02T00:00:00Z",
		finishedAt: "2026-01-02T00:01:00Z",
		previousObservationSha256: null,
	};
	const second = {
		id: "trial-b",
		candidateId: "policy-b",
		datasetSha256: "3".repeat(64),
		receiptSha256: "5".repeat(64),
		primaryMetricValue: 0.8,
		startedAt: "2026-01-02T00:02:00Z",
		finishedAt: "2026-01-02T00:03:00Z",
		previousObservationSha256: benchmarkObservationSha256(first),
	};
	const unsigned = {
		schemaVersion: "naia-memory-benchmark-selection-disclosure-v1" as const,
		auditor: "independent-selection-auditor",
		contractSha256: "0".repeat(64),
		analysisPlanSha256: "1".repeat(64),
		confirmatoryDatasetSha256: "2".repeat(64),
		candidates: [
			{ id: "policy-a", policySha256: "a".repeat(64), declaredAt: "2026-01-01T00:00:00Z" },
			{ id: "policy-b", policySha256: "b".repeat(64), declaredAt: "2026-01-01T00:00:00Z" },
		],
		developmentObservations: [first, second],
		selectedCandidateId: "policy-b",
		selectionRule: "frozen-rule-applied-to-development-only" as const,
		selectionAggregation: "unweighted-mean-over-identical-development-datasets" as const,
		selectionObjective: "maximize" as const,
		selectionRuleSha256: "6".repeat(64),
		selectedAt: "2026-01-02T00:04:00Z",
		signedAt: "2026-01-02T00:05:00Z",
		statement: "ALL_KNOWN_SELECTION_TRIALS_DISCLOSED_BEFORE_CONFIRMATORY_RUN" as const,
	};
	const disclosure: BenchmarkSelectionDisclosure = {
		...unsigned,
		signatureBase64: sign(null, evidenceSignaturePayload(unsigned), privateKey).toString("base64"),
	};
	const input = {
		disclosure,
		trustPolicy: { auditorPublicKeys: { [disclosure.auditor]: publicKey.export({ type: "spki", format: "pem" }).toString() } },
		expectedContractSha256: disclosure.contractSha256,
		expectedAnalysisPlanSha256: disclosure.analysisPlanSha256,
		firstConfirmatoryExecutionStartedAt: "2026-01-03T00:00:00Z",
	};
	return { input, privateKey };
}

function resign(current: ReturnType<typeof fixture>) {
	current.input.disclosure.signatureBase64 = sign(
		null,
		evidenceSignaturePayload(current.input.disclosure),
		current.privateKey,
	).toString("base64");
}

describe("benchmark selection disclosure", () => {
	it("qualifies a complete pre-confirmation candidate history", () => {
		const current = fixture();
		expect(validateBenchmarkSelectionDisclosure(current.input)).toEqual({
			selectionHistoryQualified: true,
			candidateCount: 2,
			developmentObservationCount: 2,
			selectedPolicySha256: "b".repeat(64),
			selectionDisclosureInternallyConsistent: true,
			developmentObservationReceiptsExternallyVerified: false,
			selectionHistoryCompletenessExternallyVerified: false,
		});
	});

	it("rejects a broken chain and a hidden duplicate trial", () => {
		const broken = fixture();
		broken.input.disclosure.developmentObservations[1]!.previousObservationSha256 = "f".repeat(64);
		resign(broken);
		expect(() => validateBenchmarkSelectionDisclosure(broken.input)).toThrow("observation chain");

		const duplicate = fixture();
		duplicate.input.disclosure.developmentObservations[1]!.candidateId = "policy-a";
		duplicate.input.disclosure.developmentObservations[1]!.previousObservationSha256 = benchmarkObservationSha256(duplicate.input.disclosure.developmentObservations[0]!);
		resign(duplicate);
		expect(() => validateBenchmarkSelectionDisclosure(duplicate.input)).toThrow("repeated candidate/dataset");
	});

	it("rejects confirmatory leakage, late freezing, and signature mutation", () => {
		const leakage = fixture();
		leakage.input.disclosure.developmentObservations[0]!.datasetSha256 = leakage.input.disclosure.confirmatoryDatasetSha256;
		resign(leakage);
		expect(() => validateBenchmarkSelectionDisclosure(leakage.input)).toThrow("observation chain");

		const late = fixture();
		late.input.firstConfirmatoryExecutionStartedAt = late.input.disclosure.signedAt;
		expect(() => validateBenchmarkSelectionDisclosure(late.input)).toThrow("not frozen before confirmation");

		const mutated = fixture();
		mutated.input.disclosure.selectionRuleSha256 = "9".repeat(64);
		expect(() => validateBenchmarkSelectionDisclosure(mutated.input)).toThrow("signature is invalid");
	});

	it("replays the frozen selection rule and rejects asymmetric coverage", () => {
		const wrongWinner = fixture();
		wrongWinner.input.disclosure.selectedCandidateId = "policy-a";
		resign(wrongWinner);
		expect(() => validateBenchmarkSelectionDisclosure(wrongWinner.input)).toThrow("violates the frozen rule");

		const asymmetric = fixture();
		asymmetric.input.disclosure.developmentObservations[1]!.datasetSha256 = "7".repeat(64);
		asymmetric.input.disclosure.developmentObservations[1]!.previousObservationSha256 = benchmarkObservationSha256(asymmetric.input.disclosure.developmentObservations[0]!);
		resign(asymmetric);
		expect(() => validateBenchmarkSelectionDisclosure(asymmetric.input)).toThrow("coverage is asymmetric");
	});

	it("rejects receipt reuse across nominally distinct trials", () => {
		const current = fixture();
		current.input.disclosure.developmentObservations[1]!.receiptSha256 =
			current.input.disclosure.developmentObservations[0]!.receiptSha256;
		current.input.disclosure.developmentObservations[1]!.previousObservationSha256 =
			benchmarkObservationSha256(current.input.disclosure.developmentObservations[0]!);
		resign(current);
		expect(() => validateBenchmarkSelectionDisclosure(current.input)).toThrow(
			"reuses an observation receipt",
		);
	});

	it("rejects an auditor identity or key reused by another evidence role", () => {
		const current = fixture();
		const key = current.input.trustPolicy.auditorPublicKeys[current.input.disclosure.auditor]!;
		expect(() => validateBenchmarkSelectionDisclosure({ ...current.input, forbiddenTrustIdentities: [current.input.disclosure.auditor] })).toThrow("overlaps another role");
		expect(() => validateBenchmarkSelectionDisclosure({ ...current.input, forbiddenTrustPublicKeys: [key] })).toThrow("overlaps another role");
	});
});
