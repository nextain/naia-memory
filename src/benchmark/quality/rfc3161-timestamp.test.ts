import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import {
	validateRfc3161DigestTimestampBinding,
	validateRfc3161PriorExistence,
} from "./rfc3161-timestamp.js";

function fixture(timestamp = "Jan  1 00:00:00 2026 GMT") {
	const directory = mkdtempSync(join(tmpdir(), "naia-rfc3161-"));
	const tokenPath = join(directory, "plan.tsr");
	const caPath = join(directory, "tsa-ca.pem");
	const token = Buffer.from("test timestamp response");
	const trustedCa = Buffer.from("test CA");
	writeFileSync(tokenPath, token);
	writeFileSync(caPath, trustedCa);
	const collectionPlan = { assignments: [{ id: "pilot-1" }] };
	const calls: string[][] = [];
	return {
		collectionPlan,
		evidence: {
			schemaVersion: "naia-memory-rfc3161-timestamp-evidence-v1" as const,
			collectionPlanSha256: evidenceObjectSha256(collectionPlan),
			tokenSha256: createHash("sha256").update(token).digest("hex"),
			tokenPath,
		},
		trustPolicy: {
			schemaVersion: "naia-memory-rfc3161-timestamp-trust-policy-v1" as const,
			trustedCaFilePath: caPath,
			trustedCaFileSha256: createHash("sha256").update(trustedCa).digest("hex"),
			requiredPolicyOid: "1.2.3.4",
		},
		earliestAuthoredAt: "2026-01-02T00:00:00Z",
		commandRunner: (args: string[], input: Buffer, ca: Buffer) => {
			calls.push(args);
			expect(input).toEqual(token);
			expect(ca).toEqual(trustedCa);
			return args.includes("-verify")
				? { status: 0, stdout: "Verification: OK\n", stderr: "" }
				: {
						status: 0,
						stdout: `Status info:\nPolicy OID: 1.2.3.4\nTime stamp: ${timestamp}\n`,
						stderr: "",
					};
		},
		calls,
	};
}

describe("RFC 3161 prior-existence verification", () => {
	it("verifies a trusted timestamp over an exact externally validated digest", () => {
		const current = fixture();
		const artifactSha256 = "c".repeat(64);
		expect(
			validateRfc3161DigestTimestampBinding({
				expectedArtifactSha256: artifactSha256,
				evidence: {
					schemaVersion: "naia-memory-rfc3161-digest-timestamp-evidence-v1",
					artifactSha256,
					tokenSha256: current.evidence.tokenSha256,
					tokenPath: current.evidence.tokenPath,
				},
				trustPolicy: current.trustPolicy,
				commandRunner: current.commandRunner,
			}),
		).toEqual({
			trustedTimestampVerified: true,
			timestampedAt: "2026-01-01T00:00:00.000Z",
		});
		expect(current.calls[0]).toContain(artifactSha256);
	});

	it("rejects digest evidence bound to a different artifact", () => {
		const current = fixture();
		expect(() =>
			validateRfc3161DigestTimestampBinding({
				expectedArtifactSha256: "c".repeat(64),
				evidence: {
					schemaVersion: "naia-memory-rfc3161-digest-timestamp-evidence-v1",
					artifactSha256: "d".repeat(64),
					tokenSha256: current.evidence.tokenSha256,
					tokenPath: current.evidence.tokenPath,
				},
				trustPolicy: current.trustPolicy,
				commandRunner: current.commandRunner,
			}),
		).toThrow("artifact hash mismatch");
	});

	it("requires a trusted timestamp over the exact collection plan hash", () => {
		const current = fixture();
		expect(validateRfc3161PriorExistence(current)).toEqual({
			trustedTimestampVerified: true,
			priorAssignmentTimingVerified: true,
			timestampedAt: "2026-01-01T00:00:00.000Z",
		});
		expect(current.calls[0]).toContain(current.evidence.collectionPlanSha256);
		expect(current.calls[0]).toContain("timestampsign");
	});

	it("rejects a token whose cryptographic verification fails", () => {
		const current = fixture();
		current.commandRunner = () => ({ status: 1, stdout: "", stderr: "bad" });
		expect(() => validateRfc3161PriorExistence(current)).toThrow(
			"signature or message imprint is invalid",
		);
	});

	it("passes the immutable token bytes to the real OpenSSL verifier", () => {
		const current = fixture();
		expect(() =>
			validateRfc3161PriorExistence({
				collectionPlan: current.collectionPlan,
				evidence: current.evidence,
				trustPolicy: current.trustPolicy,
				earliestAuthoredAt: current.earliestAuthoredAt,
			}),
		).toThrow("signature or message imprint is invalid");
	});

	it("rejects a timestamp at or after pilot authorship", () => {
		const current = fixture("Jan  2 00:00:00 2026 GMT");
		expect(() => validateRfc3161PriorExistence(current)).toThrow(
			"was not timestamped before authorship",
		);
	});

	it("requires the full timestamp second to precede authorship", () => {
		const tooClose = fixture();
		tooClose.earliestAuthoredAt = "2026-01-01T00:00:00.999Z";
		expect(() => validateRfc3161PriorExistence(tooClose)).toThrow(
			"was not timestamped before authorship",
		);
		const nextSecond = fixture();
		nextSecond.earliestAuthoredAt = "2026-01-01T00:00:01.000Z";
		expect(validateRfc3161PriorExistence(nextSecond).timestampedAt).toBe(
			"2026-01-01T00:00:00.000Z",
		);
	});

	it("rejects an unauthorized TSA policy and ambiguous time format", () => {
		const wrongPolicy = fixture();
		wrongPolicy.trustPolicy.requiredPolicyOid = "1.2.3.5";
		expect(() => validateRfc3161PriorExistence(wrongPolicy)).toThrow(
			"timestamp policy is not authorized",
		);
		const ambiguousTime = fixture("2026-01-01T00:00:00Z");
		expect(() => validateRfc3161PriorExistence(ambiguousTime)).toThrow(
			"timestamp chronology is invalid",
		);
		const ambiguousAuthorship = fixture();
		ambiguousAuthorship.earliestAuthoredAt = "January 2, 2026";
		expect(() => validateRfc3161PriorExistence(ambiguousAuthorship)).toThrow(
			"timestamp chronology is invalid",
		);
	});

	it("rejects plan, token, and trusted CA substitution", () => {
		const changedPlan = fixture();
		changedPlan.collectionPlan = { assignments: [{ id: "replacement" }] };
		expect(() => validateRfc3161PriorExistence(changedPlan)).toThrow(
			"collection plan hash mismatch",
		);
		const changedToken = fixture();
		writeFileSync(changedToken.evidence.tokenPath, "replacement");
		expect(() => validateRfc3161PriorExistence(changedToken)).toThrow(
			"token hash mismatch",
		);
		const changedCa = fixture();
		writeFileSync(changedCa.trustPolicy.trustedCaFilePath, "replacement CA");
		expect(() => validateRfc3161PriorExistence(changedCa)).toThrow(
			"trusted CA file hash mismatch",
		);
	});
});
