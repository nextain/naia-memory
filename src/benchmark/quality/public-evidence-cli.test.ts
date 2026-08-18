import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluatePublicEvidenceBundle } from "./public-evidence-cli.js";
import {
	trustPolicy,
	validManifest,
	writeValidEvidence,
} from "./public-evidence-fixture.js";

const roots: string[] = [];

async function root(): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), "naia-public-intake-"));
	roots.push(path);
	return path;
}

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("public evidence bundle intake", () => {
	it("evaluates a complete external bundle from file paths", async () => {
		const evidenceRoot = await root();
		const verifierRoot = await root();
		const manifest = validManifest();
		await writeValidEvidence(evidenceRoot, manifest);
		await writeFile(
			join(evidenceRoot, "manifest.json"),
			JSON.stringify(manifest),
		);
		await writeFile(
			join(verifierRoot, "verifier-trust.json"),
			JSON.stringify(trustPolicy),
		);

		expect(
			await evaluatePublicEvidenceBundle(
				join(evidenceRoot, "manifest.json"),
				join(verifierRoot, "verifier-trust.json"),
			),
		).toEqual({ promotable: true, failures: [] });
	});

	it("fails closed for malformed verifier trust instead of throwing", async () => {
		const evidenceRoot = await root();
		const verifierRoot = await root();
		await writeFile(
			join(evidenceRoot, "manifest.json"),
			JSON.stringify(validManifest()),
		);
		await writeFile(
			join(verifierRoot, "verifier-trust.json"),
			JSON.stringify({ enginePublicKeys: [] }),
		);

		const result = await evaluatePublicEvidenceBundle(
			join(evidenceRoot, "manifest.json"),
			join(verifierRoot, "verifier-trust.json"),
		);
		expect(result).toEqual({
			promotable: false,
			failures: ["trust policy shape is invalid"],
		});
	});

	it("rejects malformed verifier public keys during intake", async () => {
		const evidenceRoot = await root();
		const verifierRoot = await root();
		await writeFile(
			join(evidenceRoot, "manifest.json"),
			JSON.stringify(validManifest()),
		);
		await writeFile(
			join(verifierRoot, "verifier-trust.json"),
			JSON.stringify({
				...trustPolicy,
				publisherPublicKeys: { "nextain-release": "not-a-public-key" },
			}),
		);

		expect(
			await evaluatePublicEvidenceBundle(
				join(evidenceRoot, "manifest.json"),
				join(verifierRoot, "verifier-trust.json"),
			),
		).toEqual({
			promotable: false,
			failures: ["trust policy shape is invalid"],
		});
	});

	it("reports unreadable and malformed intake files deterministically", async () => {
		const evidenceRoot = await root();
		const verifierRoot = await root();
		const trustPath = join(verifierRoot, "verifier-trust.json");
		await writeFile(trustPath, "{");

		expect(
			await evaluatePublicEvidenceBundle(
				join(evidenceRoot, "missing.json"),
				trustPath,
			),
		).toEqual({ promotable: false, failures: ["manifest is unreadable"] });
	});

	it("rejects a submitted or symlinked trust policy inside the bundle", async () => {
		const evidenceRoot = await root();
		const verifierRoot = await root();
		const manifest = validManifest();
		await writeValidEvidence(evidenceRoot, manifest);
		await writeFile(
			join(evidenceRoot, "manifest.json"),
			JSON.stringify(manifest),
		);
		await writeFile(
			join(evidenceRoot, "self-trust.json"),
			JSON.stringify(trustPolicy),
		);
		await symlink(
			join(evidenceRoot, "self-trust.json"),
			join(verifierRoot, "verifier-trust.json"),
		);

		expect(
			await evaluatePublicEvidenceBundle(
				join(evidenceRoot, "manifest.json"),
				join(verifierRoot, "verifier-trust.json"),
			),
		).toEqual({
			promotable: false,
			failures: ["trust policy must be outside the submitted evidence root"],
		});
	});

	it("rejects dot-prefixed in-root trust paths and oversized intake", async () => {
		const evidenceRoot = await root();
		const verifierRoot = await root();
		await writeFile(
			join(evidenceRoot, "manifest.json"),
			JSON.stringify(validManifest()),
		);
		await writeFile(
			join(evidenceRoot, "..self-trust.json"),
			JSON.stringify(trustPolicy),
		);
		expect(
			await evaluatePublicEvidenceBundle(
				join(evidenceRoot, "manifest.json"),
				join(evidenceRoot, "..self-trust.json"),
			),
		).toEqual({
			promotable: false,
			failures: ["trust policy must be outside the submitted evidence root"],
		});

		const oversizedTrust = join(verifierRoot, "oversized-trust.json");
		await writeFile(oversizedTrust, " ".repeat(1024 * 1024 + 1));
		expect(
			await evaluatePublicEvidenceBundle(
				join(evidenceRoot, "manifest.json"),
				oversizedTrust,
			),
		).toEqual({
			promotable: false,
			failures: ["trust policy exceeds the 1 MiB intake limit"],
		});
	});
});
