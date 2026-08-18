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

describe("public evidence receipt attacks", () => {
	it("rejects a review artifact signed by a key outside the verifier trust policy", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "naia-public-evidence-review-key-"),
		);
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const review = JSON.parse(
				await readFile(
					join(root, manifest.adversarialReview.artifactPath),
					"utf8",
				),
			);
			const attacker = generateKeyPairSync("ed25519");
			review.signatureBase64 = sign(
				null,
				publicEvidenceSignaturePayload(review),
				attacker.privateKey,
			).toString("base64");
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
			).toContain("adversarial review signature is untrusted or invalid");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("binds the dataset bytes and receipt claims to the manifest", async () => {
		const root = await mkdtemp(join(tmpdir(), "naia-public-evidence-binding-"));
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			await writeFile(join(root, manifest.dataset.path), "mutated dataset");
			const receipt = JSON.parse(
				await readFile(join(root, manifest.engines[0].receiptPath), "utf8"),
			);
			receipt.engine = "forged-naia";
			const forgedBytes = JSON.stringify(receipt);
			await writeFile(join(root, manifest.engines[0].receiptPath), forgedBytes);
			manifest.engines[0].receiptSha256 = createHash("sha256")
				.update(forgedBytes)
				.digest("hex");
			const decision = await evaluatePublicEvidenceFiles(
				manifest,
				root,
				trustPolicy,
			);
			expect(decision.failures).toEqual(
				expect.arrayContaining([
					"dataset content hash mismatch",
					"naia: receipt engine identity mismatch",
				]),
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("recomputes aggregates from complete per-case records and verifies implementation bytes", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "naia-public-evidence-recompute-"),
		);
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const target = manifest.engines[0];
			const receipt = JSON.parse(
				await readFile(join(root, target.receiptPath), "utf8"),
			);
			receipt.caseRecords.pop();
			receipt.primaryMetric.value = 1;
			target.primaryMetric.value = 1;
			const bytes = JSON.stringify(receipt);
			await writeFile(join(root, target.receiptPath), bytes);
			target.receiptSha256 = createHash("sha256").update(bytes).digest("hex");
			await writeFile(
				join(root, target.implementationArtifactPath),
				"substituted artifact",
			);
			const failures = (
				await evaluatePublicEvidenceFiles(manifest, root, trustPolicy)
			).failures;
			expect(failures).toEqual(
				expect.arrayContaining([
					"naia: receipt case coverage mismatch",
					"naia: receipt recomputed primary metric mismatch",
					"naia: implementation artifact content hash mismatch",
				]),
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("recomputes each language metric from its own case records", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "naia-public-evidence-language-recompute-"),
		);
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const target = manifest.engines[0];
			const receipt = JSON.parse(
				await readFile(join(root, target.receiptPath), "utf8"),
			);
			target.languagePrimaryMetrics.ko = { value: 0, ci95Low: 0, ci95High: 0 };
			receipt.languagePrimaryMetrics.ko = { value: 0, ci95Low: 0, ci95High: 0 };
			const bytes = JSON.stringify(receipt);
			await writeFile(join(root, target.receiptPath), bytes);
			target.receiptSha256 = createHash("sha256").update(bytes).digest("hex");

			const failures = (
				await evaluatePublicEvidenceFiles(manifest, root, trustPolicy)
			).failures;
			expect(failures).toContain(
				"naia: receipt recomputed ko language metric mismatch",
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects case outputs copied from another engine arm", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "naia-public-evidence-cross-arm-"),
		);
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const target = manifest.engines[0];
			const donor = JSON.parse(
				await readFile(join(root, manifest.engines[1].receiptPath), "utf8"),
			);
			const receipt = JSON.parse(
				await readFile(join(root, target.receiptPath), "utf8"),
			);
			receipt.caseRecords = donor.caseRecords;
			const bytes = JSON.stringify(receipt);
			await writeFile(join(root, target.receiptPath), bytes);
			target.receiptSha256 = createHash("sha256").update(bytes).digest("hex");
			expect(
				(await evaluatePublicEvidenceFiles(manifest, root, trustPolicy))
					.failures,
			).toContain("naia: receipt output hash is invalid");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("refuses to summarize empty or non-finite case evidence", () => {
		expect(() => summarizePublicCaseRecords([])).toThrow("finite scores");
		expect(() =>
			summarizePublicCaseRecords([
				{ caseId: "x", score: Number.NaN, failed: false } as never,
			]),
		).toThrow("finite scores");
	});
});
