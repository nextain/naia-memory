import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import { runRfc3161TimestampCli } from "./rfc3161-timestamp-cli.js";
import {
	validateRfc3161DigestTimestampBinding,
	validateRfc3161PriorExistence,
} from "./rfc3161-timestamp.js";

function fixture() {
	const directory = mkdtempSync(join(tmpdir(), "naia-rfc3161-cli-"));
	const plan = {
		schemaVersion: "naia-memory-semantic-pilot-collection-plan-v1",
		publicContractSha256: "0".repeat(64),
		powerReviewerId: "power-reviewer",
		createdAt: "2026-01-01T00:00:00Z",
		assignments: ["ko", "en", "ja"].flatMap((language) =>
			["update", "delete", "no-update"].map((decision) => ({
				assignmentId: `${language}-${decision}`,
				language,
				decision,
				authorId: `author-${language}`,
				reviewerId: `reviewer-${language}`,
				constructionClusterId: `cluster-${language}-${decision}`,
				causeIds: [`source-${language}-${decision}`],
			})),
		),
	};
	const planPath = join(directory, "plan.json");
	writeFileSync(planPath, JSON.stringify(plan));
	return { directory, plan, planPath };
}

describe("RFC 3161 timestamp campaign CLI", () => {
	it("round-trips an exact plan through a real OpenSSL TSA", async () => {
		const current = fixture();
		const caKey = join(current.directory, "ca.key");
		const caCert = join(current.directory, "ca.pem");
		const tsaKey = join(current.directory, "tsa.key");
		const tsaCsr = join(current.directory, "tsa.csr");
		const tsaCert = join(current.directory, "tsa.pem");
		const extensions = join(current.directory, "tsa-ext.cnf");
		const serial = join(current.directory, "tsa-serial");
		const config = join(current.directory, "tsa.cnf");
		const queryPath = join(current.directory, "plan.tsq");
		const responsePath = join(current.directory, "plan.tsr");
		writeFileSync(
			extensions,
			"[tsa_ext]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,nonRepudiation\nextendedKeyUsage=critical,timeStamping\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n",
		);
		execFileSync(
			"openssl",
			[
				"req",
				"-x509",
				"-newkey",
				"rsa:2048",
				"-nodes",
				"-keyout",
				caKey,
				"-out",
				caCert,
				"-days",
				"1",
				"-subj",
				"/CN=Naia test TSA CA",
			],
			{ stdio: "ignore" },
		);
		execFileSync(
			"openssl",
			[
				"req",
				"-newkey",
				"rsa:2048",
				"-nodes",
				"-keyout",
				tsaKey,
				"-out",
				tsaCsr,
				"-subj",
				"/CN=Naia test TSA",
			],
			{ stdio: "ignore" },
		);
		execFileSync(
			"openssl",
			[
				"x509",
				"-req",
				"-in",
				tsaCsr,
				"-CA",
				caCert,
				"-CAkey",
				caKey,
				"-CAcreateserial",
				"-out",
				tsaCert,
				"-days",
				"1",
				"-sha256",
				"-extfile",
				extensions,
				"-extensions",
				"tsa_ext",
			],
			{ stdio: "ignore" },
		);
		writeFileSync(serial, "01\n");
		writeFileSync(
			config,
			`[tsa]\ndefault_tsa=tsa_config1\n[tsa_config1]\nserial=${serial}\nsigner_cert=${tsaCert}\ncerts=${caCert}\nsigner_key=${tsaKey}\nsigner_digest=sha256\ndefault_policy=1.2.3.4.1\ndigests=sha256\naccuracy=secs:1\nordering=yes\ntsa_name=yes\ness_cert_id_chain=yes\n`,
		);
		expect(
			await runRfc3161TimestampCli(["request", current.planPath, queryPath]),
		).toBe(0);
		execFileSync(
			"openssl",
			[
				"ts",
				"-reply",
				"-config",
				config,
				"-section",
				"tsa_config1",
				"-queryfile",
				queryPath,
				"-out",
				responsePath,
			],
			{ stdio: "ignore" },
		);
		const response = readFileSync(responsePath);
		expect(
			validateRfc3161PriorExistence({
				collectionPlan: current.plan,
				evidence: {
					schemaVersion: "naia-memory-rfc3161-timestamp-evidence-v1",
					collectionPlanSha256: evidenceObjectSha256(current.plan),
					tokenSha256: createHash("sha256").update(response).digest("hex"),
					tokenPath: responsePath,
				},
				trustPolicy: {
					schemaVersion: "naia-memory-rfc3161-timestamp-trust-policy-v1",
					trustedCaFilePath: caCert,
					trustedCaFileSha256: createHash("sha256")
						.update(readFileSync(caCert))
						.digest("hex"),
					requiredPolicyOid: "1.2.3.4.1",
				},
				earliestAuthoredAt: "2099-01-01T00:00:00Z",
			}),
		).toMatchObject({
			trustedTimestampVerified: true,
			priorAssignmentTimingVerified: true,
		});

		const artifactPath = join(current.directory, "publication-receipt.json");
		const artifactBytes = Buffer.from('{"receipt":"published"}\n');
		const artifactSha256 = createHash("sha256")
			.update(artifactBytes)
			.digest("hex");
		const artifactQueryPath = join(
			current.directory,
			"publication-receipt.tsq",
		);
		const artifactResponsePath = join(
			current.directory,
			"publication-receipt.tsr",
		);
		writeFileSync(artifactPath, artifactBytes);
		expect(
			await runRfc3161TimestampCli([
				"request-file",
				artifactPath,
				artifactQueryPath,
			]),
		).toBe(0);
		execFileSync(
			"openssl",
			[
				"ts",
				"-reply",
				"-config",
				config,
				"-section",
				"tsa_config1",
				"-queryfile",
				artifactQueryPath,
				"-out",
				artifactResponsePath,
			],
			{ stdio: "ignore" },
		);
		const writes = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		expect(
			await runRfc3161TimestampCli([
				"seal-file",
				artifactPath,
				artifactResponsePath,
			]),
		).toBe(0);
		const evidence = JSON.parse(String(writes.mock.calls.at(-1)?.[0]));
		writes.mockRestore();
		expect(
			validateRfc3161DigestTimestampBinding({
				expectedArtifactSha256: artifactSha256,
				evidence,
				trustPolicy: {
					schemaVersion: "naia-memory-rfc3161-timestamp-trust-policy-v1",
					trustedCaFilePath: caCert,
					trustedCaFileSha256: createHash("sha256")
						.update(readFileSync(caCert))
						.digest("hex"),
					requiredPolicyOid: "1.2.3.4.1",
				},
			}),
		).toMatchObject({ trustedTimestampVerified: true });
	}, 30_000);

	it("creates a nonce-bearing request for the exact canonical plan hash", async () => {
		const current = fixture();
		const queryPath = join(current.directory, "plan.tsq");
		const output = Buffer.from("timestamp query");
		const runner = vi.fn(() => ({
			status: 0,
			stdout: output,
			stderr: "",
		}));
		expect(
			await runRfc3161TimestampCli(
				["request", current.planPath, queryPath],
				runner,
			),
		).toBe(0);
		expect(runner).toHaveBeenCalledWith([
			"ts",
			"-query",
			"-digest",
			evidenceObjectSha256(current.plan),
			"-sha256",
			"-cert",
		]);
		expect(readFileSync(queryPath)).toEqual(output);
	});

	it("seals the response bytes without claiming they are trusted", async () => {
		const current = fixture();
		const tokenPath = join(current.directory, "response.tsr");
		writeFileSync(tokenPath, "response bytes");
		const writes = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		expect(
			await runRfc3161TimestampCli(["seal", current.planPath, tokenPath]),
		).toBe(0);
		const parsed = JSON.parse(String(writes.mock.calls.at(-1)?.[0]));
		expect(parsed).toMatchObject({
			schemaVersion: "naia-memory-rfc3161-timestamp-evidence-v1",
			collectionPlanSha256: evidenceObjectSha256(current.plan),
			tokenPath,
		});
		expect(parsed).not.toHaveProperty("trustedTimestampVerified");
		writes.mockRestore();
	});

	it("creates and seals timestamp artifacts for an exact external digest", async () => {
		const current = fixture();
		const artifactSha256 = "c".repeat(64);
		const queryPath = join(current.directory, "bundle.tsq");
		const runner = vi.fn(() => ({
			status: 0,
			stdout: Buffer.from("bundle timestamp query"),
			stderr: "",
		}));
		expect(
			await runRfc3161TimestampCli(
				["request-digest", artifactSha256, queryPath],
				runner,
			),
		).toBe(0);
		expect(runner).toHaveBeenCalledWith([
			"ts",
			"-query",
			"-digest",
			artifactSha256,
			"-sha256",
			"-cert",
		]);

		const tokenPath = join(current.directory, "bundle.tsr");
		writeFileSync(tokenPath, "bundle timestamp response");
		const writes = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		expect(
			await runRfc3161TimestampCli(["seal-digest", artifactSha256, tokenPath]),
		).toBe(0);
		expect(JSON.parse(String(writes.mock.calls.at(-1)?.[0]))).toMatchObject({
			schemaVersion: "naia-memory-rfc3161-digest-timestamp-evidence-v1",
			artifactSha256,
			tokenPath,
		});
		writes.mockRestore();
	});

	it("creates and seals digest evidence from exact artifact bytes", async () => {
		const current = fixture();
		const artifactPath = join(current.directory, "publication-receipt.json");
		const artifactBytes = Buffer.from('{"receipt":"exact bytes"}\n');
		const artifactSha256 = createHash("sha256")
			.update(artifactBytes)
			.digest("hex");
		const queryPath = join(current.directory, "publication-receipt.tsq");
		writeFileSync(artifactPath, artifactBytes);
		const runner = vi.fn(() => ({
			status: 0,
			stdout: Buffer.from("publication timestamp query"),
			stderr: "",
		}));

		expect(
			await runRfc3161TimestampCli(
				["request-file", artifactPath, queryPath],
				runner,
			),
		).toBe(0);
		expect(runner).toHaveBeenCalledWith([
			"ts",
			"-query",
			"-digest",
			artifactSha256,
			"-sha256",
			"-cert",
		]);

		const tokenPath = join(current.directory, "publication-receipt.tsr");
		writeFileSync(tokenPath, "publication timestamp response");
		const writes = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		expect(
			await runRfc3161TimestampCli(["seal-file", artifactPath, tokenPath]),
		).toBe(0);
		expect(JSON.parse(String(writes.mock.calls.at(-1)?.[0]))).toMatchObject({
			schemaVersion: "naia-memory-rfc3161-digest-timestamp-evidence-v1",
			artifactSha256,
			tokenPath,
		});
		writes.mockRestore();
	});

	it("rejects oversized and symlinked exact-byte artifacts", async () => {
		const current = fixture();
		const oversizedPath = join(current.directory, "oversized.bin");
		const artifactPath = join(current.directory, "artifact.bin");
		const artifactLink = join(current.directory, "artifact-link.bin");
		writeFileSync(oversizedPath, Buffer.alloc(16 * 1024 * 1024 + 1));
		writeFileSync(artifactPath, "artifact");
		symlinkSync(artifactPath, artifactLink);
		const writes = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);

		expect(
			await runRfc3161TimestampCli([
				"request-file",
				oversizedPath,
				join(current.directory, "oversized.tsq"),
			]),
		).toBe(1);
		expect(String(writes.mock.calls.at(-1)?.[0])).toContain("16 MiB");
		expect(
			await runRfc3161TimestampCli([
				"request-file",
				artifactLink,
				join(current.directory, "symlink.tsq"),
			]),
		).toBe(1);
		expect(String(writes.mock.calls.at(-1)?.[0])).toContain("unreadable");
		const tokenPath = join(current.directory, "artifact.tsr");
		writeFileSync(tokenPath, "timestamp response");
		expect(
			await runRfc3161TimestampCli(["seal-file", oversizedPath, tokenPath]),
		).toBe(1);
		expect(String(writes.mock.calls.at(-1)?.[0])).toContain("16 MiB");
		expect(
			await runRfc3161TimestampCli(["seal-file", artifactLink, tokenPath]),
		).toBe(1);
		expect(String(writes.mock.calls.at(-1)?.[0])).toContain("unreadable");
		writes.mockRestore();
	});

	it("rejects malformed external digests", async () => {
		const current = fixture();
		const writes = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		expect(
			await runRfc3161TimestampCli([
				"request-digest",
				"not-a-digest",
				join(current.directory, "bundle.tsq"),
			]),
		).toBe(1);
		expect(String(writes.mock.calls.at(-1)?.[0])).toContain(
			"artifact SHA-256 is invalid",
		);
		writes.mockRestore();
	});

	it("does not overwrite an existing request artifact", async () => {
		const current = fixture();
		const queryPath = join(current.directory, "plan.tsq");
		writeFileSync(queryPath, "existing");
		const writes = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		expect(
			await runRfc3161TimestampCli(
				["request", current.planPath, queryPath],
				() => ({ status: 0, stdout: Buffer.from("new"), stderr: "" }),
			),
		).toBe(1);
		expect(readFileSync(queryPath, "utf8")).toBe("existing");

		const artifactPath = join(current.directory, "artifact.bin");
		const artifactQueryPath = join(current.directory, "artifact.tsq");
		writeFileSync(artifactPath, "artifact");
		writeFileSync(artifactQueryPath, "existing artifact query");
		expect(
			await runRfc3161TimestampCli(
				["request-file", artifactPath, artifactQueryPath],
				() => ({ status: 0, stdout: Buffer.from("new"), stderr: "" }),
			),
		).toBe(1);
		expect(readFileSync(artifactQueryPath, "utf8")).toBe(
			"existing artifact query",
		);
		writes.mockRestore();
	});
});
