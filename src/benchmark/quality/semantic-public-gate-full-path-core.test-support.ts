import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

export async function writeFixture(
	directory: string,
	contract = publicContract(),
) {
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

export async function writeExecutionFixture(
	directory: string,
	contract: MemoryUpdateContract,
	times = {
		startedAt: "2026-01-05T00:00:00Z",
		completedAt: "2026-01-05T00:01:00Z",
		signedAt: "2026-01-05T00:02:00Z",
	},
	analysisPlanSha256?: string,
	competitiveBinding?: {
		confirmatoryAuthorizationSha256: string;
		analysisPlanTimestampEvidenceSha256: string;
		analysisPlanTimestampTrustPolicyIdentitySha256: string;
	},
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
				endpoint: "https://provider.example/v1/",
				...(run.engine === "mem0" || run.engine === "naia"
					? {
							embeddingModel: "embedding-model",
							embeddingRevision: "embedding-revision",
							embeddingDimensions: 768,
							llmModel: "llm-model",
							authScheme: "bearer",
						}
					: {
							providerPolicy: "engine-server-native-configuration-v1",
							hindsightRuntime: {
								version: "1.0.0",
								imageDigest: `sha256:${"d".repeat(64)}`,
								llmProvider: "provider",
								llmModel: "llm-model",
							},
						}),
			},
			cases,
		};
		const bytes = JSON.stringify(artifact);
		await writeFile(join(directory, run.outputFile), bytes);
		runs.push({ ...run, artifactSha256: hash(bytes) });
	}
	const campaign = {
		schemaVersion: competitiveBinding
			? ("naia-memory-semantic-campaign-v5" as const)
			: analysisPlanSha256
				? ("naia-memory-semantic-campaign-v4" as const)
				: ("naia-memory-semantic-campaign-v3" as const),
		disclosure: {
			executionSeed: "public-gate",
			repetitions: 3,
			topK: 5,
			engines: [...engines],
			...(analysisPlanSha256 ? { analysisPlanSha256 } : {}),
			...(competitiveBinding
				? {
						eligibility: "competitive-candidate" as const,
						...competitiveBinding,
					}
				: {}),
			claimScope: "direct-lifecycle-competitive-report-v1",
			comparisonLanes: {
				directLifecycle: ["hindsight", "mem0"],
				nativeTemporalCharacterization: [],
				agentManagedCharacterization: [],
				productIntegrationDiagnostic: [],
			},
			crossLaneAggregation: "prohibited",
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
			startedAt: times.startedAt,
			completedAt: times.completedAt,
			elapsedMs: 60_000,
			estimatedCostUsd: null,
			costDisclosure: "unknown" as const,
			signedAt: times.signedAt,
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

export async function writeAdjudicationFixture(
	directory: string,
	contract: MemoryUpdateContract,
	campaignPath: string,
	conflictingAdjudicatorLanguage?: "ko" | "en" | "ja",
	completedAt = "2026-01-06T00:00:00Z",
	signedAt = "2026-01-06T00:01:00Z",
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
			signedAt,
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
