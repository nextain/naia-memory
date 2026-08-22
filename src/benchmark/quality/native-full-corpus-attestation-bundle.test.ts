import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	FULL_CORPUS_ATTESTATION_ARTIFACT_NAMES,
	loadFullCorpusAttestationBundle,
} from "./native-full-corpus-attestation-bundle.js";
import { runFullCorpusAttestationCli } from "./native-full-corpus-attestation-cli.js";
import {
	buildFullCorpusBundleSigningPacket,
	collectFullCorpusBundleSignature,
} from "./native-full-corpus-bundle-publication.js";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true })),
	);
});

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "naia-miracl-attestation-bundle-"));
	roots.push(root);
	const artifacts: Record<string, { path: string; sha256: string }> = {};
	for (const name of FULL_CORPUS_ATTESTATION_ARTIFACT_NAMES) {
		const path = `${name}.json`;
		const bytes = Buffer.from(JSON.stringify({ name }));
		await writeFile(join(root, path), bytes);
		artifacts[name] = {
			path,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		};
	}
	const manifest = {
		schemaVersion: "naia-memory-full-corpus-attestation-bundle-v1",
		artifacts,
	};
	const manifestPath = join(root, "bundle.json");
	await writeFile(manifestPath, JSON.stringify(manifest));
	return { root, manifest, manifestPath };
}

