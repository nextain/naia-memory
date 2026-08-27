import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import type { QueryIdentityEncryptedOracleEnvelope } from "./query-identity-encrypted-oracle.js";
import { runQueryIdentityEvidenceCli } from "./query-identity-evidence-cli.js";
import type { QueryIdentityLaunchReceipt } from "./query-identity-launch.js";
import type { QueryIdentityOracle } from "./query-identity-oracle.js";

describe("query identity evidence CLI encrypted oracle flow", () => {
	it("atomically emits an envelope/key pair and verifies it against a launch binding", () => {
		const directory = mkdtempSync(
			join(tmpdir(), "query-identity-encrypted-cli-"),
		);
		const oracle: QueryIdentityOracle = {
			schemaVersion: "naia-memory-query-identity-oracle-v1",
			construction: "independent-native-reviewed",
			cases: [],
		};
		const oraclePath = join(directory, "oracle-input.json");
		const encryptedDirectory = join(directory, "encrypted");
		writeFileSync(oraclePath, JSON.stringify(oracle));
		runQueryIdentityEvidenceCli([
			"encrypt-oracle",
			oraclePath,
			encryptedDirectory,
		]);
		const envelopePath = join(
			encryptedDirectory,
			"encrypted-oracle-envelope.json",
		);
		const releaseKeyPath = join(encryptedDirectory, "oracle-release-key.json");
		const envelope = JSON.parse(
			readFileSync(envelopePath, "utf8"),
		) as QueryIdentityEncryptedOracleEnvelope;
		const launchReceiptPath = join(directory, "launch-receipt.json");
		writeFileSync(
			launchReceiptPath,
			JSON.stringify({
				encryptedOracleEnvelopeSha256: evidenceObjectSha256(envelope),
			} satisfies Partial<QueryIdentityLaunchReceipt>),
		);
		const recoveredPath = join(directory, "oracle-recovered.json");
		runQueryIdentityEvidenceCli([
			"verify-oracle-release",
			envelopePath,
			releaseKeyPath,
			launchReceiptPath,
			recoveredPath,
		]);
		expect(JSON.parse(readFileSync(recoveredPath, "utf8"))).toEqual(oracle);
		expect(() =>
			runQueryIdentityEvidenceCli([
				"encrypt-oracle",
				oraclePath,
				encryptedDirectory,
			]),
		).toThrow("output already exists");
	});
});
