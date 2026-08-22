import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runFullCorpusAttestationCli } from "./native-full-corpus-attestation-cli.js";
import { buildFullCorpusBundleSigningPacket } from "./native-full-corpus-bundle-publication.js";
import { canonicalEvidenceJson } from "./public-evidence-crypto.js";

function fixture() {
	const directory = mkdtempSync(join(tmpdir(), "naia-attestation-cli-"));
	const keys = generateKeyPairSync("ed25519");
	const trustPolicy = {
		schemaVersion:
			"naia-memory-full-corpus-bundle-signer-trust-policy-v1" as const,
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
	const packet = buildFullCorpusBundleSigningPacket({
		manifestSha256: createHash("sha256").update("manifest").digest("hex"),
		signerId: "publisher",
		trustPolicy,
	});
	const signature = {
		schemaVersion:
			"naia-memory-full-corpus-bundle-detached-signature-v1" as const,
		packetSha256: packet.packetSha256,
		signatureBase64: sign(
			null,
			Buffer.from(packet.signingPayloadBase64, "base64"),
			keys.privateKey,
		).toString("base64"),
	};
	const packetPath = join(directory, "packet.json");
	const signaturePath = join(directory, "signature.json");
	const policyPath = join(directory, "policy.json");
	writeFileSync(packetPath, JSON.stringify(packet));
	writeFileSync(signaturePath, JSON.stringify(signature));
	writeFileSync(policyPath, JSON.stringify(trustPolicy));
	return { directory, packetPath, signaturePath, policyPath };
}

describe("full-corpus attestation CLI", () => {
	it("durably collects canonical publication-receipt bytes", async () => {
		const current = fixture();
		const receiptPath = join(current.directory, "publication-receipt.json");
		const writes = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);

		expect(
			await runFullCorpusAttestationCli([
				"publish-collect",
				current.packetPath,
				current.signaturePath,
				current.policyPath,
				receiptPath,
			]),
		).toBe(0);
		const bytes = readFileSync(receiptPath);
		const receipt = JSON.parse(bytes.toString("utf8"));
		expect(bytes.toString("utf8")).toBe(`${canonicalEvidenceJson(receipt)}\n`);
		expect(JSON.parse(String(writes.mock.calls.at(-1)?.[0]))).toEqual({
			receiptSha256: createHash("sha256").update(bytes).digest("hex"),
		});
		writes.mockRestore();
	});

	it.each(["regular file", "symbolic link"])(
		"preserves an existing %s output",
		async (kind) => {
			const current = fixture();
			const receiptPath = join(current.directory, "publication-receipt.json");
			const protectedPath = join(current.directory, "protected.json");
			writeFileSync(protectedPath, "protected");
			if (kind === "symbolic link") symlinkSync(protectedPath, receiptPath);
			else writeFileSync(receiptPath, "existing");
			const writes = vi
				.spyOn(process.stdout, "write")
				.mockImplementation(() => true);

			expect(
				await runFullCorpusAttestationCli([
					"publish-collect",
					current.packetPath,
					current.signaturePath,
					current.policyPath,
					receiptPath,
				]),
			).toBe(1);
			expect(readFileSync(protectedPath, "utf8")).toBe("protected");
			if (kind === "regular file")
				expect(readFileSync(receiptPath, "utf8")).toBe("existing");
			expect(String(writes.mock.calls.at(-1)?.[0])).toContain(
				"bundle publication receipt output already exists",
			);
			writes.mockRestore();
		},
	);
});
