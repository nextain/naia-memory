import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type MemoryUpdateContract,
	computeFamilySplitDigest,
} from "./memory-update-contract.js";
import {
	evidenceObjectSha256,
	evidenceSignaturePayload,
} from "./public-evidence-crypto.js";
import type { SemanticAdjudicationEvidenceBundle } from "./semantic-adjudication-evidence.js";
import { buildSemanticBlindArtifacts } from "./semantic-blind-packet-cli.js";
import { buildSemanticCampaignPlan } from "./semantic-campaign-cli.js";
import {
	type SemanticExecutionEvidenceBundle,
	semanticEngineRunSetSha256,
} from "./semantic-execution-evidence.js";
import type {
	SemanticPublicAttestation,
	SemanticPublicAttestationBundle,
	SemanticPublicTrustPolicy,
} from "./semantic-public-attestation.js";
import {
	runSemanticCorpusGateCli,
	runSemanticPublicGateCli,
} from "./semantic-public-gate-cli.js";

const roots: string[] = [];
async function root(): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), "naia-semantic-public-gate-"));
	roots.push(path);
	return path;
}

function publicContract(): MemoryUpdateContract {
	const languages = ["ko", "en", "ja"] as const;
	const decisions = ["update", "delete", "no-update"] as const;
	const cases = Array.from({ length: 102 }, (_, index) => {
		const language = languages[index % 3] ?? "ko";
		const decision = decisions[Math.floor(index / 3) % 3] ?? "update";
		return {
			id: `public-${index}`,
			familyId: `family-public-${index}`,
			split: "test" as const,
			language,
			turns: [{ content: `content-${index}`, at: "2026-01-01T00:00:00Z" }],
			query: `query-${index}`,
			expectedCurrentIds: ["current"],
			forbiddenStaleIds: ["stale"],
			expectedDeletedIds: decision === "delete" ? ["deleted"] : [],
			noUpdateIds: decision === "no-update" ? ["unchanged"] : [],
			expectedDecision: decision,
			provenance: {
				authorId: `author-${language}`,
				constructionClusterId: `construction-${index}`,
				authorNativeLanguages: [language],
				authoredAt: "2026-01-02T00:00:00Z",
				reviewerId: `reviewer-${language}`,
				reviewerNativeLanguages: [language],
				reviewedAt: "2026-01-03T00:00:00Z",
				reviewDecision: "accepted" as const,
			},
		};
	});
	return {
		schemaVersion: "naia-memory-update-contract-v1",
		tier: "semantic-update-interpretation",
		construction: "independent-native-reviewed",
		familySplitFreeze: {
			frozenAt: "2026-01-04T00:00:00Z",
			digest: computeFamilySplitDigest(cases) as `sha256:${string}`,
		},
		cases,
	};
}

function signedEvidence(
	contract: MemoryUpdateContract,
	signedAt = "2026-01-05T00:00:00Z",
): {
	bundle: SemanticPublicAttestationBundle;
	policy: SemanticPublicTrustPolicy;
} {
	const contractSha256 = evidenceObjectSha256(contract);
	const policy: SemanticPublicTrustPolicy = {
		authorPublicKeysByLanguage: {},
		nativeReviewerPublicKeysByLanguage: {},
	};
	const attestations: SemanticPublicAttestation[] = [];
	for (const language of ["ko", "en", "ja"] as const) {
		for (const role of ["author", "native-reviewer"] as const) {
			const signer = `${role === "author" ? "author" : "reviewer"}-${language}`;
			const { privateKey, publicKey } = generateKeyPairSync("ed25519");
			const languageMap =
				role === "author"
					? policy.authorPublicKeysByLanguage
					: policy.nativeReviewerPublicKeysByLanguage;
			languageMap[language] = {
				[signer]: publicKey.export({ type: "spki", format: "pem" }).toString(),
			};
			const unsigned = {
				schemaVersion: "naia-memory-semantic-attestation-v1" as const,
				signer,
				role,
				language,
				contractSha256,
				signedAt,
				statement:
					role === "author"
						? ("AUTHORSHIP_CONFIRMED" as const)
						: ("NATIVE_REVIEW_ACCEPTED" as const),
			};
			attestations.push({
				...unsigned,
				signatureBase64: sign(
					null,
					evidenceSignaturePayload(unsigned),
					privateKey,
				).toString("base64"),
			});
		}
	}
	return {
		bundle: {
			schemaVersion: "naia-memory-semantic-attestation-bundle-v1",
			contractSha256,
			attestations,
		},
		policy,
	};
}

