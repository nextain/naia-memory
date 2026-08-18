import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	datasetCases,
	engine,
	keys,
	receiptBytes,
	signed,
	trustPolicy,
	validManifest,
	writeValidEvidence,
} from "./public-evidence-fixture.js";
import {
	evaluatePublicEvidenceFiles,
	publicCaseJudgmentSha256,
	publicCaseOutputSha256,
	publicEvidenceScopeSha256,
	publicEvidenceSignaturePayload,
	summarizePublicCaseRecords,
	validatePublicEvidenceManifest,
} from "./public-evidence-gate.js";
import {
	PUBLIC_RETRIEVAL_SCORING_POLICY,
	PUBLIC_RETRIEVAL_SCORING_POLICY_ID,
} from "./public-retrieval-scorer.js";

describe("public evidence review attacks", () => {
	it("derives case and language counts from dataset contents and binds engine kind", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "naia-public-evidence-semantics-"),
		);
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const dataset = JSON.parse(
				await readFile(join(root, manifest.dataset.path), "utf8"),
			);
			dataset.cases[0].language = "en";
			const datasetBytes = JSON.stringify(dataset);
			await writeFile(join(root, manifest.dataset.path), datasetBytes);
			manifest.dataset.sha256 = createHash("sha256")
				.update(datasetBytes)
				.digest("hex");
			manifest.protocol.sameInputSha256 = manifest.dataset.sha256;
			for (const engine of manifest.engines) {
				engine.datasetSha256 = manifest.dataset.sha256;
				const receipt = JSON.parse(receiptBytes(manifest, engine));
				if (engine.kind === "naia") receipt.kind = "external";
				const bytes = JSON.stringify(receipt);
				await writeFile(join(root, engine.receiptPath), bytes);
				engine.receiptSha256 = createHash("sha256").update(bytes).digest("hex");
			}
			manifest.adversarialReview.evidenceScopeSha256 =
				publicEvidenceScopeSha256(manifest);
			const decision = await evaluatePublicEvidenceFiles(
				manifest,
				root,
				trustPolicy,
			);
			expect(decision.failures).toEqual(
				expect.arrayContaining([
					"dataset language counts mismatch",
					"naia: receipt engine kind mismatch",
				]),
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects a review artifact whose signed verdict was altered", async () => {
		const root = await mkdtemp(join(tmpdir(), "naia-public-evidence-review-"));
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const review = JSON.parse(
				await readFile(
					join(root, manifest.adversarialReview.artifactPath),
					"utf8",
				),
			);
			review.verdict = "BLOCK";
			const bytes = JSON.stringify(review);
			await writeFile(
				join(root, manifest.adversarialReview.artifactPath),
				bytes,
			);
			manifest.adversarialReview.artifactSha256 = createHash("sha256")
				.update(bytes)
				.digest("hex");
			expect(
				(await evaluatePublicEvidenceFiles(manifest, root, trustPolicy))
					.failures,
			).toContain("adversarial review verdict mismatch");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("binds the publication claim and provenance metadata into the review scope", () => {
		const manifest = validManifest();
		const originalScope = manifest.adversarialReview.evidenceScopeSha256;
		manifest.claim = "A different publication claim.";
		expect(publicEvidenceScopeSha256(manifest)).not.toBe(originalScope);
	});

	it("rejects an in-root symlink that resolves outside the evidence root", async () => {
		const root = await mkdtemp(join(tmpdir(), "naia-public-evidence-root-"));
		const outside = await mkdtemp(
			join(tmpdir(), "naia-public-evidence-outside-"),
		);
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const bytes = "external evidence";
			const digest = createHash("sha256").update(bytes).digest("hex");
			await writeFile(join(outside, "receipt.json"), bytes);
			await symlink(join(outside, "receipt.json"), join(root, "linked.json"));
			manifest.engines[0].receiptPath = "linked.json";
			manifest.engines[0].receiptSha256 = digest;
			expect(
				(await evaluatePublicEvidenceFiles(manifest, root, trustPolicy))
					.failures,
			).toContain("naia: receipt path escapes evidence root");
		} finally {
			await rm(root, { recursive: true, force: true });
			await rm(outside, { recursive: true, force: true });
		}
	});
});
