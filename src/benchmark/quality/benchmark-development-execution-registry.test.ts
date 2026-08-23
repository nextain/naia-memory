import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
	BenchmarkDevelopmentExecutionPlan,
	BenchmarkDevelopmentExecutionReceipt,
} from "./benchmark-development-execution-evidence.js";
import {
	type BenchmarkDevelopmentExecutionRegistryEntry,
	validateBenchmarkDevelopmentExecutionRegistry,
} from "./benchmark-development-execution-registry.js";
import {
	evidenceObjectSha256,
	evidenceSignaturePayload,
} from "./public-evidence-crypto.js";

function fixture() {
	const registrar = generateKeyPairSync("ed25519");
	const administrator = generateKeyPairSync("ed25519");
	const executor = generateKeyPairSync("ed25519");
	const directory = mkdtempSync(join(tmpdir(), "naia-registry-"));
	const tokenPath = join(directory, "token.tsr");
	const caPath = join(directory, "ca.pem");
	const token = Buffer.from("timestamp-token");
	const ca = Buffer.from("timestamp-ca");
	writeFileSync(tokenPath, token);
	writeFileSync(caPath, ca);
	const plan = {
		schemaVersion: "naia-memory-benchmark-development-execution-plan-v1",
		administrator: "admin",
		selectionRuleSha256: "a".repeat(64),
		confirmatoryDatasetSha256: "b".repeat(64),
		candidates: [{ id: "candidate", policySha256: "c".repeat(64) }],
		datasetSha256s: ["d".repeat(64)],
		createdAt: "2026-01-01T00:00:00Z",
		signedAt: "2026-01-01T00:01:00Z",
		statement: "COMPLETE_DEVELOPMENT_MATRIX_FROZEN_BEFORE_EXECUTION",
		signatureBase64: "unused",
	} as BenchmarkDevelopmentExecutionPlan;
	const unsignedReceipt = {
		schemaVersion: "naia-memory-benchmark-development-execution-receipt-v1",
		executor: "executor",
		planSha256: evidenceObjectSha256(plan),
		candidateId: "candidate",
		policySha256: "c".repeat(64),
		datasetSha256: "d".repeat(64),
		primaryMetricValue: 0.7,
		startedAt: "2026-01-02T00:05:00Z",
		finishedAt: "2026-01-02T00:30:00Z",
		signedAt: "2026-01-02T00:31:00Z",
		statement: "DEVELOPMENT_EXECUTION_CONFIRMED",
	};
	const receipt: BenchmarkDevelopmentExecutionReceipt = {
		...unsignedReceipt,
		signatureBase64: sign(
			null,
			evidenceSignaturePayload(unsignedReceipt),
			executor.privateKey,
		).toString("base64"),
	};
	let previousEntrySha256: string | null = null;
	const makeEntry = (event: "started" | "finished", ordinal: number) => {
		const unsigned = {
			schemaVersion:
				"naia-memory-benchmark-development-execution-registry-entry-v1" as const,
			registrar: "external-registrar",
			ordinal,
			previousEntrySha256,
			planSha256: evidenceObjectSha256(plan),
			event,
			candidateId: receipt.candidateId,
			policySha256: receipt.policySha256,
			datasetSha256: receipt.datasetSha256,
			executor: receipt.executor,
			receiptSha256:
				event === "finished" ? evidenceObjectSha256(receipt) : null,
			declaredAt:
				event === "started" ? "2026-01-02T00:00:00Z" : "2026-01-02T00:32:00Z",
			signedAt:
				event === "started" ? "2026-01-02T00:01:00Z" : "2026-01-02T00:33:00Z",
			statement: "DEVELOPMENT_EXECUTION_REGISTRY_EVENT" as const,
		};
		const entry: BenchmarkDevelopmentExecutionRegistryEntry = {
			...unsigned,
			signatureBase64: sign(
				null,
				evidenceSignaturePayload(unsigned),
				registrar.privateKey,
			).toString("base64"),
		};
		previousEntrySha256 = evidenceObjectSha256(entry);
		return {
			entry,
			timestampEvidence: {
				schemaVersion:
					"naia-memory-rfc3161-digest-timestamp-evidence-v1" as const,
				artifactSha256: previousEntrySha256,
				tokenSha256: createHash("sha256").update(token).digest("hex"),
				tokenPath,
			},
		};
	};
	const records = [makeEntry("started", 1), makeEntry("finished", 2)];
	let inspection = 0;
	return {
		input: {
			evidence: {
				schemaVersion:
					"naia-memory-benchmark-development-execution-registry-evidence-v1" as const,
				records,
			},
			trustPolicy: {
				registrarPublicKeys: {
					"external-registrar": registrar.publicKey
						.export({ type: "spki", format: "pem" })
						.toString(),
				},
			},
			developmentTrustPolicy: {
				administratorPublicKeys: {
					admin: administrator.publicKey
						.export({ type: "spki", format: "pem" })
						.toString(),
				},
				executorPublicKeys: {
					executor: executor.publicKey
						.export({ type: "spki", format: "pem" })
						.toString(),
				},
			},
			timestampTrustPolicy: {
				schemaVersion: "naia-memory-rfc3161-timestamp-trust-policy-v1" as const,
				trustedCaFilePath: caPath,
				trustedCaFileSha256: createHash("sha256").update(ca).digest("hex"),
				requiredPolicyOid: "1.2.3.4",
			},
			plan,
			receipts: [receipt],
			trustedPlanTimestampedAt: "2026-01-01T00:02:00Z",
			commandRunner: (args: string[]) => {
				if (args.includes("-verify"))
					return { status: 0, stdout: "Verification: OK\n", stderr: "" };
				inspection += 1;
				return {
					status: 0,
					stdout: `Policy OID: 1.2.3.4\nTime stamp: Jan  2 00:${inspection === 1 ? "02" : "34"}:00 2026 GMT\n`,
					stderr: "",
				};
			},
		},
	};
}

