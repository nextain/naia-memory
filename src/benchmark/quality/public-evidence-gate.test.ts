import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluatePublicEvidenceFiles, publicCaseJudgmentSha256, publicCaseOutputSha256, publicEvidenceScopeSha256, publicEvidenceSignaturePayload, summarizePublicCaseRecords, type PublicEvidenceManifest, type PublicEvidenceTrustPolicy, validatePublicEvidenceManifest } from "./public-evidence-gate.js";

const hash = "a".repeat(64);
const identities = ["nextain-release", "naia", "competitor-a", "competitor-b", "opencode/model@revision"] as const;
const keys = Object.fromEntries(identities.map((identity) => [identity, generateKeyPairSync("ed25519")])) as Record<typeof identities[number], ReturnType<typeof generateKeyPairSync>>;
const trustPolicy: PublicEvidenceTrustPolicy = {
	publisherPublicKeys: { "nextain-release": keys["nextain-release"].publicKey.export({ type: "spki", format: "pem" }).toString() },
	enginePublicKeys: Object.fromEntries(identities.slice(1, 4).map((identity) => [identity, keys[identity].publicKey.export({ type: "spki", format: "pem" }).toString()])),
	reviewerPublicKeys: { "opencode/model@revision": keys["opencode/model@revision"].publicKey.export({ type: "spki", format: "pem" }).toString() },
	approvedScoringPolicies: { "exact-hit-v1": createHash("sha256").update("export const scoringPolicy = 'exact-hit-v1';").digest("hex") },
};

function signed<T extends Record<string, unknown>>(value: T, identity: typeof identities[number]): T & { signatureBase64: string } {
	return { ...value, signatureBase64: sign(null, publicEvidenceSignaturePayload(value), keys[identity].privateKey).toString("base64") };
}

function engine(engine: string, kind: "naia" | "external") {
	return {
		engine, kind, implementationFamily: engine, executed: true, receiptPath: `${engine}.json`, receiptSha256: createHash("sha256").update(engine).digest("hex"), datasetSha256: hash,
		implementationRevision: "revision", implementationArtifactPath: `${engine}.artifact`, implementationArtifactSha256: createHash("sha256").update(`artifact:${engine}`).digest("hex"),
		configurationPath: `${engine}.config`, configurationSha256: createHash("sha256").update(`config:${engine}`).digest("hex"), providerModels: ["provider/model@revision"],
		elapsedMs: 100, estimatedCostUsd: 0, failureCount: 0,
		primaryMetric: { name: "hit@1", value: 0.8, ci95Low: 0.7, ci95High: 0.9 },
	};
}

function validManifest(): PublicEvidenceManifest {
	const manifest: PublicEvidenceManifest = {
		schemaVersion: "naia-memory-public-evidence-v3",
		publisher: "nextain-release",
		signatureBase64: "",
		claim: "Naia improves current-fact retrieval under the frozen protocol.",
		dataset: {
			path: "dataset.json",
			benchmarkTier: "held-out-public", construction: "independent-authored", nativeReviewStatus: "reviewed",
			sealedBeforeRun: true, sha256: hash, caseCount: 120, languageCaseCounts: { ko: 40, en: 40, ja: 40 },
			authorIds: ["author-1"], reviewerIdsByLanguage: { ko: ["reviewer-ko"], en: ["reviewer-en"], ja: ["reviewer-ja"] },
		},
		protocol: { sameInputSha256: hash, topK: 20, repetitions: 2, answerModel: "answer/model@revision", judgeModel: "judge/model@revision", primaryMetricName: "hit@1", scoringPolicyId: "exact-hit-v1", scorerArtifactPath: "scorer.js", scorerArtifactSha256: hash, frozenBeforeRun: true },
		engines: [engine("naia", "naia"), engine("competitor-a", "external"), engine("competitor-b", "external")],
		adversarialReview: { independent: true, reviewer: "opencode/model@revision", evidenceScopeSha256: hash, artifactPath: "review.md", artifactSha256: hash, verdict: "PASS" },
	};
	manifest.adversarialReview.evidenceScopeSha256 = publicEvidenceScopeSha256(manifest);
	return manifest;
}

