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
	it("rejects publisher-asserted authorship without a trusted author signature", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "naia-public-provenance-author-"),
		);
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const path = join(root, manifest.dataset.provenancePath);
			const provenance = JSON.parse(await readFile(path, "utf8"));
			provenance.authors[0].signatureBase64 = "A".repeat(88);
			const bytes = JSON.stringify(provenance);
			await writeFile(path, bytes);
			manifest.dataset.provenanceSha256 = createHash("sha256")
				.update(bytes)
				.digest("hex");
			expect(
				(await evaluatePublicEvidenceFiles(manifest, root, trustPolicy))
					.failures,
			).toContain("author-1: author attestation is untrusted or invalid");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects a native review signature replayed for another language", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "naia-public-provenance-native-"),
		);
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const path = join(root, manifest.dataset.provenancePath);
			const provenance = JSON.parse(await readFile(path, "utf8"));
			provenance.nativeReviews[0].language = "en";
			const bytes = JSON.stringify(provenance);
			await writeFile(path, bytes);
			manifest.dataset.provenanceSha256 = createHash("sha256")
				.update(bytes)
				.digest("hex");
			const failures = (
				await evaluatePublicEvidenceFiles(manifest, root, trustPolicy)
			).failures;
			expect(failures).toEqual(
				expect.arrayContaining([
					"reviewer-ko: native review attestation is untrusted or invalid",
					"ko native review attestations do not match manifest",
					"en native review attestations do not match manifest",
				]),
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects a valid signature from a reviewer not trusted for that language", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "naia-public-provenance-language-scope-"),
		);
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const path = join(root, manifest.dataset.provenancePath);
			const provenance = JSON.parse(await readFile(path, "utf8"));
			const review = provenance.nativeReviews.find(
				(candidate: { language: string }) => candidate.language === "en",
			);
			review.reviewer = "reviewer-ko";
			review.signatureBase64 = sign(
				null,
				publicEvidenceSignaturePayload(review),
				keys["reviewer-ko"].privateKey,
			).toString("base64");
			const bytes = JSON.stringify(provenance);
			await writeFile(path, bytes);
			manifest.dataset.provenanceSha256 = createHash("sha256")
				.update(bytes)
				.digest("hex");
			const failures = (
				await evaluatePublicEvidenceFiles(manifest, root, trustPolicy)
			).failures;
			expect(failures).toContain(
				"reviewer-ko: native review attestation is untrusted or invalid",
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

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

	it("rejects duplicated benchmark inputs and answer IDs", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "naia-public-evidence-duplicate-cases-"),
		);
		try {
			const manifest = validManifest();
			const cases = datasetCases();
			cases[1].input = `  ${cases[0].input.normalize("NFKC")}  `;
			cases[1].inputSha256 = createHash("sha256")
				.update(cases[1].input)
				.digest("hex");
			cases[2].expected.push(cases[2].expected[0]);
			cases[3].forbidden?.push(cases[3].forbidden[0]);
			await writeValidEvidence(root, manifest, cases);
			const failures = (
				await evaluatePublicEvidenceFiles(manifest, root, trustPolicy)
			).failures;
			expect(failures).toEqual(
				expect.arrayContaining([
					"dataset case inputs are duplicated",
					"dataset expected IDs are duplicated",
					"dataset forbidden IDs are duplicated",
				]),
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects non-executable cases and answer IDs outside the stored memories", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "naia-public-evidence-unexecutable-cases-"),
		);
		try {
			const manifest = validManifest();
			const cases = datasetCases();
			cases[0].memories = [];
			cases[1].memories[1].id = cases[1].memories[0].id;
			cases[2].memories[1].content = `  ${cases[2].memories[0].content}  `;
			cases[3].expected = ["not-stored"];
			await writeValidEvidence(root, manifest, cases);
			const failures = (
				await evaluatePublicEvidenceFiles(manifest, root, trustPolicy)
			).failures;
			expect(failures).toEqual(
				expect.arrayContaining([
					"dataset case content is invalid",
					"dataset case memory IDs are duplicated",
					"dataset case memory contents are duplicated",
					"dataset answer IDs do not reference case memories",
				]),
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects answer ID reuse and contradictory labels across cases", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "naia-public-evidence-reused-answer-ids-"),
		);
		try {
			const manifest = validManifest();
			const cases = datasetCases();
			cases[1].expected = [cases[0].expected[0]];
			cases[3].forbidden = [cases[2].forbidden[0]];
			cases[4].expected = [cases[5].forbidden[0]];
			await writeValidEvidence(root, manifest, cases);
			const failures = (
				await evaluatePublicEvidenceFiles(manifest, root, trustPolicy)
			).failures;
			expect(failures).toEqual(
				expect.arrayContaining([
					"dataset expected IDs are reused across cases",
					"dataset forbidden IDs are reused across cases",
					"dataset IDs have contradictory labels across cases",
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
