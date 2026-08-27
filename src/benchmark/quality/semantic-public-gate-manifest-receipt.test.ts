import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Rfc3161CommandRunner } from "./rfc3161-timestamp.js";
import {
	semanticPublicGateManifestSigningPayload,
	semanticPublicGateSignerKeySha256,
	validateSemanticPublicGateManifestReceipt,
} from "./semantic-public-gate-manifest-receipt.js";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((path) => rm(path, { recursive: true })),
	);
});

function fixture() {
	const directory = mkdtempSync(join(tmpdir(), "manifest-receipt-"));
	directories.push(directory);
	const manifestPath = join(directory, "manifest.json");
	const receiptPath = join(directory, "receipt.json");
	const tokenPath = join(directory, "token.tsr");
	const caPath = join(directory, "ca.pem");
	const manifestBytes = Buffer.from('{"manifest":"exact bytes"}\n');
	const token = Buffer.from("timestamp token");
	const ca = Buffer.from("trusted ca");
	writeFileSync(manifestPath, manifestBytes);
	writeFileSync(tokenPath, token);
	writeFileSync(caPath, ca);
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	const publicKeyPem = publicKey
		.export({ type: "spki", format: "pem" })
		.toString();
	const unsigned = {
		schemaVersion:
			"naia-memory-semantic-public-gate-manifest-receipt-v1" as const,
		manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
		signerId: "publisher@example.test",
		signerKeySha256: semanticPublicGateSignerKeySha256(publicKeyPem),
	};
	const receipt = {
		...unsigned,
		signatureBase64: sign(
			null,
			semanticPublicGateManifestSigningPayload(unsigned),
			privateKey,
		).toString("base64"),
	};
	const receiptBytes = Buffer.from(`${JSON.stringify(receipt)}\n`);
	writeFileSync(receiptPath, receiptBytes);
	const runner: Rfc3161CommandRunner = (args) =>
		args.includes("-verify")
			? { status: 0, stdout: "Verification: OK", stderr: "" }
			: {
					status: 0,
					stdout: "Policy OID: 1.2.3.4\nTime stamp: Aug 22 12:00:00 2026 GMT\n",
					stderr: "",
				};
	return {
		expectedManifestSha256: unsigned.manifestSha256,
		manifestPath,
		receiptPath,
		signerTrustPolicy: {
			schemaVersion:
				"naia-memory-semantic-public-gate-manifest-signer-trust-policy-v1" as const,
			signers: {
				[receipt.signerId]: {
					publicKey: publicKeyPem,
					notBefore: "2026-08-01T00:00:00.000Z",
					notAfter: "2026-09-01T00:00:00.000Z",
				},
			},
		},
		timestampEvidence: {
			schemaVersion:
				"naia-memory-rfc3161-digest-timestamp-evidence-v1" as const,
			artifactSha256: createHash("sha256").update(receiptBytes).digest("hex"),
			tokenSha256: createHash("sha256").update(token).digest("hex"),
			tokenPath,
		},
		timestampTrustPolicy: {
			schemaVersion: "naia-memory-rfc3161-timestamp-trust-policy-v1" as const,
			trustedCaFilePath: caPath,
			trustedCaFileSha256: createHash("sha256").update(ca).digest("hex"),
			requiredPolicyOid: "1.2.3.4",
		},
		runner,
		receipt,
	};
}

describe("semantic public gate manifest receipt", () => {
	it("binds exact manifest bytes, signer key, receipt bytes, and TSA time", async () => {
		const current = fixture();
		await expect(
			validateSemanticPublicGateManifestReceipt({
				...current,
				commandRunner: current.runner,
			}),
		).resolves.toMatchObject({ signerId: current.receipt.signerId });
	});

	it("rejects manifest substitution", async () => {
		const current = fixture();
		current.expectedManifestSha256 = createHash("sha256")
			.update("changed")
			.digest("hex");
		await expect(
			validateSemanticPublicGateManifestReceipt({
				...current,
				commandRunner: current.runner,
			}),
		).rejects.toThrow("receipt binding is invalid");
	});

	it("rejects receipt substitution even when the signature remains valid", async () => {
		const current = fixture();
		writeFileSync(
			current.receiptPath,
			`${JSON.stringify(current.receipt, null, 2)}\n`,
		);
		await expect(
			validateSemanticPublicGateManifestReceipt({
				...current,
				commandRunner: current.runner,
			}),
		).rejects.toThrow("timestamp artifact hash mismatch");
	});

	it("rejects a TSA time outside the signer key validity window", async () => {
		const current = fixture();
		current.signerTrustPolicy.signers[current.receipt.signerId].notAfter =
			"2026-08-22T11:59:59.000Z";
		await expect(
			validateSemanticPublicGateManifestReceipt({
				...current,
				commandRunner: current.runner,
			}),
		).rejects.toThrow("was not valid at TSA time");
	});
});