describe("benchmark development execution registry", () => {
	it("verifies the externally timestamped registered execution chronology", () => {
		expect(
			validateBenchmarkDevelopmentExecutionRegistry(fixture().input),
		).toMatchObject({
			registeredDevelopmentExecutionChronologyExternallyVerified: true,
			offRegistryDevelopmentExecutionAbsenceExternallyVerified: false,
			registeredExecutionCount: 1,
		});
	});

	it("rejects chain substitution and missing events", () => {
		const substituted = fixture();
		const secondRecord = substituted.input.evidence.records[1];
		if (!secondRecord) throw new Error("fixture registry finish is missing");
		secondRecord.entry.previousEntrySha256 = "f".repeat(64);
		expect(() =>
			validateBenchmarkDevelopmentExecutionRegistry(substituted.input),
		).toThrow("entry is invalid");
		const omitted = fixture();
		omitted.input.evidence.records.pop();
		expect(() =>
			validateBenchmarkDevelopmentExecutionRegistry(omitted.input),
		).toThrow("coverage is incomplete");
	});

	it("rejects registrar role overlap", () => {
		const current = fixture();
		expect(() =>
			validateBenchmarkDevelopmentExecutionRegistry({
				...current.input,
				forbiddenTrustIdentities: ["external-registrar"],
			}),
		).toThrow("registrar independence is invalid");
	});

	it("rejects registrar key overlap without caller-supplied exclusions", () => {
		const current = fixture();
		current.input.developmentTrustPolicy.executorPublicKeys.executor =
			current.input.trustPolicy.registrarPublicKeys["external-registrar"] ?? "";
		expect(() =>
			validateBenchmarkDevelopmentExecutionRegistry(current.input),
		).toThrow("registrar independence is invalid");
	});

	it("rejects a start registered after claimed execution began", () => {
		const current = fixture();
		let inspection = 0;
		current.input.commandRunner = (args: string[]) => {
			if (args.includes("-verify"))
				return { status: 0, stdout: "Verification: OK\n", stderr: "" };
			inspection += 1;
			return {
				status: 0,
				stdout: `Policy OID: 1.2.3.4\nTime stamp: Jan  2 00:${inspection === 1 ? "06" : "34"}:00 2026 GMT\n`,
				stderr: "",
			};
		};
		expect(() =>
			validateBenchmarkDevelopmentExecutionRegistry(current.input),
		).toThrow("was not committed before execution");
	});

	it("rejects an unauthenticated or cross-plan receipt", () => {
		const unsigned = fixture();
		const unsignedReceipt = unsigned.input.receipts[0];
		if (!unsignedReceipt) throw new Error("fixture receipt is missing");
		unsignedReceipt.signatureBase64 = "invalid";
		expect(() =>
			validateBenchmarkDevelopmentExecutionRegistry(unsigned.input),
		).toThrow("receipt authentication is invalid");
		const crossPlan = fixture();
		const crossPlanReceipt = crossPlan.input.receipts[0];
		if (!crossPlanReceipt) throw new Error("fixture receipt is missing");
		crossPlanReceipt.planSha256 = "f".repeat(64);
		expect(() =>
			validateBenchmarkDevelopmentExecutionRegistry(crossPlan.input),
		).toThrow("receipt authentication is invalid");
	});
});