describe("full-corpus attestation bundle", () => {
	it("loads one hash-bound, ordered portable verification bundle", async () => {
		const current = await fixture();
		const loaded = await loadFullCorpusAttestationBundle(current.manifestPath);

		expect(loaded.manifestSha256).toMatch(/^[a-f0-9]{64}$/u);
		expect(
			loaded.artifacts.map((artifact) => basename(artifact.absolutePath)),
		).toEqual(
			FULL_CORPUS_ATTESTATION_ARTIFACT_NAMES.map((name) => `${name}.json`),
		);
		expect(
			loaded.artifacts.map((artifact) => artifact.bytes.toString("utf8")),
		).toEqual(
			FULL_CORPUS_ATTESTATION_ARTIFACT_NAMES.map((name) =>
				JSON.stringify({ name }),
			),
		);
	});

	it("rejects artifact substitution", async () => {
		const current = await fixture();
		await writeFile(join(current.root, "challenge.json"), "substituted");

		await expect(
			loadFullCorpusAttestationBundle(current.manifestPath),
		).rejects.toThrow("artifact challenge hash mismatch");
	});

	it("routes the ordered bundle through the timestamped CLI verifier", async () => {
		const current = await fixture();
		const output: string[] = [];
		vi.spyOn(process.stdout, "write").mockImplementation((value) => {
			output.push(String(value));
			return true;
		});

		try {
			expect(
				await runFullCorpusAttestationCli([
					"verify-bundle",
					current.manifestPath,
				]),
			).toBe(1);
			expect(JSON.parse(output.pop() ?? "{}").failure).toBe(
				"challenge shape is invalid",
			);
		} finally {
			vi.restoreAllMocks();
		}
	});

	it("requires and verifies external publication trust before bundle contents", async () => {
		const current = await fixture();
		const loaded = await loadFullCorpusAttestationBundle(current.manifestPath);
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
			manifestSha256: loaded.manifestSha256,
			signerId: "publisher",
			trustPolicy,
		});
		const receipt = collectFullCorpusBundleSignature({
			packet,
			detachedSignature: {
				schemaVersion: "naia-memory-full-corpus-bundle-detached-signature-v1",
				packetSha256: packet.packetSha256,
				signatureBase64: sign(
					null,
					Buffer.from(packet.signingPayloadBase64, "base64"),
					keys.privateKey,
				).toString("base64"),
			},
			trustPolicy,
		});
		const receiptBytes = Buffer.from(`${JSON.stringify(receipt)}\n`);
		const token = Buffer.from("publication timestamp token");
		const ca = Buffer.from("external publication tsa ca");
		const paths = {
			receipt: join(current.root, "publication-receipt.json"),
			signerPolicy: join(current.root, "external-signer-policy.json"),
			timestamp: join(current.root, "publication-timestamp.json"),
			timestampPolicy: join(current.root, "external-timestamp-policy.json"),
			token: join(current.root, "publication-token.tsr"),
			ca: join(current.root, "external-publication-ca.pem"),
		};
		await Promise.all([
			writeFile(paths.receipt, receiptBytes),
			writeFile(paths.signerPolicy, JSON.stringify(trustPolicy)),
			writeFile(
				paths.timestamp,
				JSON.stringify({
					schemaVersion: "naia-memory-rfc3161-digest-timestamp-evidence-v1",
					artifactSha256: createHash("sha256")
						.update(receiptBytes)
						.digest("hex"),
					tokenSha256: createHash("sha256").update(token).digest("hex"),
					tokenPath: "/producer/path/not-present.tsr",
				}),
			),
			writeFile(
				paths.timestampPolicy,
				JSON.stringify({
					schemaVersion: "naia-memory-rfc3161-timestamp-trust-policy-v1",
					trustedCaFilePath: "/producer/path/not-present.pem",
					trustedCaFileSha256: createHash("sha256").update(ca).digest("hex"),
					requiredPolicyOid: "1.2.3.4",
				}),
			),
			writeFile(paths.token, token),
			writeFile(paths.ca, ca),
		]);
		const output: string[] = [];
		vi.spyOn(process.stdout, "write").mockImplementation((value) => {
			output.push(String(value));
			return true;
		});
		try {
			expect(
				await runFullCorpusAttestationCli(
					[
						"verify-published-bundle",
						current.manifestPath,
						paths.receipt,
						paths.signerPolicy,
						paths.timestamp,
						paths.timestampPolicy,
						paths.token,
						paths.ca,
					],
					{
						timestampCommandRunner: (args) =>
							args.includes("-verify")
								? { status: 0, stdout: "Verification: OK", stderr: "" }
								: {
										status: 0,
										stdout:
											"Policy OID: 1.2.3.4\nTime stamp: Aug 22 12:00:00 2026 GMT\n",
										stderr: "",
									},
					},
				),
			).toBe(1);
			expect(JSON.parse(output.pop() ?? "{}").failure).toBe(
				"challenge shape is invalid",
			);
		} finally {
			vi.restoreAllMocks();
		}
	});

	it("creates an offline publication packet and exclusively collects its receipt", async () => {
		const current = await fixture();
		const loaded = await loadFullCorpusAttestationBundle(current.manifestPath);
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
		const policyPath = join(current.root, "external-signer-policy.json");
		await writeFile(policyPath, JSON.stringify(trustPolicy));
		let stdout = "";
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		vi.spyOn(process.stdout, "write").mockImplementation((value) => {
			stdout += String(value);
			return true;
		});
		expect(
			await runFullCorpusAttestationCli([
				"publish-packet",
				current.manifestPath,
				policyPath,
				"publisher",
			]),
		).toBe(0);
		const packet = JSON.parse(stdout);
		expect(packet.manifestSha256).toBe(loaded.manifestSha256);
		const packetPath = join(current.root, "packet.json");
		const signaturePath = join(current.root, "signature.json");
		const receiptPath = join(current.root, "publication-receipt.json");
		await Promise.all([
			writeFile(packetPath, JSON.stringify(packet)),
			writeFile(
				signaturePath,
				JSON.stringify({
					schemaVersion: "naia-memory-full-corpus-bundle-detached-signature-v1",
					packetSha256: packet.packetSha256,
					signatureBase64: sign(
						null,
						Buffer.from(packet.signingPayloadBase64, "base64"),
						keys.privateKey,
					).toString("base64"),
				}),
			),
		]);
		stdout = "";
		const collectArgs = [
			"publish-collect",
			packetPath,
			signaturePath,
			policyPath,
			receiptPath,
		];
		expect(await runFullCorpusAttestationCli(collectArgs)).toBe(0);
		const receiptBytes = await readFile(receiptPath);
		expect(JSON.parse(stdout).receiptSha256).toBe(
			createHash("sha256").update(receiptBytes).digest("hex"),
		);
		expect(JSON.parse(receiptBytes.toString("utf8"))).toMatchObject({
			manifestSha256: loaded.manifestSha256,
			signerId: "publisher",
		});
		expect(await runFullCorpusAttestationCli(collectArgs)).toBe(1);
	});

	it("refuses symlinked publication inputs and outputs", async () => {
		const current = await fixture();
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
		const loaded = await loadFullCorpusAttestationBundle(current.manifestPath);
		const packet = buildFullCorpusBundleSigningPacket({
			manifestSha256: loaded.manifestSha256,
			signerId: "publisher",
			trustPolicy,
		});
		const paths = {
			policy: join(current.root, "policy.json"),
			packet: join(current.root, "packet.json"),
			packetLink: join(current.root, "packet-link.json"),
			signature: join(current.root, "signature.json"),
			receiptTarget: join(current.root, "receipt-target.json"),
			receiptLink: join(current.root, "receipt-link.json"),
		};
		await Promise.all([
			writeFile(paths.policy, JSON.stringify(trustPolicy)),
			writeFile(paths.packet, JSON.stringify(packet)),
			writeFile(
				paths.signature,
				JSON.stringify({
					schemaVersion: "naia-memory-full-corpus-bundle-detached-signature-v1",
					packetSha256: packet.packetSha256,
					signatureBase64: sign(
						null,
						Buffer.from(packet.signingPayloadBase64, "base64"),
						keys.privateKey,
					).toString("base64"),
				}),
			),
			writeFile(paths.receiptTarget, "do not replace"),
		]);
		await Promise.all([
			symlink(paths.packet, paths.packetLink),
			symlink(paths.receiptTarget, paths.receiptLink),
		]);
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		expect(
			await runFullCorpusAttestationCli([
				"publish-collect",
				paths.packetLink,
				paths.signature,
				paths.policy,
				join(current.root, "unused.json"),
			]),
		).toBe(1);
		expect(
			await runFullCorpusAttestationCli([
				"publish-collect",
				paths.packet,
				paths.signature,
				paths.policy,
				paths.receiptLink,
			]),
		).toBe(1);
		expect((await readFile(paths.receiptTarget)).toString("utf8")).toBe(
			"do not replace",
		);
	});

	it("refuses publication signing inputs larger than 64 KiB", async () => {
		const current = await fixture();
		const paths = {
			packet: join(current.root, "oversized-packet.json"),
			signature: join(current.root, "signature.json"),
			policy: join(current.root, "policy.json"),
			receipt: join(current.root, "oversized-publication-receipt.json"),
		};
		await Promise.all([
			writeFile(paths.packet, Buffer.alloc(64 * 1024 + 1, 0x20)),
			writeFile(paths.signature, "{}"),
			writeFile(paths.policy, "{}"),
		]);
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);

		expect(
			await runFullCorpusAttestationCli([
				"publish-collect",
				paths.packet,
				paths.signature,
				paths.policy,
				paths.receipt,
			]),
		).toBe(1);
		await expect(readFile(paths.receipt)).rejects.toThrow();
	});

	it("rejects path escape and unknown artifact fields", async () => {
		const current = await fixture();
		current.manifest.artifacts.receipt.path = "../receipt.json";
		await writeFile(current.manifestPath, JSON.stringify(current.manifest));
		await expect(
			loadFullCorpusAttestationBundle(current.manifestPath),
		).rejects.toThrow("artifact path escapes bundle");

		const second = await fixture();
		const receipt = second.manifest.artifacts.receipt as Record<string, string>;
		receipt.unexpected = "field";
		await writeFile(second.manifestPath, JSON.stringify(second.manifest));
		await expect(
			loadFullCorpusAttestationBundle(second.manifestPath),
		).rejects.toThrow("unexpected: unexpected");
	});

	it("rejects a symbolic-link escape", async () => {
		const current = await fixture();
		const outside = await mkdtemp(join(tmpdir(), "naia-miracl-outside-"));
		roots.push(outside);
		const outsidePath = join(outside, "challenge.json");
		await writeFile(outsidePath, JSON.stringify({ name: "challenge" }));
		await rm(join(current.root, "challenge.json"));
		await symlink(outsidePath, join(current.root, "challenge.json"));

		await expect(
			loadFullCorpusAttestationBundle(current.manifestPath),
		).rejects.toThrow("escapes bundle through a symbolic link");
	});
});
