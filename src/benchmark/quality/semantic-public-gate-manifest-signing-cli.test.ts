import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateSemanticPublicGateManifestReceipt } from "./semantic-public-gate-manifest-receipt.js";
import { runSemanticPublicGateManifestSigningCli } from "./semantic-public-gate-manifest-signing-cli.js";
import { buildSemanticPublicGateManifestSigningPacket } from "./semantic-public-gate-manifest-signing.js";

const directories: string[] = [];

function directory(): string {
	const value = mkdtempSync(join(tmpdir(), "naia-manifest-signing-"));
	directories.push(value);
	return value;
}

afterEach(() => {
	vi.restoreAllMocks();
	for (const path of directories.splice(0)) rmSync(path, { recursive: true });
});

function fixture() {
	const root = directory();
	const keys = generateKeyPairSync("ed25519");
	const policy = {
		schemaVersion:
			"naia-memory-semantic-public-gate-manifest-signer-trust-policy-v1",
		signers: {
			publisher: {
				publicKey: keys.publicKey
					.export({ type: "spki", format: "pem" })
					.toString(),
				notBefore: "2026-08-01T00:00:00.000Z",
				notAfter: "2026-09-01T00:00:00.000Z",
			},
		},
	};
	const manifestPath = join(root, "manifest.json");
	const policyPath = join(root, "policy.json");
	writeFileSync(manifestPath, '{"schemaVersion":"test"}\n');
	writeFileSync(policyPath, JSON.stringify(policy));
	return { root, keys, manifestPath, policyPath };
}

describe("semantic public gate manifest signing CLI", () => {
	it("creates an offline packet and exclusively collects its receipt", async () => {
		const current = fixture();
		let stdout = "";
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		vi.spyOn(process.stdout, "write").mockImplementation((value) => {
			stdout += String(value);
			return true;
		});
		expect(
			await runSemanticPublicGateManifestSigningCli([
				"packet",
				current.manifestPath,
				current.policyPath,
				"publisher",
			]),
		).toBe(0);
		const packet = JSON.parse(stdout);
		const packetPath = join(current.root, "packet.json");
		const signaturePath = join(current.root, "signature.json");
		const receiptPath = join(current.root, "receipt.json");
		writeFileSync(packetPath, JSON.stringify(packet));
		writeFileSync(
			signaturePath,
			JSON.stringify({
				schemaVersion:
					"naia-memory-semantic-public-gate-manifest-detached-signature-v1",
				packetSha256: packet.packetSha256,
				signatureBase64: sign(
					null,
					Buffer.from(packet.signingPayloadBase64, "base64"),
					current.keys.privateKey,
				).toString("base64"),
			}),
		);
		stdout = "";
		const collectArgs = [
			"collect",
			packetPath,
			signaturePath,
			current.policyPath,
			receiptPath,
		];
		expect(await runSemanticPublicGateManifestSigningCli(collectArgs)).toBe(0);
		const receiptSha256 = JSON.parse(stdout).receiptSha256;
		expect(receiptSha256).toMatch(/^[a-f0-9]{64}$/u);
		expect(JSON.parse(readFileSync(receiptPath, "utf8"))).toMatchObject({
			manifestSha256: packet.manifestSha256,
			signerId: "publisher",
		});
		const tokenPath = join(current.root, "timestamp.tsr");
		const caPath = join(current.root, "tsa-ca.pem");
		writeFileSync(tokenPath, "timestamp token");
		writeFileSync(caPath, "trusted ca");
		await expect(
			validateSemanticPublicGateManifestReceipt({
				expectedManifestSha256: packet.manifestSha256,
				receiptPath,
				signerTrustPolicy: JSON.parse(readFileSync(current.policyPath, "utf8")),
				timestampEvidence: {
					schemaVersion: "naia-memory-rfc3161-digest-timestamp-evidence-v1",
					artifactSha256: receiptSha256,
					tokenSha256: createHash("sha256")
						.update("timestamp token")
						.digest("hex"),
					tokenPath,
				},
				timestampTrustPolicy: {
					schemaVersion: "naia-memory-rfc3161-timestamp-trust-policy-v1",
					trustedCaFilePath: caPath,
					trustedCaFileSha256: createHash("sha256")
						.update("trusted ca")
						.digest("hex"),
					requiredPolicyOid: "1.2.3.4",
				},
				commandRunner: (args) =>
					args.includes("-verify")
						? { status: 0, stdout: "Verification: OK", stderr: "" }
						: {
								status: 0,
								stdout:
									"Policy OID: 1.2.3.4\nTime stamp: Aug 22 12:00:00 2026 GMT\n",
								stderr: "",
							},
			}),
		).resolves.toMatchObject({
			receiptSha256,
			trustedTimestampVerified: true,
		});
		expect(await runSemanticPublicGateManifestSigningCli(collectArgs)).toBe(1);
	});

	it("refuses a final-component symlink manifest", async () => {
		const current = fixture();
		const link = join(current.root, "manifest-link.json");
		symlinkSync(current.manifestPath, link);
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		expect(
			await runSemanticPublicGateManifestSigningCli([
				"packet",
				link,
				current.policyPath,
				"publisher",
			]),
		).toBe(1);
	});

	it("refuses symlinked collection input and output paths", async () => {
		const current = fixture();
		const policy = JSON.parse(readFileSync(current.policyPath, "utf8"));
		const packet = buildSemanticPublicGateManifestSigningPacket({
			manifestSha256: "a".repeat(64),
			signerId: "publisher",
			trustPolicy: policy,
		});
		const packetTarget = join(current.root, "packet-target.json");
		const packetLink = join(current.root, "packet-link.json");
		const signaturePath = join(current.root, "signature.json");
		const receiptTarget = join(current.root, "receipt-target.json");
		const receiptLink = join(current.root, "receipt-link.json");
		writeFileSync(packetTarget, JSON.stringify(packet));
		writeFileSync(
			signaturePath,
			JSON.stringify({
				schemaVersion:
					"naia-memory-semantic-public-gate-manifest-detached-signature-v1",
				packetSha256: packet.packetSha256,
				signatureBase64: sign(
					null,
					Buffer.from(packet.signingPayloadBase64, "base64"),
					current.keys.privateKey,
				).toString("base64"),
			}),
		);
		writeFileSync(receiptTarget, "do not replace");
		symlinkSync(packetTarget, packetLink);
		symlinkSync(receiptTarget, receiptLink);
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		expect(
			await runSemanticPublicGateManifestSigningCli([
				"collect",
				packetLink,
				signaturePath,
				current.policyPath,
				join(current.root, "unused.json"),
			]),
		).toBe(1);
		expect(
			await runSemanticPublicGateManifestSigningCli([
				"collect",
				packetTarget,
				signaturePath,
				current.policyPath,
				receiptLink,
			]),
		).toBe(1);
		expect(readFileSync(receiptTarget, "utf8")).toBe("do not replace");
	});
});