function datasetCases() {
	return ["ko", "en", "ja"].flatMap((language) => Array.from({ length: 40 }, (_, index) => {
		const input = `${language} input ${index + 1}`;
		return { id: `${language}-${index + 1}`, language, input, expected: [`expected-${index + 1}`], inputSha256: createHash("sha256").update(input).digest("hex") };
	}));
}

function receiptBytes(manifest: PublicEvidenceManifest, engine: PublicEvidenceManifest["engines"][number], cases = datasetCases()): string {
	const caseRecords = cases.flatMap((item, index) => Array.from({ length: manifest.protocol.repetitions }, (_, repetition) => {
		const output = `${engine.engine} output for ${item.id} repetition ${repetition + 1}`;
		const score = index < 96 ? 1 : 0;
		const judgment = score ? "expected fact present" : "expected fact absent";
		return {
		caseId: item.id, inputSha256: item.inputSha256, repetition: repetition + 1,
		output, outputSha256: publicCaseOutputSha256(engine.engine, item.id, repetition + 1, output), score, failed: false, judgment,
		judgmentSha256: publicCaseJudgmentSha256(engine.engine, item.id, repetition + 1, publicCaseOutputSha256(engine.engine, item.id, repetition + 1, output), score, false, judgment, manifest.protocol.scoringPolicyId),
		};
	}));
	const summary = summarizePublicCaseRecords(caseRecords);
	engine.failureCount = summary.failureCount;
	engine.primaryMetric = { name: manifest.protocol.primaryMetricName, value: summary.value, ci95Low: summary.ci95Low, ci95High: summary.ci95High };
	return JSON.stringify(signed({
		schemaVersion: "naia-memory-public-engine-receipt-v3",
		engine: engine.engine,
		kind: engine.kind,
		implementationFamily: engine.implementationFamily,
		datasetSha256: engine.datasetSha256,
		implementationRevision: engine.implementationRevision,
		implementationArtifactPath: engine.implementationArtifactPath,
		implementationArtifactSha256: engine.implementationArtifactSha256,
		configurationPath: engine.configurationPath,
		configurationSha256: engine.configurationSha256,
		providerModels: engine.providerModels,
		protocol: manifest.protocol,
		elapsedMs: engine.elapsedMs,
		estimatedCostUsd: engine.estimatedCostUsd,
		failureCount: engine.failureCount,
		primaryMetric: engine.primaryMetric,
		caseRecords,
	}, engine.engine as "naia" | "competitor-a" | "competitor-b"));
}

async function writeValidEvidence(root: string, manifest: PublicEvidenceManifest): Promise<void> {
	const cases = datasetCases();
	const datasetBytes = JSON.stringify({ schemaVersion: "naia-memory-public-dataset-v2", cases });
	const datasetSha256 = createHash("sha256").update(datasetBytes).digest("hex");
	await writeFile(join(root, manifest.dataset.path), datasetBytes);
	manifest.dataset.sha256 = datasetSha256;
	manifest.protocol.sameInputSha256 = datasetSha256;
	const scorer = "export const scoringPolicy = 'exact-hit-v1';";
	await writeFile(join(root, manifest.protocol.scorerArtifactPath), scorer);
	manifest.protocol.scorerArtifactSha256 = createHash("sha256").update(scorer).digest("hex");
	for (const engine of manifest.engines) {
		engine.datasetSha256 = datasetSha256;
		const artifact = `artifact:${engine.engine}`;
		const config = `config:${engine.engine}`;
		await writeFile(join(root, engine.implementationArtifactPath), artifact);
		await writeFile(join(root, engine.configurationPath), config);
		engine.implementationArtifactSha256 = createHash("sha256").update(artifact).digest("hex");
		engine.configurationSha256 = createHash("sha256").update(config).digest("hex");
		const bytes = receiptBytes(manifest, engine, cases);
		await writeFile(join(root, engine.receiptPath), bytes);
		engine.receiptSha256 = createHash("sha256").update(bytes).digest("hex");
	}
	manifest.adversarialReview.evidenceScopeSha256 = publicEvidenceScopeSha256(manifest);
	const reviewBytes = JSON.stringify(signed({
		schemaVersion: "naia-memory-public-adversarial-review-v2",
		reviewer: manifest.adversarialReview.reviewer,
		evidenceScopeSha256: manifest.adversarialReview.evidenceScopeSha256,
		verdict: manifest.adversarialReview.verdict,
	}, "opencode/model@revision"));
	await writeFile(join(root, "review.md"), reviewBytes);
	manifest.adversarialReview.artifactSha256 = createHash("sha256").update(reviewBytes).digest("hex");
	manifest.signatureBase64 = signed(manifest as unknown as Record<string, unknown>, "nextain-release").signatureBase64;
}

