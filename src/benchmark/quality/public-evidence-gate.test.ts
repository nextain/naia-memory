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
	type PublicEvidenceManifest,
	evaluatePublicEvidenceFiles,
	isPublicEvidenceManifest,
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

describe("public evidence promotion gate manifest and provenance", () => {
	it("accepts complete held-out, reviewed, same-input evidence", () => {
		expect(validatePublicEvidenceManifest(validManifest())).toEqual({
			promotable: true,
			failures: [],
		});
	});

	it("rejects legacy or model-mediated protocol claims for a model-free scorer", () => {
		expect(isPublicEvidenceManifest(validManifest())).toBe(true);

		const mislabeled = {
			...validManifest(),
			schemaVersion: "naia-memory-public-evidence-v6",
		};
		expect(isPublicEvidenceManifest(mislabeled)).toBe(false);
		expect(
			validatePublicEvidenceManifest(
				mislabeled as unknown as PublicEvidenceManifest,
			),
		).toEqual({
			promotable: false,
			failures: ["manifest shape is invalid"],
		});

		const legacy = {
			...validManifest(),
			schemaVersion: "naia-memory-public-evidence-v5",
			protocol: {
				...validManifest().protocol,
				answerModel: "answer/model@revision",
				judgeModel: "judge/model@revision",
			},
		};
		expect(isPublicEvidenceManifest(legacy)).toBe(false);

		const misleading = validManifest() as PublicEvidenceManifest & {
			protocol: PublicEvidenceManifest["protocol"] & { judgeModel: string };
		};
		misleading.protocol.judgeModel = "judge/model@revision";
		expect(isPublicEvidenceManifest(misleading)).toBe(false);
	});

	it("requires one well-formed primary metric for every dataset language", () => {
		const missing = validManifest();
		const { ko: _omitted, ...withoutKorean } =
			missing.engines[0].languagePrimaryMetrics;
		missing.engines[0].languagePrimaryMetrics = withoutKorean;
		expect(validatePublicEvidenceManifest(missing).failures).toContain(
			"naia: language metrics do not match the dataset",
		);

		const extra = validManifest();
		extra.engines[0].languagePrimaryMetrics.fr = {
			value: 0.8,
			ci95Low: 0.7,
			ci95High: 0.9,
		};
		expect(validatePublicEvidenceManifest(extra).failures).toContain(
			"naia: language metrics do not match the dataset",
		);

		const malformed = validManifest() as unknown as Record<string, unknown>;
		const engines = malformed.engines as Array<Record<string, unknown>>;
		const metrics = engines[0].languagePrimaryMetrics as Record<
			string,
			Record<string, number>
		>;
		metrics.ko.hiddenWeight = 1;
		expect(isPublicEvidenceManifest(malformed)).toBe(false);
	});

	it("rejects claims broader than tamper-evident artifact provenance", () => {
		const manifest = validManifest();
		manifest.claim = "Naia is globally superior across languages.";
		expect(validatePublicEvidenceManifest(manifest).failures).toContain(
			"claim exceeds the evidence supported by this gate",
		);
	});

	it("binds non-executed arms into the adversarial review scope", () => {
		const manifest = validManifest();
		const planned = {
			...engine("planned", "external"),
			executed: false,
		};
		manifest.engines.push(planned);
		const scope = publicEvidenceScopeSha256(manifest);
		planned.primaryMetric.value = 0.99;
		expect(publicEvidenceScopeSha256(manifest)).not.toBe(scope);
	});

	it("rejects shared execution evidence and configuration artifacts", () => {
		const manifest = validManifest();
		manifest.engines[1].executionEvidenceSha256 =
			manifest.engines[0].executionEvidenceSha256;
		manifest.engines[1].configurationSha256 =
			manifest.engines[0].configurationSha256;
		expect(validatePublicEvidenceManifest(manifest).failures).toEqual(
			expect.arrayContaining([
				"execution evidence artifacts are missing or duplicated",
				"engine configurations are missing or duplicated",
			]),
		);
	});

	it("rejects aliases that reuse one key across trusted roles", async () => {
		const root = await mkdtemp(join(tmpdir(), "naia-public-role-overlap-"));
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const policy = {
				...trustPolicy,
				runnerPublicKeys: {
					...trustPolicy.runnerPublicKeys,
					"runner-naia": trustPolicy.publisherPublicKeys["nextain-release"],
				},
			};
			expect(
				(await evaluatePublicEvidenceFiles(manifest, root, policy)).failures,
			).toContain("trusted role keys overlap: nextain-release and runner-naia");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects a runner declared inside the benchmark operator trust boundary", async () => {
		const root = await mkdtemp(join(tmpdir(), "naia-public-runner-domain-"));
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const policy = structuredClone(trustPolicy);
			policy.runnerTrustDomains["runner-naia"] =
				policy.benchmarkOperatorTrustDomain;
			expect(
				(await evaluatePublicEvidenceFiles(manifest, root, policy)).failures,
			).toContain(
				"naia: execution runner is inside the benchmark operator trust boundary",
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("normalizes equivalent key encodings before checking role overlap", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "naia-public-key-normalization-"),
		);
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const publisherKey = trustPolicy.publisherPublicKeys["nextain-release"];
			if (!publisherKey) throw new Error("fixture publisher key is missing");
			const policy = {
				...trustPolicy,
				runnerPublicKeys: {
					...trustPolicy.runnerPublicKeys,
					"runner-naia": publisherKey.replaceAll("\n", "\r\n"),
				},
			};
			expect(
				(await evaluatePublicEvidenceFiles(manifest, root, policy)).failures,
			).toContain("trusted role keys overlap: nextain-release and runner-naia");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects one trusted identity mapped to multiple keys", async () => {
		const root = await mkdtemp(join(tmpdir(), "naia-public-identity-keys-"));
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const policy = structuredClone(trustPolicy);
			policy.nativeReviewerPublicKeysByLanguage.en ??= {};
			policy.nativeReviewerPublicKeysByLanguage.en["reviewer-ko"] =
				trustPolicy.nativeReviewerPublicKeysByLanguage.en?.["reviewer-en"] ??
				"";
			expect(
				(await evaluatePublicEvidenceFiles(manifest, root, policy)).failures,
			).toContain("trusted identity has multiple keys: reviewer-ko");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects one identity assigned to multiple trusted roles with different keys", async () => {
		const root = await mkdtemp(join(tmpdir(), "naia-public-role-identity-"));
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const policy = {
				...trustPolicy,
				runnerPublicKeys: {
					...trustPolicy.runnerPublicKeys,
					"nextain-release": trustPolicy.runnerPublicKeys["runner-naia"],
				},
			};
			expect(
				(await evaluatePublicEvidenceFiles(manifest, root, policy)).failures,
			).toContain(
				"trusted role identities overlap: nextain-release is publisher and runner",
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("checks every language-scoped native reviewer key for role overlap", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "naia-public-native-role-overlap-"),
		);
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const policy = {
				...trustPolicy,
				nativeReviewerPublicKeysByLanguage: {
					...trustPolicy.nativeReviewerPublicKeysByLanguage,
					ko: {
						"reviewer-ko": trustPolicy.publisherPublicKeys["nextain-release"],
					},
				},
			};
			expect(
				(await evaluatePublicEvidenceFiles(manifest, root, policy)).failures,
			).toContain("trusted role keys overlap: nextain-release and reviewer-ko");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects the current generated diagnostic even when its scores are strong", () => {
		const manifest = validManifest();
		manifest.dataset.benchmarkTier = "generated-diagnostic";
		manifest.dataset.construction = "template-generated";
		manifest.dataset.nativeReviewStatus = "not-reviewed";
		manifest.dataset.sealedBeforeRun = false;
		const decision = validatePublicEvidenceManifest(manifest);
		expect(decision.promotable).toBe(false);
		expect(decision.failures).toEqual(
			expect.arrayContaining([
				"dataset is not held-out-public",
				"dataset is not independently authored",
				"dataset lacks completed native review",
				"dataset was not sealed before execution",
			]),
		);
	});

	it("rejects missing competitors, mismatched inputs, receipts, and confidence intervals", () => {
		const manifest = validManifest();
		manifest.engines = [
			engine("naia", "naia"),
			engine("competitor-a", "external"),
		];
		manifest.engines[1].datasetSha256 = "b".repeat(64);
		manifest.engines[1].receiptPath = "";
		manifest.engines[1].primaryMetric.ci95Low = Number.NaN;
		const decision = validatePublicEvidenceManifest(manifest);
		expect(decision.promotable).toBe(false);
		expect(decision.failures).toEqual(
			expect.arrayContaining([
				"fewer than two executed external engines",
				"competitor-a: receipt path is missing",
				"competitor-a: input hash differs from the sealed dataset",
				"competitor-a: primary metric or confidence interval is missing",
			]),
		);
	});

	it("rejects a metric label whose k differs from the replay window", () => {
		const manifest = validManifest();
		manifest.protocol.topK = 10;
		const decision = validatePublicEvidenceManifest(manifest);
		expect(decision.failures).toContain(
			"primary metric name does not match topK",
		);
	});

	it("rejects a non-integer replay window", () => {
		const manifest = validManifest();
		manifest.protocol.topK = 2.5;
		expect(validatePublicEvidenceManifest(manifest).failures).toContain(
			"topK is invalid",
		);
	});

	it("rejects malformed and overlapping forbidden IDs", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "naia-public-evidence-forbidden-"),
		);
		try {
			const manifest = validManifest();
			const cases = datasetCases();
			(cases[0] as unknown as { forbidden: unknown }).forbidden = "stale-ko-1";
			cases[1].forbidden = [cases[1].expected[0]];
			await writeValidEvidence(root, manifest, cases);
			const failures = (
				await evaluatePublicEvidenceFiles(manifest, root, trustPolicy)
			).failures;
			expect(failures).toEqual(
				expect.arrayContaining([
					"dataset case content is invalid",
					"dataset expected and forbidden IDs overlap",
				]),
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects duplicate engine arms, invalid evidence hashes, and inconsistent language totals", () => {
		const manifest = validManifest();
		manifest.engines[2].engine = manifest.engines[1].engine;
		manifest.engines[0].receiptSha256 = "not-a-hash";
		manifest.dataset.languageCaseCounts.ja = 39;
		const decision = validatePublicEvidenceManifest(manifest);
		expect(decision.failures).toEqual(
			expect.arrayContaining([
				"language counts do not equal dataset case count",
				"executed engine identities are missing or duplicated",
				"naia: receipt SHA-256 is invalid",
			]),
		);
	});

	it("rejects self-review and a non-passing adversarial verdict", () => {
		const manifest = validManifest();
		manifest.dataset.reviewerIdsByLanguage.ko = ["author-1"];
		manifest.adversarialReview = {
			independent: false,
			reviewer: "",
			evidenceScopeSha256: "",
			artifactPath: "",
			artifactSha256: "",
			verdict: "BLOCK",
		};
		const decision = validatePublicEvidenceManifest(manifest);
		expect(decision.promotable).toBe(false);
		expect(decision.failures).toEqual(
			expect.arrayContaining([
				"authors and native reviewers are not independent",
				"adversarial review is not independent",
				"adversarial review provenance is missing",
				"adversarial review did not pass",
			]),
		);
	});

	it("normalizes identity whitespace before independence checks", () => {
		const manifest = validManifest();
		manifest.dataset.authorIds = [" author-1 "];
		manifest.adversarialReview.reviewer = "author-1";
		expect(validatePublicEvidenceManifest(manifest).failures).toContain(
			"adversarial reviewer overlaps dataset authors or reviewers",
		);
	});

	it("rejects aliased implementations, duplicate receipts, and incomparable metrics", () => {
		const manifest = validManifest();
		manifest.engines[2].implementationFamily =
			manifest.engines[1].implementationFamily;
		manifest.engines[2].receiptSha256 = manifest.engines[1].receiptSha256;
		manifest.engines[2].primaryMetric.name = "recall@256";
		const decision = validatePublicEvidenceManifest(manifest);
		expect(decision.failures).toEqual(
			expect.arrayContaining([
				"implementation families are missing or duplicated",
				"executed engine receipts are missing or duplicated",
				"competitor-b: primary metric differs from the frozen protocol",
			]),
		);
	});

	it("fails closed for a malformed runtime manifest", () => {
		expect(
			validatePublicEvidenceManifest({} as PublicEvidenceManifest),
		).toEqual({
			promotable: false,
			failures: ["manifest shape is invalid"],
		});
	});

	it("rejects nested manifest type confusion before semantic validation", () => {
		const stringRepetitions = validManifest() as unknown as Record<
			string,
			unknown
		>;
		(stringRepetitions.protocol as Record<string, unknown>).repetitions = "2";
		expect(validatePublicEvidenceManifest(stringRepetitions).failures).toEqual([
			"manifest shape is invalid",
		]);

		const reviewerString = validManifest() as unknown as Record<
			string,
			unknown
		>;
		(
			(reviewerString.dataset as Record<string, unknown>)
				.reviewerIdsByLanguage as Record<string, unknown>
		).ko = "reviewer-ko";
		expect(validatePublicEvidenceManifest(reviewerString).failures).toEqual([
			"manifest shape is invalid",
		]);
	});

	it("rejects result claims attached to an unexecuted engine", () => {
		const manifest = validManifest();
		manifest.engines.push({
			...manifest.engines[1],
			engine: "planned-competitor",
			implementationFamily: "planned-family",
			executed: false,
			primaryMetric: { ...manifest.engines[1].primaryMetric, value: 0.99 },
		});
		expect(validatePublicEvidenceManifest(manifest).failures).toContain(
			"planned-competitor: unexecuted engine carries result claims",
		);
	});

	it("fails closed when the evidence root is unreadable", async () => {
		const missing = join(
			tmpdir(),
			`naia-public-evidence-missing-${Date.now()}`,
		);
		const decision = await evaluatePublicEvidenceFiles(
			validManifest(),
			missing,
			trustPolicy,
		);
		expect(decision.promotable).toBe(false);
		expect(decision.failures).toContain("evidence root is unreadable");
	});

	it("verifies receipt bytes and confines evidence paths to the declared root", async () => {
		const root = await mkdtemp(join(tmpdir(), "naia-public-evidence-"));
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const initialDecision = await evaluatePublicEvidenceFiles(
				manifest,
				root,
				trustPolicy,
			);
			expect(initialDecision.failures).toEqual([]);

			manifest.engines[0].receiptPath = "../outside.json";
			const decision = await evaluatePublicEvidenceFiles(
				manifest,
				root,
				trustPolicy,
			);
			expect(decision.failures).toContain(
				"naia: receipt path escapes evidence root",
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects a self-selected trust root without the verifier's publisher key", async () => {
		const root = await mkdtemp(join(tmpdir(), "naia-public-evidence-trust-"));
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const attacker = generateKeyPairSync("ed25519");
			const maliciousPolicy = {
				...trustPolicy,
				publisherPublicKeys: {
					"nextain-release": attacker.publicKey
						.export({ type: "spki", format: "pem" })
						.toString(),
				},
			};
			expect(
				(await evaluatePublicEvidenceFiles(manifest, root, maliciousPolicy))
					.failures,
			).toContain("manifest signature is untrusted or invalid");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