async function writeFixture(directory: string, contract = publicContract()) {
	const { bundle, policy } = signedEvidence(contract);
	const paths: [string, string, string] = [
		join(directory, "contract.json"),
		join(directory, "attestations.json"),
		join(directory, "trust-policy.json"),
	];
	await Promise.all([
		writeFile(paths[0], JSON.stringify(contract)),
		writeFile(paths[1], JSON.stringify(bundle)),
		writeFile(paths[2], JSON.stringify(policy)),
	]);
	return { contract, bundle, policy, paths };
}

function hash(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

async function writeExecutionFixture(
	directory: string,
	contract: MemoryUpdateContract,
) {
	const engines = ["hindsight", "mem0", "naia"] as const;
	const plan = buildSemanticCampaignPlan("public-gate", 3, engines);
	const runs = [];
	for (const run of plan) {
		const cases = contract.cases.map((item, executionPosition) => {
			const output = {
				ingestionReceipts: [{ outcome: "opaque" }],
				nativeState: [{ nativeId: "current", content: "current" }],
				retrieved: [{ nativeId: "current", content: "current" }],
			};
			return {
				caseId: item.id,
				executionPosition: executionPosition + 1,
				language: item.language,
				fixtureSha256: hash(
					JSON.stringify({
						language: item.language,
						turns: item.turns,
						query: item.query,
					}),
				),
				engineInputSha256: hash(
					JSON.stringify({
						language: item.language,
						turns: item.turns.map(({ content }) => ({ content })),
						query: item.query,
					}),
				),
				ingestionPolicy: "sequential-turn-commit-v1",
				temporalInputPolicy: "engine-default-ingest-time-v1",
				retrievalSurface: "engine-native-semantic-memory-v1",
				...output,
				outputSha256: hash(JSON.stringify(output)),
			};
		});
		const artifact = {
			schemaVersion: "naia-memory-semantic-raw-artifact-v2",
			disclosure: {
				engine: run.engine,
				executionSeed: run.caseExecutionSeed,
				topK: 5,
			},
			cases,
		};
		const bytes = JSON.stringify(artifact);
		await writeFile(join(directory, run.outputFile), bytes);
		runs.push({ ...run, artifactSha256: hash(bytes) });
	}
	const campaign = {
		schemaVersion: "naia-memory-semantic-campaign-v3" as const,
		disclosure: {
			executionSeed: "public-gate",
			repetitions: 3,
			topK: 5,
			engines: [...engines],
		},
		runs,
	};
	const campaignBytes = Buffer.from(JSON.stringify(campaign));
	const contractSha256 = evidenceObjectSha256(contract);
	const campaignSha256 = hash(campaignBytes);
	const executorPublicKeys: Record<string, string> = {};
	const receipts = engines.map((engine) => {
		const executor = `executor-${engine}`;
		const { privateKey, publicKey } = generateKeyPairSync("ed25519");
		executorPublicKeys[executor] = publicKey
			.export({ type: "spki", format: "pem" })
			.toString();
		const unsigned = {
			schemaVersion: "naia-memory-semantic-execution-receipt-v1" as const,
			executor,
			engine,
			contractSha256,
			campaignSha256,
			campaignRunSetSha256: semanticEngineRunSetSha256(campaign, engine),
			implementationRevision: "a".repeat(40),
			workspaceClean: true as const,
			implementationArtifactSha256: "b".repeat(64),
			configurationSha256: "c".repeat(64),
			startedAt: "2026-01-05T00:00:00Z",
			completedAt: "2026-01-05T00:01:00Z",
			elapsedMs: 60_000,
			estimatedCostUsd: null,
			costDisclosure: "unknown" as const,
			signedAt: "2026-01-05T00:02:00Z",
			statement: "EXECUTION_ARTIFACTS_CONFIRMED" as const,
		};
		return {
			...unsigned,
			signatureBase64: sign(
				null,
				evidenceSignaturePayload(unsigned),
				privateKey,
			).toString("base64"),
		};
	});
	const bundle: SemanticExecutionEvidenceBundle = {
		schemaVersion: "naia-memory-semantic-execution-evidence-bundle-v1",
		contractSha256,
		campaignSha256,
		receipts,
	};
	const paths = [
		join(directory, "campaign.json"),
		join(directory, "execution-evidence.json"),
		join(directory, "execution-trust-policy.json"),
	];
	await Promise.all([
		writeFile(paths[0], campaignBytes),
		writeFile(paths[1], JSON.stringify(bundle)),
		writeFile(paths[2], JSON.stringify({ executorPublicKeys })),
	]);
	return paths;
}

async function writeAdjudicationFixture(
	directory: string,
	contract: MemoryUpdateContract,
	campaignPath: string,
	conflictingAdjudicatorLanguage?: "ko" | "en" | "ja",
) {
	const campaignBytes = await readFile(campaignPath);
	const campaign = JSON.parse(campaignBytes.toString("utf8"));
	const blindingSeed = "public-gate-blinding-seed";
	const contractSha256 = evidenceObjectSha256(contract);
	const campaignSha256 = hash(campaignBytes);
	const artifacts = buildSemanticBlindArtifacts({
		contract,
		campaign,
		campaignDirectory: directory,
		blindingSeed,
		contractSha256,
		campaignSha256,
	});
	const completedAt = "2026-01-06T00:00:00Z";
	const languages = ["ko", "en", "ja"] as const;
	const adjudicatorId = (language: (typeof languages)[number]) =>
		language === conflictingAdjudicatorLanguage
			? `author-${language}`
			: `judge-${language}`;
	const judgments = {
		schemaVersion: "naia-memory-semantic-judgments-v1",
		packetContentSha256: artifacts.packet.packetContentSha256,
		adjudicators: languages.map((language) => ({
			id: adjudicatorId(language),
			nativeLanguages: [language],
			completedAt,
			independentFromEngineImplementers: true,
		})),
		samples: artifacts.packet.samples.map((sample) => ({
			sampleId: sample.sampleId,
			adjudicatorId: adjudicatorId(sample.language),
			judgments: sample.retrieved.map((memory) => ({
				memoryId: memory.memoryId,
				label: "current",
				notes: "",
			})),
		})),
	};
	const judgmentsBytes = Buffer.from(JSON.stringify(judgments));
	const binding = {
		contractSha256,
		campaignSha256,
		packetContentSha256: artifacts.packet.packetContentSha256,
		sealSha256: evidenceObjectSha256(artifacts.seal),
		judgmentsFileSha256: hash(judgmentsBytes),
	};
	const adjudicators: Record<string, unknown> = {};
	const receipts = languages.map((language) => {
		const receiptAdjudicatorId = adjudicatorId(language);
		const { privateKey, publicKey } = generateKeyPairSync("ed25519");
		adjudicators[receiptAdjudicatorId] = {
			publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
			independentOfEngines: ["hindsight", "mem0", "naia"],
			profile: { kind: "human", nativeLanguages: [language] },
		};
		const unsigned = {
			schemaVersion: "naia-memory-semantic-adjudication-receipt-v1" as const,
			adjudicatorId: receiptAdjudicatorId,
			...binding,
			completedAt,
			signedAt: "2026-01-06T00:01:00Z",
			statement: "BLINDED_JUDGMENTS_CONFIRMED" as const,
		};
		return {
			...unsigned,
			signatureBase64: sign(
				null,
				evidenceSignaturePayload(unsigned),
				privateKey,
			).toString("base64"),
		};
	});
	const bundle: SemanticAdjudicationEvidenceBundle = {
		schemaVersion: "naia-memory-semantic-adjudication-evidence-bundle-v1",
		...binding,
		receipts,
	};
	const paths = [
		join(directory, "packet.json"),
		join(directory, "seal.json"),
		join(directory, "judgments.json"),
		join(directory, "adjudication-evidence.json"),
		join(directory, "adjudication-trust-policy.json"),
	];
	await Promise.all([
		writeFile(paths[0], JSON.stringify(artifacts.packet)),
		writeFile(paths[1], JSON.stringify(artifacts.seal)),
		writeFile(paths[2], judgmentsBytes),
		writeFile(paths[3], JSON.stringify(bundle)),
		writeFile(paths[4], JSON.stringify({ adjudicators })),
	]);
	return [...paths, blindingSeed];
}

async function writeAnalysisPlanFixture(
	directory: string,
	contract: MemoryUpdateContract,
) {
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	const requiredIndependentAuthorClustersByLanguage = Object.fromEntries(
		(["ko", "en", "ja"] as const).map((language) => [
			language,
			new Set(
				contract.cases
					.filter((item) => item.split === "test" && item.language === language)
					.map((item) => item.provenance?.authorId),
			).size,
		]),
	);
	const requiredIndependentConstructionClustersByLanguage = Object.fromEntries(
		(["ko", "en", "ja"] as const).map((language) => [
			language,
			new Set(
				contract.cases
					.filter((item) => item.split === "test" && item.language === language)
					.map((item) => item.provenance?.constructionClusterId),
			).size,
		]),
	);
	const unsigned = {
		schemaVersion: "naia-memory-semantic-analysis-plan-v4" as const,
		administrator: "external-statistician",
		contractSha256: evidenceObjectSha256(contract),
		engines: ["hindsight", "mem0", "naia"],
		primaryEngine: "naia" as const,
		primaryMetric: "currentAt1" as const,
		primaryComparisons: ["hindsight", "mem0"],
		familyWiseAlpha: 0.05,
		multiplicityAdjustment: "holm" as const,
		targetPower: 0.8,
		minimumDetectableDifference: 0.1,
		minimumPracticallyImportantDifference: 0.1,
		decisionRule: "holm-all-language-competitor-superiority" as const,
		requiredIndependentAuthorClustersByLanguage,
		requiredIndependentConstructionClustersByLanguage,
		independenceUnit: "construction-cluster" as const,
		sensitivityAnalysis:
			"author-equal-and-family-equal-directional-agreement" as const,
		sampleSizeMethod: "paired-family simulation",
		sampleSizeAssumptionsSha256: "d".repeat(64),
		stoppingRule:
			"collect-all-frozen-test-families-no-outcome-peeking" as const,
		createdAt: "2026-01-04T00:00:00Z",
		signedAt: "2026-01-04T00:01:00Z",
		statement: "ANALYSIS_PLAN_PREREGISTERED" as const,
	};
	const plan = {
		...unsigned,
		signatureBase64: sign(
			null,
			evidenceSignaturePayload(unsigned),
			privateKey,
		).toString("base64"),
	};
	const paths = [
		join(directory, "analysis-plan.json"),
		join(directory, "analysis-plan-trust-policy.json"),
	];
	await Promise.all([
		writeFile(paths[0], JSON.stringify(plan)),
		writeFile(
			paths[1],
			JSON.stringify({
				administratorPublicKeys: {
					"external-statistician": publicKey
						.export({ type: "spki", format: "pem" })
						.toString(),
				},
			}),
		),
	]);
	return paths;
}

function captureStdout(output: string[]): void {
	vi.spyOn(process.stdout, "write").mockImplementation((value) => {
		output.push(String(value));
		return true;
	});
}

function first<T>(values: T[], label: string): T {
	const value = values[0];
	if (value === undefined) throw new Error(`${label} is missing`);
	return value;
}

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(
		roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("semantic public gate CLI", () => {
	it("recomputes signed multilingual adjudication but keeps promotion closed", async () => {
		const output: string[] = [];
		captureStdout(output);
		const directory = await root();
		const fixture = await writeFixture(directory);
		const executionPaths = await writeExecutionFixture(
			directory,
			fixture.contract,
		);
		const adjudicationPaths = await writeAdjudicationFixture(
			directory,
			fixture.contract,
			executionPaths[0],
		);
		const analysisPlanPaths = await writeAnalysisPlanFixture(
			directory,
			fixture.contract,
		);
		expect(
			await runSemanticPublicGateCli([
				...fixture.paths,
				...executionPaths,
				...adjudicationPaths,
				...analysisPlanPaths,
			]),
		).toBe(1);
		expect(JSON.parse(output.pop() ?? "{}")).toMatchObject({
			corpusQualified: true,
			executionEvidenceQualified: true,
			adjudicationEvidenceQualified: true,
			analysisPlanIntegrityQualified: true,
			plannedIndependentAuthorClusterCount: 3,
			sampleSizeAdequacyVerified: false,
			trustedTimestampVerified: false,
			adjudicatorCount: 3,
			humanJudgedLanguages: ["en", "ja", "ko"],
			modelOnlyLanguages: [],
			evidenceScope: "signed-artifact-integrity-and-coverage",
			blindnessVerified: false,
			organizationalIndependenceVerified: false,
			interRaterAgreementEvaluated: false,
			promotable: false,
		});
	});

	it("rejects corpus author identity reuse by an adjudicator through the public gate", async () => {
		const output: string[] = [];
		captureStdout(output);
		const directory = await root();
		const fixture = await writeFixture(directory);
		const executionPaths = await writeExecutionFixture(
			directory,
			fixture.contract,
		);
		const adjudicationPaths = await writeAdjudicationFixture(
			directory,
			fixture.contract,
			executionPaths[0],
			"ko",
		);
		expect(
			await runSemanticPublicGateCli([
				...fixture.paths,
				...executionPaths,
				...adjudicationPaths,
			]),
		).toBe(1);
		expect(JSON.parse(output.pop() ?? "{}")).toEqual({
			promotable: false,
			failure: "semantic adjudication trust overlaps another evidence role",
		});
	});

	it("qualifies signed execution evidence but still refuses quality promotion", async () => {
		const output: string[] = [];
		captureStdout(output);
		const directory = await root();
		const fixture = await writeFixture(directory);
		const executionPaths = await writeExecutionFixture(
			directory,
			fixture.contract,
		);
		expect(
			await runSemanticPublicGateCli([...fixture.paths, ...executionPaths]),
		).toBe(1);
		expect(JSON.parse(output.pop() ?? "{}")).toMatchObject({
			corpusQualified: true,
			executionEvidenceQualified: true,
			engineCount: 3,
			runCount: 9,
			costComplete: false,
			promotable: false,
		});
	});

	it("qualifies the corpus but refuses public promotion without engine execution evidence", async () => {
		const output: string[] = [];
		captureStdout(output);
		const { paths } = await writeFixture(await root());
		expect(await runSemanticPublicGateCli(paths)).toBe(1);
		expect(JSON.parse(output.pop() ?? "{}")).toEqual({
			corpusQualified: true,
			testCaseCount: 102,
			testFamilyCount: 102,
			promotable: false,
			failure:
				"semantic engine execution evidence is not evaluated by this gate",
		});
	});

	it("provides a separate successful gate for corpus qualification", async () => {
		const output: string[] = [];
		captureStdout(output);
		const { paths } = await writeFixture(await root());
		expect(await runSemanticCorpusGateCli(paths)).toBe(0);
		expect(JSON.parse(output.pop() ?? "{}")).toEqual({
			corpusQualified: true,
			testCaseCount: 102,
			testFamilyCount: 102,
		});
	});

	it("reports corpus qualification failures without promotion semantics", async () => {
		const output: string[] = [];
		captureStdout(output);
		const fixture = await writeFixture(await root());
		first(fixture.contract.cases, "case").query = "tampered after review";
		await writeFile(fixture.paths[0], JSON.stringify(fixture.contract));
		expect(await runSemanticCorpusGateCli(fixture.paths)).toBe(1);
		expect(JSON.parse(output.pop() ?? "{}")).toEqual({
			corpusQualified: false,
			failure: "semantic attestation bundle is not bound to the contract",
		});
	});

	it("rejects contract mutation after signatures were issued", async () => {
		const output: string[] = [];
		captureStdout(output);
		const fixture = await writeFixture(await root());
		first(fixture.contract.cases, "case").query = "tampered after review";
		await writeFile(fixture.paths[0], JSON.stringify(fixture.contract));
		expect(await runSemanticPublicGateCli(fixture.paths)).toBe(1);
		expect(JSON.parse(output.pop() ?? "{}").failure).toBe(
			"semantic attestation bundle is not bound to the contract",
		);
	});

	it("rejects missing attestations and signatures issued before the freeze", async () => {
		const output: string[] = [];
		captureStdout(output);
		const fixture = await writeFixture(await root());
		fixture.bundle.attestations.pop();
		await writeFile(fixture.paths[1], JSON.stringify(fixture.bundle));
		expect(await runSemanticPublicGateCli(fixture.paths)).toBe(1);
		expect(JSON.parse(output.pop() ?? "{}").failure).toBe(
			"semantic attestations do not cover all case assignments",
		);

		const preFreeze = signedEvidence(
			fixture.contract,
			"2026-01-03T00:00:00Z",
		).bundle;
		await writeFile(fixture.paths[1], JSON.stringify(preFreeze));
		expect(await runSemanticPublicGateCli(fixture.paths)).toBe(1);
		expect(JSON.parse(output.pop() ?? "{}").failure).toBe(
			"semantic attestation content is invalid",
		);
	});

	it("rejects forged signatures and trust-key reuse across identities", async () => {
		const output: string[] = [];
		captureStdout(output);
		const fixture = await writeFixture(await root());
		first(fixture.bundle.attestations, "attestation").signatureBase64 =
			Buffer.alloc(64).toString("base64");
		await writeFile(fixture.paths[1], JSON.stringify(fixture.bundle));
		expect(await runSemanticPublicGateCli(fixture.paths)).toBe(1);
		expect(JSON.parse(output.pop() ?? "{}").failure).toBe(
			"semantic attestation signature is untrusted or invalid",
		);

		const trusted = signedEvidence(fixture.contract);
		const authorKey =
			trusted.policy.authorPublicKeysByLanguage.ko?.["author-ko"];
		if (!authorKey) throw new Error("fixture author key is missing");
		trusted.policy.authorPublicKeysByLanguage.en = { "author-en": authorKey };
		await Promise.all([
			writeFile(fixture.paths[1], JSON.stringify(trusted.bundle)),
			writeFile(fixture.paths[2], JSON.stringify(trusted.policy)),
		]);
		expect(await runSemanticPublicGateCli(fixture.paths)).toBe(1);
		expect(JSON.parse(output.pop() ?? "{}").failure).toBe(
			"semantic trust keys overlap across identities",
		);
	});

	it("allows unrelated identities in a reusable external trust store", async () => {
		const output: string[] = [];
		captureStdout(output);
		const fixture = await writeFixture(await root());
		const { publicKey } = generateKeyPairSync("ed25519");
		fixture.policy.authorPublicKeysByLanguage.ko = {
			...fixture.policy.authorPublicKeysByLanguage.ko,
			"unrelated-author": publicKey
				.export({ type: "spki", format: "pem" })
				.toString(),
		};
		await writeFile(fixture.paths[2], JSON.stringify(fixture.policy));
		expect(await runSemanticCorpusGateCli(fixture.paths)).toBe(0);
		expect(JSON.parse(output.pop() ?? "{}").corpusQualified).toBe(true);
	});

	it("uses exit code 2 for invalid arity", async () => {
		const errors: string[] = [];
		vi.spyOn(process.stderr, "write").mockImplementation((value) => {
			errors.push(String(value));
			return true;
		});
		expect(await runSemanticPublicGateCli([])).toBe(2);
		expect(await runSemanticPublicGateCli(["a", "b"])).toBe(2);
		expect(await runSemanticCorpusGateCli([])).toBe(2);
		expect(errors).toContainEqual(
			expect.stringContaining("benchmark:semantic-corpus-gate"),
		);
	});

	it("fails closed with sanitized intake errors for each evidence file", async () => {
		const output: string[] = [];
		captureStdout(output);
		const directory = await root();
		const fixture = await writeFixture(directory);
		for (const [index, label] of [
			"contract",
			"attestation bundle",
			"trust policy",
		].entries()) {
			const args = [...fixture.paths];
			args[index] = join(directory, `missing-${index}.json`);
			expect(await runSemanticPublicGateCli(args)).toBe(1);
			expect(JSON.parse(output.pop() ?? "{}").failure).toBe(
				`${label} is unreadable`,
			);
		}
	});

	it("rejects oversized input before parsing", async () => {
		const output: string[] = [];
		captureStdout(output);
		const fixture = await writeFixture(await root());
		await writeFile(fixture.paths[1], Buffer.alloc(16 * 1024 * 1024 + 1));
		expect(await runSemanticPublicGateCli(fixture.paths)).toBe(1);
		expect(JSON.parse(output.pop() ?? "{}").failure).toBe(
			"attestation bundle exceeds the 16 MiB intake limit",
		);
	});
});