describe("public evidence promotion gate", () => {
	it("accepts complete held-out, reviewed, same-input evidence", () => {
		expect(validatePublicEvidenceManifest(validManifest())).toEqual({ promotable: true, failures: [] });
	});

	it("rejects the current generated diagnostic even when its scores are strong", () => {
		const manifest = validManifest();
		manifest.dataset.benchmarkTier = "generated-diagnostic";
		manifest.dataset.construction = "template-generated";
		manifest.dataset.nativeReviewStatus = "not-reviewed";
		manifest.dataset.sealedBeforeRun = false;
		const decision = validatePublicEvidenceManifest(manifest);
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
		const decision = validatePublicEvidenceManifest(manifest);
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
		const decision = validatePublicEvidenceManifest(manifest);
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
		const decision = validatePublicEvidenceManifest(manifest);
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
		expect(validatePublicEvidenceManifest(manifest).failures).toContain("adversarial reviewer overlaps dataset authors or reviewers");
	});

	it("rejects aliased implementations, duplicate receipts, and incomparable metrics", () => {
		const manifest = validManifest();
		manifest.engines[2].implementationFamily = manifest.engines[1].implementationFamily;
		manifest.engines[2].receiptSha256 = manifest.engines[1].receiptSha256;
		manifest.engines[2].primaryMetric.name = "recall@256";
		const decision = validatePublicEvidenceManifest(manifest);
		expect(decision.failures).toEqual(expect.arrayContaining([
			"implementation families are missing or duplicated",
			"executed engine receipts are duplicated",
			"competitor-b: primary metric differs from the frozen protocol",
		]));
	});

	it("fails closed for a malformed runtime manifest", () => {
		expect(validatePublicEvidenceManifest({} as PublicEvidenceManifest)).toEqual({
			promotable: false,
			failures: ["manifest shape is invalid"],
		});
	});

	it("fails closed when the evidence root is unreadable", async () => {
		const missing = join(tmpdir(), `naia-public-evidence-missing-${Date.now()}`);
		const decision = await evaluatePublicEvidenceFiles(validManifest(), missing, trustPolicy);
		expect(decision.promotable).toBe(false);
		expect(decision.failures).toContain("evidence root is unreadable");
	});

	it("verifies receipt bytes and confines evidence paths to the declared root", async () => {
		const root = await mkdtemp(join(tmpdir(), "naia-public-evidence-"));
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const initialDecision = await evaluatePublicEvidenceFiles(manifest, root, trustPolicy);
			expect(initialDecision.failures).toEqual([]);

			manifest.engines[0].receiptPath = "../outside.json";
			const decision = await evaluatePublicEvidenceFiles(manifest, root, trustPolicy);
			expect(decision.failures).toContain("naia: receipt path escapes evidence root");
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
			const maliciousPolicy = { ...trustPolicy, publisherPublicKeys: { "nextain-release": attacker.publicKey.export({ type: "spki", format: "pem" }).toString() } };
			expect((await evaluatePublicEvidenceFiles(manifest, root, maliciousPolicy)).failures).toContain("manifest signature is untrusted or invalid");
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
			manifest.signatureBase64 = signed(manifest as unknown as Record<string, unknown>, "nextain-release").signatureBase64;
			expect((await evaluatePublicEvidenceFiles(manifest, root, trustPolicy)).failures).toContain("scoring policy is not approved by the verifier");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects score inflation even when the attacker recomputes receipt and manifest hashes", async () => {
		const root = await mkdtemp(join(tmpdir(), "naia-public-evidence-score-forgery-"));
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const target = manifest.engines[0];
			const receipt = JSON.parse(await readFile(join(root, target.receiptPath), "utf8"));
			receipt.caseRecords.at(-1).score = 1;
			const summary = summarizePublicCaseRecords(receipt.caseRecords);
			receipt.failureCount = summary.failureCount;
			receipt.primaryMetric = { name: manifest.protocol.primaryMetricName, value: summary.value, ci95Low: summary.ci95Low, ci95High: summary.ci95High };
			target.failureCount = summary.failureCount;
			target.primaryMetric = receipt.primaryMetric;
			const bytes = JSON.stringify(receipt);
			await writeFile(join(root, target.receiptPath), bytes);
			target.receiptSha256 = createHash("sha256").update(bytes).digest("hex");
			manifest.adversarialReview.evidenceScopeSha256 = publicEvidenceScopeSha256(manifest);
			const failures = (await evaluatePublicEvidenceFiles(manifest, root, trustPolicy)).failures;
			expect(failures).toEqual(expect.arrayContaining([
				"naia: receipt case judgment hash is invalid",
				"naia: receipt signature is untrusted or invalid",
			]));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects a review artifact signed by a key outside the verifier trust policy", async () => {
		const root = await mkdtemp(join(tmpdir(), "naia-public-evidence-review-key-"));
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const review = JSON.parse(await readFile(join(root, manifest.adversarialReview.artifactPath), "utf8"));
			const attacker = generateKeyPairSync("ed25519");
			review.signatureBase64 = sign(null, publicEvidenceSignaturePayload(review), attacker.privateKey).toString("base64");
			const bytes = JSON.stringify(review);
			await writeFile(join(root, manifest.adversarialReview.artifactPath), bytes);
			manifest.adversarialReview.artifactSha256 = createHash("sha256").update(bytes).digest("hex");
			expect((await evaluatePublicEvidenceFiles(manifest, root, trustPolicy)).failures).toContain("adversarial review signature is untrusted or invalid");
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
			const receipt = JSON.parse(await readFile(join(root, manifest.engines[0].receiptPath), "utf8"));
			receipt.engine = "forged-naia";
			const forgedBytes = JSON.stringify(receipt);
			await writeFile(join(root, manifest.engines[0].receiptPath), forgedBytes);
			manifest.engines[0].receiptSha256 = createHash("sha256").update(forgedBytes).digest("hex");
			const decision = await evaluatePublicEvidenceFiles(manifest, root, trustPolicy);
			expect(decision.failures).toEqual(expect.arrayContaining([
				"dataset content hash mismatch",
				"naia: receipt engine identity mismatch",
			]));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("recomputes aggregates from complete per-case records and verifies implementation bytes", async () => {
		const root = await mkdtemp(join(tmpdir(), "naia-public-evidence-recompute-"));
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const target = manifest.engines[0];
			const receipt = JSON.parse(await readFile(join(root, target.receiptPath), "utf8"));
			receipt.caseRecords.pop();
			receipt.primaryMetric.value = 1;
			target.primaryMetric.value = 1;
			const bytes = JSON.stringify(receipt);
			await writeFile(join(root, target.receiptPath), bytes);
			target.receiptSha256 = createHash("sha256").update(bytes).digest("hex");
			await writeFile(join(root, target.implementationArtifactPath), "substituted artifact");
			const failures = (await evaluatePublicEvidenceFiles(manifest, root, trustPolicy)).failures;
			expect(failures).toEqual(expect.arrayContaining([
				"naia: receipt case coverage mismatch",
				"naia: receipt recomputed primary metric mismatch",
				"naia: implementation artifact content hash mismatch",
			]));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects case outputs copied from another engine arm", async () => {
		const root = await mkdtemp(join(tmpdir(), "naia-public-evidence-cross-arm-"));
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const target = manifest.engines[0];
			const donor = JSON.parse(await readFile(join(root, manifest.engines[1].receiptPath), "utf8"));
			const receipt = JSON.parse(await readFile(join(root, target.receiptPath), "utf8"));
			receipt.caseRecords = donor.caseRecords;
			const bytes = JSON.stringify(receipt);
			await writeFile(join(root, target.receiptPath), bytes);
			target.receiptSha256 = createHash("sha256").update(bytes).digest("hex");
			expect((await evaluatePublicEvidenceFiles(manifest, root, trustPolicy)).failures).toContain("naia: receipt output hash is invalid");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("refuses to summarize empty or non-finite case evidence", () => {
		expect(() => summarizePublicCaseRecords([])).toThrow("finite scores");
		expect(() => summarizePublicCaseRecords([{ caseId: "x", score: Number.NaN, failed: false } as never])).toThrow("finite scores");
	});

	it("derives case and language counts from dataset contents and binds engine kind", async () => {
		const root = await mkdtemp(join(tmpdir(), "naia-public-evidence-semantics-"));
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const dataset = JSON.parse(await readFile(join(root, manifest.dataset.path), "utf8"));
			dataset.cases[0].language = "en";
			const datasetBytes = JSON.stringify(dataset);
			await writeFile(join(root, manifest.dataset.path), datasetBytes);
			manifest.dataset.sha256 = createHash("sha256").update(datasetBytes).digest("hex");
			manifest.protocol.sameInputSha256 = manifest.dataset.sha256;
			for (const engine of manifest.engines) {
				engine.datasetSha256 = manifest.dataset.sha256;
				const receipt = JSON.parse(receiptBytes(manifest, engine));
				if (engine.kind === "naia") receipt.kind = "external";
				const bytes = JSON.stringify(receipt);
				await writeFile(join(root, engine.receiptPath), bytes);
				engine.receiptSha256 = createHash("sha256").update(bytes).digest("hex");
			}
			manifest.adversarialReview.evidenceScopeSha256 = publicEvidenceScopeSha256(manifest);
			const decision = await evaluatePublicEvidenceFiles(manifest, root, trustPolicy);
			expect(decision.failures).toEqual(expect.arrayContaining([
				"dataset language counts mismatch",
				"naia: receipt engine kind mismatch",
			]));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects a review artifact that does not attest the complete evidence scope", async () => {
		const root = await mkdtemp(join(tmpdir(), "naia-public-evidence-review-"));
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const review = JSON.parse(await readFile(join(root, manifest.adversarialReview.artifactPath), "utf8"));
			review.verdict = "BLOCK";
			const bytes = JSON.stringify(review);
			await writeFile(join(root, manifest.adversarialReview.artifactPath), bytes);
			manifest.adversarialReview.artifactSha256 = createHash("sha256").update(bytes).digest("hex");
			expect((await evaluatePublicEvidenceFiles(manifest, root, trustPolicy)).failures).toContain("adversarial review verdict mismatch");
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
		const outside = await mkdtemp(join(tmpdir(), "naia-public-evidence-outside-"));
		try {
			const manifest = validManifest();
			await writeValidEvidence(root, manifest);
			const bytes = "external evidence";
			const digest = createHash("sha256").update(bytes).digest("hex");
			await writeFile(join(outside, "receipt.json"), bytes);
			await symlink(join(outside, "receipt.json"), join(root, "linked.json"));
			manifest.engines[0].receiptPath = "linked.json";
			manifest.engines[0].receiptSha256 = digest;
			expect((await evaluatePublicEvidenceFiles(manifest, root, trustPolicy)).failures).toContain("naia: receipt path escapes evidence root");
		} finally {
			await rm(root, { recursive: true, force: true });
			await rm(outside, { recursive: true, force: true });
		}
	});
});
