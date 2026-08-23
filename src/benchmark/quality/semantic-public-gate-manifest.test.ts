import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	SEMANTIC_PUBLIC_GATE_ARTIFACT_NAMES,
	SEMANTIC_PUBLIC_GATE_BLINDING_SEED_INDEX,
	loadSemanticPublicGateManifest,
} from "./semantic-public-gate-manifest.js";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "naia-public-gate-manifest-"));
	roots.push(directory);
	const artifacts: Record<string, { path: string; sha256: string }> = {};
	for (const name of SEMANTIC_PUBLIC_GATE_ARTIFACT_NAMES) {
		const path = `${name}.json`;
		const bytes = Buffer.from(JSON.stringify({ name }));
		await writeFile(join(directory, path), bytes);
		artifacts[name] = {
			path,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		};
	}
	const manifest = {
		schemaVersion: "naia-memory-semantic-public-gate-manifest-v4",
		blindingSeed: "frozen-seed",
		artifacts,
	};
	const manifestPath = join(directory, "manifest.json");
	await writeFile(manifestPath, JSON.stringify(manifest));
	return { directory, manifest, manifestPath };
}

describe("semantic public gate manifest", () => {
	it("resolves one hash-pinned manifest into the canonical 34 arguments", async () => {
		const current = await fixture();
		const loaded = await loadSemanticPublicGateManifest(current.manifestPath);
		expect(loaded.args).toHaveLength(34);
		expect(loaded.args[SEMANTIC_PUBLIC_GATE_BLINDING_SEED_INDEX]).toBe(
			"frozen-seed",
		);
		const expectedNames = [
			"contract",
			"attestations",
			"trustPolicy",
			"campaign",
			"executionEvidence",
			"executionTrustPolicy",
			"blindPacket",
			"blindSeal",
			"judgments",
			"adjudicationEvidence",
			"adjudicationTrustPolicy",
			"analysisPlan",
			"analysisPlanTrustPolicy",
			"pilotCollectionPlan",
			"pilotContract",
			"sampleSizeAssumptions",
			"powerReview",
			"powerReviewTrustPolicy",
			"planTimestampEvidence",
			"planTimestampTrustPolicy",
			"pilotLaunchReceipt",
			"deliveryAcknowledgements",
			"participantTrustPolicy",
			"deliveryTimestampEvidence",
			"deliveryTimestampTrustPolicy",
			"selectionDisclosure",
			"selectionDisclosureTrustPolicy",
			"developmentExecutionEvidence",
			"developmentExecutionTrustPolicy",
			"developmentPlanTimestampEvidence",
			"developmentPlanTimestampTrustPolicy",
			"developmentExecutionRegistry",
			"developmentExecutionRegistryTrustPolicy",
		];
		expect(SEMANTIC_PUBLIC_GATE_ARTIFACT_NAMES).toEqual(expectedNames);
		expect(loaded.args.filter((_, index) => index !== 11)).toEqual(
			expectedNames.map((name) => join(current.directory, `${name}.json`)),
		);
	});

	it("rejects hash substitution, path escape, and unknown fields", async () => {
		const hashMismatch = await fixture();
		hashMismatch.manifest.artifacts.contract.sha256 = "0".repeat(64);
		await writeFile(
			hashMismatch.manifestPath,
			JSON.stringify(hashMismatch.manifest),
		);
		await expect(
			loadSemanticPublicGateManifest(hashMismatch.manifestPath),
		).rejects.toThrow("contract hash mismatch");

		const escaped = await fixture();
		escaped.manifest.artifacts.contract.path = "../contract.json";
		await writeFile(escaped.manifestPath, JSON.stringify(escaped.manifest));
		await expect(
			loadSemanticPublicGateManifest(escaped.manifestPath),
		).rejects.toThrow("escapes manifest directory");

		const extra = await fixture();
		await writeFile(
			extra.manifestPath,
			JSON.stringify({ ...extra.manifest, unexpected: true }),
		);
		await expect(
			loadSemanticPublicGateManifest(extra.manifestPath),
		).rejects.toThrow("manifest fields are invalid");
	});

	it("rejects v3 with an actionable v4 migration error", async () => {
		const current = await fixture();
		current.manifest.schemaVersion =
			"naia-memory-semantic-public-gate-manifest-v3";
		await writeFile(current.manifestPath, JSON.stringify(current.manifest));
		await expect(
			loadSemanticPublicGateManifest(current.manifestPath),
		).rejects.toThrow(
			"manifest v3 must be regenerated as v4 with development execution registry artifacts",
		);
	});

	it("rejects an intermediate symbolic-link escape", async () => {
		const current = await fixture();
		const outside = await mkdtemp(join(tmpdir(), "naia-public-gate-outside-"));
		roots.push(outside);
		await writeFile(
			join(outside, "contract.json"),
			JSON.stringify({ name: "contract" }),
		);
		await mkdir(join(current.directory, "links"));
		await symlink(outside, join(current.directory, "links", "outside"));
		current.manifest.artifacts.contract.path = "links/outside/contract.json";
		await writeFile(current.manifestPath, JSON.stringify(current.manifest));
		await expect(
			loadSemanticPublicGateManifest(current.manifestPath),
		).rejects.toThrow("through a symbolic link");
	});

	it("normalizes unreadable and oversized artifact failures", async () => {
		const missing = await fixture();
		missing.manifest.artifacts.contract.path = "host-secret.json";
		await writeFile(missing.manifestPath, JSON.stringify(missing.manifest));
		await expect(
			loadSemanticPublicGateManifest(missing.manifestPath),
		).rejects.toThrow("artifact contract is unreadable");

		const oversized = await fixture();
		const oversizedBytes = Buffer.alloc(16 * 1024 * 1024 + 1);
		await writeFile(join(oversized.directory, "contract.json"), oversizedBytes);
		oversized.manifest.artifacts.contract.sha256 = createHash("sha256")
			.update(oversizedBytes)
			.digest("hex");
		await writeFile(oversized.manifestPath, JSON.stringify(oversized.manifest));
		await expect(
			loadSemanticPublicGateManifest(oversized.manifestPath),
		).rejects.toThrow("artifact contract exceeds the 16 MiB intake limit");
	});
});
