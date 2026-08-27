import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
	it("verifies a real OpenSSL-generated RFC 3161 response end to end", () => {
		const directory = mkdtempSync(join(tmpdir(), "naia-rfc3161-real-"));
		try {
			const keyPath = join(directory, "tsa.key");
			const caPath = join(directory, "tsa.crt");
			const requestPath = join(directory, "request.tsq");
			const tokenPath = join(directory, "response.tsr");
			const configPath = join(directory, "tsa.cnf");
			const serialPath = join(directory, "tsa.serial");
			const artifactSha256 = createHash("sha256")
				.update("real RFC 3161 integration artifact")
				.digest("hex");
			const run = (args: string[]) => {
				const result = spawnSync("openssl", args, {
					encoding: "utf8",
					timeout: 10_000,
				});
				expect(result.error).toBeUndefined();
				expect(result.status, result.stderr).toBe(0);
			};
			run([
				"req",
				"-x509",
				"-newkey",
				"rsa:2048",
				"-keyout",
				keyPath,
				"-out",
				caPath,
				"-days",
				"2",
				"-nodes",
				"-subj",
				"/CN=Naia RFC3161 Integration TSA",
				"-addext",
				"basicConstraints=critical,CA:FALSE",
				"-addext",
				"keyUsage=critical,digitalSignature",
				"-addext",
				"extendedKeyUsage=critical,timeStamping",
			]);
			run([
				"ts",
				"-query",
				"-digest",
				artifactSha256,
				"-sha256",
				"-cert",
				"-out",
				requestPath,
			]);
			writeFileSync(serialPath, "01\n", { mode: 0o600 });
			writeFileSync(
				configPath,
				[
					"[ tsa ]",
					"default_tsa = tsa_config1",
					"[ tsa_config1 ]",
					`serial = ${serialPath}`,
					`signer_cert = ${caPath}`,
					`signer_key = ${keyPath}`,
					"signer_digest = sha256",
					"default_policy = 1.2.3.4",
					"digests = sha256",
					"crypto_device = builtin",
					"accuracy = secs:1",
					"ordering = yes",
					"tsa_name = yes",
					"ess_cert_id_chain = no",
					"",
				].join("\n"),
			);
			run([
				"ts",
				"-reply",
				"-config",
				configPath,
				"-section",
				"tsa_config1",
				"-queryfile",
				requestPath,
				"-out",
				tokenPath,
			]);
			const token = readFileSync(tokenPath);
			const trustedCa = readFileSync(caPath);
			const verdict = validateRfc3161DigestTimestampBinding({
				expectedArtifactSha256: artifactSha256,
				evidence: {
					schemaVersion: "naia-memory-rfc3161-digest-timestamp-evidence-v1",
					artifactSha256,
					tokenSha256: createHash("sha256").update(token).digest("hex"),
					tokenPath,
				},
				trustPolicy: {
					schemaVersion: "naia-memory-rfc3161-timestamp-trust-policy-v1",
					trustedCaFilePath: caPath,
					trustedCaFileSha256: createHash("sha256")
						.update(trustedCa)
						.digest("hex"),
					requiredPolicyOid: "1.2.3.4",
				},
			});
			expect(verdict.trustedTimestampVerified).toBe(true);
			expect(Date.parse(verdict.timestampedAt)).not.toBeNaN();
			expect(
				Math.abs(Date.now() - Date.parse(verdict.timestampedAt)),
			).toBeLessThan(60_000);

			const evidence = {
				schemaVersion:
					"naia-memory-rfc3161-digest-timestamp-evidence-v1" as const,
				artifactSha256,
				tokenSha256: createHash("sha256").update(token).digest("hex"),
				tokenPath,
			};
			const trustPolicy = {
				schemaVersion: "naia-memory-rfc3161-timestamp-trust-policy-v1" as const,
				trustedCaFilePath: caPath,
				trustedCaFileSha256: createHash("sha256")
					.update(trustedCa)
					.digest("hex"),
				requiredPolicyOid: "1.2.3.4",
			};
			const substitutedDigest = "0".repeat(64);
			expect(() =>
				validateRfc3161DigestTimestampBinding({
					expectedArtifactSha256: substitutedDigest,
					evidence: { ...evidence, artifactSha256: substitutedDigest },
					trustPolicy,
				}),
			).toThrow("signature or message imprint is invalid");
			expect(() =>
				validateRfc3161DigestTimestampBinding({
					expectedArtifactSha256: artifactSha256,
					evidence,
					trustPolicy: { ...trustPolicy, requiredPolicyOid: "1.2.3.5" },
				}),
			).toThrow("timestamp policy is not authorized");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

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
