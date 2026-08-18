import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluatePublicEvidence, evaluatePublicEvidenceFiles, type PublicEvidenceManifest } from "./public-evidence-gate.js";

const hash = "a".repeat(64);

function engine(engine: string, kind: "naia" | "external") {
	return {
		engine, kind, implementationFamily: engine, executed: true, receiptPath: `${engine}.json`, receiptSha256: createHash("sha256").update(engine).digest("hex"), datasetSha256: hash,
		implementationRevision: "revision", providerModels: ["provider/model@revision"],
		elapsedMs: 100, estimatedCostUsd: 0, failureCount: 0,
		primaryMetric: { name: "hit@1", value: 0.8, ci95Low: 0.7, ci95High: 0.9 },
	};
}

function validManifest(): PublicEvidenceManifest {
	return {
		schemaVersion: "naia-memory-public-evidence-v1",
		claim: "Naia improves current-fact retrieval under the frozen protocol.",
		dataset: {
			benchmarkTier: "held-out-public", construction: "independent-authored", nativeReviewStatus: "reviewed",
			sealedBeforeRun: true, sha256: hash, caseCount: 120, languageCaseCounts: { ko: 40, en: 40, ja: 40 },
			authorIds: ["author-1"], reviewerIdsByLanguage: { ko: ["reviewer-ko"], en: ["reviewer-en"], ja: ["reviewer-ja"] },
		},
		protocol: { sameInputSha256: hash, topK: 20, repetitions: 2, answerModel: "answer/model@revision", judgeModel: "judge/model@revision", primaryMetricName: "hit@1", frozenBeforeRun: true },
		engines: [engine("naia", "naia"), engine("competitor-a", "external"), engine("competitor-b", "external")],
		adversarialReview: { independent: true, reviewer: "opencode/model@revision", evidenceScopeSha256: hash, artifactPath: "review.md", artifactSha256: hash, verdict: "PASS" },
	};
}

