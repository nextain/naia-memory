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

describe("public evidence policy attacks", () => {
	it.each([
		["dataset", "dataset content shape is invalid"],
		["receipt", "naia: receipt content shape is invalid"],
		["review", "adversarial review content shape is invalid"],
	] as const)(
		"fails closed when the %s JSON is scalar",
		async (kind, failure) => {
			const root = await mkdtemp(join(tmpdir(), `naia-public-${kind}-shape-`));
			try {
				const manifest = validManifest();
				await writeValidEvidence(root, manifest);
				const target = manifest.engines[0];
				const path =
					kind === "dataset"
						? manifest.dataset.path
						: kind === "receipt"
							? target.receiptPath
							: manifest.adversarialReview.artifactPath;
				await writeFile(join(root, path), "null");
				const hash = createHash("sha256").update("null").digest("hex");
				if (kind === "dataset") manifest.dataset.sha256 = hash;
				else if (kind === "receipt") target.receiptSha256 = hash;
				else manifest.adversarialReview.artifactSha256 = hash;
				const decision = await evaluatePublicEvidenceFiles(
					manifest,
					root,
					trustPolicy,
				);
				expect(decision.promotable).toBe(false);
				expect(decision.failures).toContain(failure);
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		},
	);

	it("fails closed when a hash-matching challenge body is not an object", async () => {
		const root = await mkdtemp(join(tmpdir(), "naia-public-evidence-shape-"));
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const target = manifest.engines[0];
			await writeFile(join(root, target.challengePath), "null");
			target.challengeSha256 = createHash("sha256")
				.update("null")
				.digest("hex");
			const decision = await evaluatePublicEvidenceFiles(
				manifest,
				root,
				trustPolicy,
			);
			expect(decision.promotable).toBe(false);
			expect(decision.failures).toContain(
				`${target.engine}: execution attestation is missing or invalid`,
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects a manifest scoring policy not pinned by the external verifier", async () => {
		const root = await mkdtemp(join(tmpdir(), "naia-public-evidence-policy-"));
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			manifest.protocol.scoringPolicyId = "always-pass-v1";
			manifest.signatureBase64 = signed(
				manifest as unknown as Record<string, unknown>,
				"nextain-release",
			).signatureBase64;
			const failures = (
				await evaluatePublicEvidenceFiles(manifest, root, trustPolicy)
			).failures;
			expect(failures).toEqual(
				expect.arrayContaining([
					"scoring policy is not replayable by this verifier",
					"scoring policy is not approved by the verifier",
				]),
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects an approved artifact whose declared semantics differ from the replay implementation", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "naia-public-evidence-policy-semantics-"),
		);
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const altered = JSON.stringify({
				...PUBLIC_RETRIEVAL_SCORING_POLICY,
				passCondition: "expected-id-present",
			});
			await writeFile(
				join(root, manifest.protocol.scorerArtifactPath),
				altered,
			);
			manifest.protocol.scorerArtifactSha256 = createHash("sha256")
				.update(altered)
				.digest("hex");
			const verifierPolicy = {
				...trustPolicy,
				approvedScoringPolicies: {
					[PUBLIC_RETRIEVAL_SCORING_POLICY_ID]:
						manifest.protocol.scorerArtifactSha256,
				},
			};
			manifest.signatureBase64 = signed(
				manifest as unknown as Record<string, unknown>,
				"nextain-release",
			).signatureBase64;
			expect(
				(await evaluatePublicEvidenceFiles(manifest, root, verifierPolicy))
					.failures,
			).toContain("scorer artifact semantics mismatch");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects score inflation even when the attacker recomputes receipt and manifest hashes", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "naia-public-evidence-score-forgery-"),
		);
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const target = manifest.engines[0];
			const receipt = JSON.parse(
				await readFile(join(root, target.receiptPath), "utf8"),
			);
			receipt.caseRecords.at(-1).score = 1;
			const summary = summarizePublicCaseRecords(receipt.caseRecords);
			receipt.failureCount = summary.failureCount;
			receipt.primaryMetric = {
				name: manifest.protocol.primaryMetricName,
				value: summary.value,
				ci95Low: summary.ci95Low,
				ci95High: summary.ci95High,
			};
			target.failureCount = summary.failureCount;
			target.primaryMetric = receipt.primaryMetric;
			const bytes = JSON.stringify(receipt);
			await writeFile(join(root, target.receiptPath), bytes);
			target.receiptSha256 = createHash("sha256").update(bytes).digest("hex");
			manifest.adversarialReview.evidenceScopeSha256 =
				publicEvidenceScopeSha256(manifest);
			const failures = (
				await evaluatePublicEvidenceFiles(manifest, root, trustPolicy)
			).failures;
			expect(failures).toEqual(
				expect.arrayContaining([
					"naia: receipt case judgment hash is invalid",
					"naia: receipt signature is untrusted or invalid",
				]),
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("replays scoring and rejects inflation even when the engine signs the forged receipt", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "naia-public-evidence-semantic-forgery-"),
		);
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const target = manifest.engines[0];
			const receipt = JSON.parse(
				await readFile(join(root, target.receiptPath), "utf8"),
			);
			const record = receipt.caseRecords.at(-1);
			record.score = 1;
			record.judgment = "expected-id-present-without-forbidden-id";
			record.judgmentSha256 = publicCaseJudgmentSha256(
				target.engine,
				record.caseId,
				record.repetition,
				record.outputSha256,
				record.score,
				record.failed,
				record.judgment,
				manifest.protocol.scoringPolicyId,
			);
			const summary = summarizePublicCaseRecords(receipt.caseRecords);
			receipt.failureCount = summary.failureCount;
			receipt.primaryMetric = {
				name: manifest.protocol.primaryMetricName,
				value: summary.value,
				ci95Low: summary.ci95Low,
				ci95High: summary.ci95High,
			};
			target.failureCount = summary.failureCount;
			target.primaryMetric = receipt.primaryMetric;
			// biome-ignore lint/performance/noDelete: the test must remove the old signature before re-signing the exact payload.
			delete receipt.signatureBase64;
			const bytes = JSON.stringify(signed(receipt, "naia"));
			await writeFile(join(root, target.receiptPath), bytes);
			target.receiptSha256 = createHash("sha256").update(bytes).digest("hex");
			manifest.adversarialReview.evidenceScopeSha256 =
				publicEvidenceScopeSha256(manifest);
			manifest.signatureBase64 = signed(
				manifest as unknown as Record<string, unknown>,
				"nextain-release",
			).signatureBase64;
			const failures = (
				await evaluatePublicEvidenceFiles(manifest, root, trustPolicy)
			).failures;
			expect(failures).toEqual(
				expect.arrayContaining([
					"naia: receipt replayed case score mismatch",
					"naia: receipt replayed case judgment mismatch",
				]),
			);
			expect(failures).not.toContain(
				"naia: receipt signature is untrusted or invalid",
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("does not let a signed failed flag bypass deterministic replay", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "naia-public-evidence-failed-bypass-"),
		);
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const target = manifest.engines[0];
			const receipt = JSON.parse(
				await readFile(join(root, target.receiptPath), "utf8"),
			);
			const record = receipt.caseRecords[0];
			record.failed = true;
			record.score = 0;
			record.judgment = "invalid-output-json";
			record.judgmentSha256 = publicCaseJudgmentSha256(
				target.engine,
				record.caseId,
				record.repetition,
				record.outputSha256,
				record.score,
				record.failed,
				record.judgment,
				manifest.protocol.scoringPolicyId,
			);
			const summary = summarizePublicCaseRecords(receipt.caseRecords);
			receipt.failureCount = summary.failureCount;
			receipt.primaryMetric = {
				name: manifest.protocol.primaryMetricName,
				value: summary.value,
				ci95Low: summary.ci95Low,
				ci95High: summary.ci95High,
			};
			target.failureCount = summary.failureCount;
			target.primaryMetric = receipt.primaryMetric;
			// biome-ignore lint/performance/noDelete: the test must remove the old signature before re-signing the exact payload.
			delete receipt.signatureBase64;
			const bytes = JSON.stringify(signed(receipt, "naia"));
			await writeFile(join(root, target.receiptPath), bytes);
			target.receiptSha256 = createHash("sha256").update(bytes).digest("hex");
			manifest.adversarialReview.evidenceScopeSha256 =
				publicEvidenceScopeSha256(manifest);
			manifest.signatureBase64 = signed(
				manifest as unknown as Record<string, unknown>,
				"nextain-release",
			).signatureBase64;
			const failures = (
				await evaluatePublicEvidenceFiles(manifest, root, trustPolicy)
			).failures;
			expect(failures).toEqual(
				expect.arrayContaining([
					"naia: receipt replayed case score mismatch",
					"naia: receipt replayed case judgment mismatch",
				]),
			);
			expect(failures).not.toContain(
				"naia: receipt signature is untrusted or invalid",
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects oversized evidence before hashing or parsing it", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "naia-public-evidence-oversized-"),
		);
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			await writeFile(
				join(root, manifest.dataset.provenancePath),
				" ".repeat(16 * 1024 * 1024 + 1),
			);
			const failures = (
				await evaluatePublicEvidenceFiles(manifest, root, trustPolicy)
			).failures;
			expect(failures).toContain(
				"dataset provenance exceeds the 16 MiB evidence-file limit",
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
