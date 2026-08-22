import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	FULL_CORPUS_ATTESTATION_ARTIFACT_NAMES,
	loadFullCorpusAttestationBundle,
} from "./native-full-corpus-attestation-bundle.js";
import { runFullCorpusAttestationCli } from "./native-full-corpus-attestation-cli.js";

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