describe("public evidence promotion gate", () => {
	it("accepts complete held-out, reviewed, same-input evidence", () => {
		expect(evaluatePublicEvidence(validManifest())).toEqual({ promotable: true, failures: [] });
	});

	it("rejects the current generated diagnostic even when its scores are strong", () => {
		const manifest = validManifest();
		manifest.dataset.benchmarkTier = "generated-diagnostic";
		manifest.dataset.construction = "template-generated";
		manifest.dataset.nativeReviewStatus = "not-reviewed";
		manifest.dataset.sealedBeforeRun = false;
		const decision = evaluatePublicEvidence(manifest);
		expect(decision.promotable).toBe(false);
		expect(decision.failures).toEqual(expect.arrayContaining([
			"dataset is not held-out-public",
			"dataset is not independently authored",
			"dataset lacks completed native review",
			"dataset was not sealed before execution",
		]));
	});

	it("rejects missing competitors, mismatched inputs, receipts, and confidence intervals", () => {
		const manifest = validManifest();
		manifest.engines = [engine("naia", "naia"), engine("competitor-a", "external")];
		manifest.engines[1].datasetSha256 = "b".repeat(64);
		manifest.engines[1].receiptPath = "";
		manifest.engines[1].primaryMetric.ci95Low = Number.NaN;
		const decision = evaluatePublicEvidence(manifest);
		expect(decision.promotable).toBe(false);
		expect(decision.failures).toEqual(expect.arrayContaining([
			"fewer than two executed external engines",
			"competitor-a: receipt path is missing",
			"competitor-a: input hash differs from the sealed dataset",
			"competitor-a: primary metric or confidence interval is missing",
		]));
	});

	it("rejects duplicate engine arms, invalid evidence hashes, and inconsistent language totals", () => {
		const manifest = validManifest();
		manifest.engines[2].engine = manifest.engines[1].engine;
		manifest.engines[0].receiptSha256 = "not-a-hash";
		manifest.dataset.languageCaseCounts.ja = 39;
		const decision = evaluatePublicEvidence(manifest);
		expect(decision.failures).toEqual(expect.arrayContaining([
			"language counts do not equal dataset case count",
			"executed engine identities are missing or duplicated",
			"naia: receipt SHA-256 is invalid",
		]));
	});

	it("rejects self-review and a non-passing adversarial verdict", () => {
		const manifest = validManifest();
		manifest.dataset.reviewerIdsByLanguage.ko = ["author-1"];
		manifest.adversarialReview = { independent: false, reviewer: "", evidenceScopeSha256: "", artifactPath: "", artifactSha256: "", verdict: "BLOCK" };
		const decision = evaluatePublicEvidence(manifest);
		expect(decision.promotable).toBe(false);
		expect(decision.failures).toEqual(expect.arrayContaining([
			"authors and native reviewers are not independent",
			"adversarial review is not independent",
			"adversarial review provenance is missing",
			"adversarial review did not pass",
		]));
	});

	it("normalizes identity whitespace before independence checks", () => {
		const manifest = validManifest();
		manifest.dataset.authorIds = [" author-1 "];
		manifest.adversarialReview.reviewer = "author-1";
		expect(evaluatePublicEvidence(manifest).failures).toContain("adversarial reviewer overlaps dataset authors or reviewers");
	});

	it("rejects aliased implementations, duplicate receipts, and incomparable metrics", () => {
		const manifest = validManifest();
		manifest.engines[2].implementationFamily = manifest.engines[1].implementationFamily;
		manifest.engines[2].receiptSha256 = manifest.engines[1].receiptSha256;
		manifest.engines[2].primaryMetric.name = "recall@256";
		const decision = evaluatePublicEvidence(manifest);
		expect(decision.failures).toEqual(expect.arrayContaining([
			"implementation families are missing or duplicated",
			"executed engine receipts are duplicated",
			"competitor-b: primary metric differs from the frozen protocol",
		]));
	});

	it("fails closed for a malformed runtime manifest", () => {
		expect(evaluatePublicEvidence({} as PublicEvidenceManifest)).toEqual({
			promotable: false,
			failures: ["manifest shape is invalid"],
		});
	});

	it("fails closed when the evidence root is unreadable", async () => {
		const missing = join(tmpdir(), `naia-public-evidence-missing-${Date.now()}`);
		expect(await evaluatePublicEvidenceFiles(validManifest(), missing)).toEqual({
			promotable: false,
			failures: ["evidence root is unreadable"],
		});
	});

	it("verifies receipt bytes and confines evidence paths to the declared root", async () => {
		const root = await mkdtemp(join(tmpdir(), "naia-public-evidence-"));
		try {
			const manifest = validManifest();
			for (const engine of manifest.engines) {
				const bytes = `frozen evidence: ${engine.engine}`;
				await writeFile(join(root, engine.receiptPath), bytes);
				engine.receiptSha256 = createHash("sha256").update(bytes).digest("hex");
			}
			const reviewBytes = "frozen independent review";
			await writeFile(join(root, "review.md"), reviewBytes);
			manifest.adversarialReview.artifactSha256 = createHash("sha256").update(reviewBytes).digest("hex");
			expect((await evaluatePublicEvidenceFiles(manifest, root)).promotable).toBe(true);

			manifest.engines[0].receiptPath = "../outside.json";
			const decision = await evaluatePublicEvidenceFiles(manifest, root);
			expect(decision.failures).toContain("naia: receipt path escapes evidence root");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects an in-root symlink that resolves outside the evidence root", async () => {
		const root = await mkdtemp(join(tmpdir(), "naia-public-evidence-root-"));
		const outside = await mkdtemp(join(tmpdir(), "naia-public-evidence-outside-"));
		try {
			const manifest = validManifest();
			const bytes = "external evidence";
			const digest = createHash("sha256").update(bytes).digest("hex");
			await writeFile(join(outside, "receipt.json"), bytes);
			await symlink(join(outside, "receipt.json"), join(root, "linked.json"));
			for (const engine of manifest.engines) {
				const engineBytes = `${bytes}: ${engine.engine}`;
				await writeFile(join(root, engine.receiptPath), engineBytes);
				engine.receiptSha256 = createHash("sha256").update(engineBytes).digest("hex");
			}
			manifest.engines[0].receiptPath = "linked.json";
			manifest.engines[0].receiptSha256 = digest;
			await writeFile(join(root, "review.md"), bytes);
			manifest.adversarialReview.artifactSha256 = digest;
			expect((await evaluatePublicEvidenceFiles(manifest, root)).failures).toContain("naia: receipt path escapes evidence root");
		} finally {
			await rm(root, { recursive: true, force: true });
			await rm(outside, { recursive: true, force: true });
		}
	});
});
