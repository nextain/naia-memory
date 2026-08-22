import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FULL_CORPUS_ATTESTATION_ARTIFACT_NAMES } from "./native-full-corpus-attestation-bundle.js";
import { runFullCorpusAttestationCli } from "./native-full-corpus-attestation-cli.js";
import { buildFullCorpusChallengeSigningPacket } from "./native-full-corpus-attestation-packet.js";
import { publishFullCorpusEvidenceReceipt } from "./native-full-corpus-evidence-cli.js";
import {
	EXPECTED_EVALUATION_SOURCE_SHA256,
	EXPECTED_MIRACL_QRELS_SHA256,
	EXPECTED_MIRACL_SOURCE_LOCK_SHA256,
	EXPECTED_MIRACL_TOPICS_SHA256,
	EXPECTED_MIRACL_TOPIC_IDS,
	EXPECTED_QDRANT_COMMIT,
	EXPECTED_QDRANT_VERSION,
	EXPECTED_RUNTIME_MONITOR_SOURCE_SHA256,
	EXPECTED_TREC_EVAL_BINARY_SHA256,
	EXPECTED_TRUE_BATCH_EVALUATION_SOURCE_SHA256,
	MIRACL_EMBEDDING_POLICY,
	MIRACL_FULL_BENCHMARK,
	MIRACL_PASSAGE_COMPOSITION,
	createFullCorpusEvidenceReceipt,
	parseTrecEvalAll,
	sha256Bytes,
} from "./native-full-corpus-evidence.js";
import { fullCorpusEmbeddingExecutionPolicy } from "./native-full-corpus-policy.js";
import {
	deriveFullCorpusExecutionBinding,
	evaluateFullCorpusPublicAttestation,
	evaluateTimestampQualifiedFullCorpusPublicAttestation,
} from "./native-full-corpus-public-attestation.js";
import {
	evidenceObjectSha256,
	evidenceSignaturePayload,
} from "./public-evidence-crypto.js";
import { PublicEvidenceDirectorySyncError } from "./public-evidence-file-io.js";
import { MIRACL_KO_LOCK } from "./public-miracl-source.js";

const baselinePolicy = fullCorpusEmbeddingExecutionPolicy(
	MIRACL_EMBEDDING_POLICY,
	MIRACL_PASSAGE_COMPOSITION,
	"per-item-v1",
);
const trecRunText = `${[...EXPECTED_MIRACL_TOPIC_IDS]
	.map((queryId) =>
		Array.from(
			{ length: 100 },
			(_, rank) =>
				`${queryId} Q0 d${queryId}-${rank + 1} ${rank + 1} ${100 - rank} test`,
		).join("\n"),
	)
	.join("\n")}\n`;
const trecSha256 = sha256Bytes(trecRunText);

const result = {
	benchmark: MIRACL_FULL_BENCHMARK,
	inputs: {
		sourceLockSha256: EXPECTED_MIRACL_SOURCE_LOCK_SHA256,
		topicsSha256: EXPECTED_MIRACL_TOPICS_SHA256,
		qrelsSha256: EXPECTED_MIRACL_QRELS_SHA256,
		documentCount: 1_486_752,
		queryCount: 213,
		corpusDocidsSha256: "corpus-docids",
	},
	configuration: {
		passageComposition: MIRACL_PASSAGE_COMPOSITION,
		embedding: MIRACL_EMBEDDING_POLICY,
		embeddingInferenceMode: "per-item-v1" as const,
		embeddingExecutionPolicySha256: baselinePolicy.embeddingPolicySha256,
		vectorStore: "Qdrant",
		distance: "Cosine",
		exactSearch: true,
		topK: 100,
		cpuOnly: true,
		collectionName: `naia_miracl_ko_${EXPECTED_MIRACL_SOURCE_LOCK_SHA256.slice(0, 8)}_${baselinePolicy.embeddingPolicySha256.slice(0, 8)}`,
	},
	metrics: { ndcgAt10: 0.4123454, recallAt100: 0.7654321 },
	ingestion: { lastChunkReceiptSha256: "last-receipt" },
	trecSha256,
};

function evidence(overrides = {}) {
	const {
		result: resultOverride = result,
		launchReceipt: launchReceiptOverride,
		runtimeObservation: runtimeObservationOverride,
		...remainingOverrides
	} = overrides as {
		result?: typeof result;
		launchReceipt?: Record<string, unknown>;
		runtimeObservation?: Record<string, unknown>;
		[key: string]: unknown;
	};
	const resultText = JSON.stringify(resultOverride);
	const launchReceipt = launchReceiptOverride ?? {
		pid: 123,
		capturedAt: "2026-08-22T00:00:00.000Z",
		procStartTicks: "12345",
		bootId: "boot-a",
		cmdline: ["node", "native-full-corpus-evaluation-cli.ts"],
		cudaVisibleDevices: "",
		qdrantUrl: "http://127.0.0.1:6334",
		outputPath: "/outputs/result.json",
		evaluationSourceSha256: EXPECTED_EVALUATION_SOURCE_SHA256,
	};
	const launchReceiptPath = "/outputs/launch.json";
	const launchReceiptText = JSON.stringify(launchReceipt);
	const runtimeObservation = runtimeObservationOverride ?? {
		schemaVersion: 1,
		monitor: {
			source:
				"/repo/src/benchmark/quality/native-full-corpus-runtime-monitor-cli.ts",
			sourceSha256: EXPECTED_RUNTIME_MONITOR_SOURCE_SHA256,
		},
		launchReceipt: {
			path: launchReceiptPath,
			sha256: sha256Bytes(launchReceiptText),
		},
		process: {
			pid: 123,
			bootId: "boot-a",
			procStartTicks: "12345",
			cmdlineSha256: sha256Bytes(
				["node", "native-full-corpus-evaluation-cli.ts"].join("\0"),
			),
		},
		observation: {
			startedAt: "2026-08-22T00:05:00.000Z",
			completedAt: "2026-08-22T00:10:00.000Z",
			pollMilliseconds: 5_000,
			samples: 2,
			peakRssBytes: 4096,
		},
		result: { path: "/outputs/result.json", sha256: sha256Bytes(resultText) },
	};
	return {
		resultText,
		resultSha256: sha256Bytes(resultText),
		trecSha256,
		trecRunText,
		topicsSha256: EXPECTED_MIRACL_TOPICS_SHA256,
		qrelsSha256: EXPECTED_MIRACL_QRELS_SHA256,
		trecEvalStdout: "ndcg_cut_10 all 0.412345\nrecall_100 all 0.765432\n",
		trecEvalBinarySha256: EXPECTED_TREC_EVAL_BINARY_SHA256,
		trecEvalSourceCommit: "ba38899cbd4de0fb699b47f39b64ef1c107e4a5c",
		trecEvalPath: "/tools/trec_eval",
		evaluationStability: {
			trecBeforeSha256: trecSha256,
			trecAfterSha256: trecSha256,
			qrelsBeforeSha256: EXPECTED_MIRACL_QRELS_SHA256,
			qrelsAfterSha256: EXPECTED_MIRACL_QRELS_SHA256,
			binaryBeforeSha256: EXPECTED_TREC_EVAL_BINARY_SHA256,
			binaryAfterSha256: EXPECTED_TREC_EVAL_BINARY_SHA256,
			sourceCommitBefore: "ba38899cbd4de0fb699b47f39b64ef1c107e4a5c",
			sourceCommitAfter: "ba38899cbd4de0fb699b47f39b64ef1c107e4a5c",
		},
		topicsPath: "/inputs/miracl-v1.0-ko/topics/topics.miracl-v1.0-ko-dev.tsv",
		qrelsPath: "/inputs/miracl-v1.0-ko/qrels/qrels.miracl-v1.0-ko-dev.tsv",
		trecPath: "/outputs/result.json.trec",
		checkpointChain: {
			directory: "/checkpoints/vectors",
			chunkCount: 2_904,
			documentCount: 1_486_752,
			docidsSha256: "corpus-docids",
			lastChunkReceiptSha256: "last-receipt",
		},
		launchReceiptPath,
		launchReceiptText,
		runtimeObservationPath: "/outputs/runtime.json",
		runtimeObservationText: JSON.stringify(runtimeObservation),
		qdrant: {
			version: EXPECTED_QDRANT_VERSION,
			commit: EXPECTED_QDRANT_COMMIT,
			pointsCount: 1_486_752,
			status: "green",
			vectorSize: 1024,
			distance: "Cosine",
			hnswM: 0,
			indexingThreshold: 0,
		},
		...remainingOverrides,
	};
}

function parsedLaunchReceipt() {
	return JSON.parse(evidence().launchReceiptText);
}

function parsedRuntimeObservation() {
	return JSON.parse(evidence().runtimeObservationText);
}

describe("full-corpus independent evidence", () => {
	it("publishes exact receipt bytes through the exclusive durable writer", async () => {
		const writer = vi.fn(async () => undefined);
		await publishFullCorpusEvidenceReceipt(
			"relative/evidence.json",
			{ verdict: "LOCAL_PASS" },
			writer,
		);
		expect(writer).toHaveBeenCalledOnce();
		expect(writer.mock.calls[0]?.[0]).toBe(
			join(process.cwd(), "relative/evidence.json"),
		);
		expect(writer.mock.calls[0]?.[1]).toEqual(
			Buffer.from('{\n  "verdict": "LOCAL_PASS"\n}\n'),
		);
	});

	it("fails closed when the evidence output already exists", async () => {
		const conflict = Object.assign(new Error("conflict"), { code: "EEXIST" });
		await expect(
			publishFullCorpusEvidenceReceipt("evidence.json", {}, async () => {
				throw conflict;
			}),
		).rejects.toThrow("full-corpus evidence output already exists");
	});

	it("distinguishes a written output whose directory sync was not confirmed", async () => {
		await expect(
			publishFullCorpusEvidenceReceipt("evidence.json", {}, async (path) => {
				throw new PublicEvidenceDirectorySyncError(path, new Error("sync"));
			}),
		).rejects.toThrow(
			"was written but crash-durability could not be confirmed",
		);
	});

	it("fails closed for an unclassified evidence writer failure", async () => {
		await expect(
			publishFullCorpusEvidenceReceipt("evidence.json", {}, async () => {
				throw new Error("disk unavailable");
			}),
		).rejects.toThrow("full-corpus evidence output cannot be written");
	});

	it("parses only aggregate trec_eval rows", () => {
		expect(parseTrecEvalAll("ndcg_cut_10 all 0.5\n").get("ndcg_cut_10")).toBe(
			0.5,
		);
		expect(() => parseTrecEvalAll("ndcg_cut_10 1 0.5\n")).toThrow("invalid");
	});

	it("binds independent metrics, artifacts, runtime, and latency semantics", () => {
		const receipt = createFullCorpusEvidenceReceipt(evidence());
		expect(receipt.schemaVersion).toBe(3);
		expect(receipt.verdict).toBe("LOCAL_PASS");
		expect(receipt).toMatchObject({
			assurance: "self-observed-local",
			publicClaimEligible: false,
			publicClaimRequirement:
				"independent signed execution attestation from a runner outside the benchmark operator trust boundary",
		});
		expect(sha256Bytes(`${JSON.stringify(MIRACL_KO_LOCK, null, 2)}\n`)).toBe(
			EXPECTED_MIRACL_SOURCE_LOCK_SHA256,
		);
		expect(receipt).toHaveProperty("independentEvaluatorTool");
		expect(receipt.independentEvaluatorTool.executionStability).toEqual(
			evidence().evaluationStability,
		);
		expect(receipt.artifacts.topics).toEqual({
			path: "/inputs/miracl-v1.0-ko/topics/topics.miracl-v1.0-ko-dev.tsv",
			sha256: EXPECTED_MIRACL_TOPICS_SHA256,
		});
		expect(receipt.artifacts.qrels).toEqual({
			path: "/inputs/miracl-v1.0-ko/qrels/qrels.miracl-v1.0-ko-dev.tsv",
			sha256: EXPECTED_MIRACL_QRELS_SHA256,
		});
		expect(receipt.artifacts.launchReceipt).toEqual({
			path: evidence().launchReceiptPath,
			sha256: sha256Bytes(evidence().launchReceiptText),
		});
		expect(receipt.artifacts.runtimeObservation).toEqual({
			path: evidence().runtimeObservationPath,
			sha256: sha256Bytes(evidence().runtimeObservationText),
		});
		expect(receipt).not.toHaveProperty("independentEvaluator");
		expect(receipt.metrics).toHaveProperty("reproducedByIndependentTool");
		expect(receipt.metrics).not.toHaveProperty("independent");
		expect(receipt.metrics.deltas.ndcgAt10).toBeLessThanOrEqual(1e-6);
		expect(receipt.runtime.latencySemantics).toContain("query-embedding");
		expect(receipt.runtime.attachmentDelayMilliseconds).toBe(300_000);
		expect(receipt.runtime.observationBoundary).toContain("after-launch");
		const binding = deriveFullCorpusExecutionBinding(JSON.stringify(receipt));
		expect(binding.engine).toBe(MIRACL_FULL_BENCHMARK);
		expect(binding.receiptSha256).toBe(sha256Bytes(JSON.stringify(receipt)));
	});

	it("keeps public eligibility detached, externally signed, and fail-closed", () => {
		const receipt = createFullCorpusEvidenceReceipt(evidence());
		const receiptText = JSON.stringify(receipt);
		const binding = deriveFullCorpusExecutionBinding(receiptText);
		const issuerKeys = generateKeyPairSync("ed25519");
		const runnerKeys = generateKeyPairSync("ed25519");
		const signed = <T extends Record<string, unknown>>(
			value: T,
			privateKey: typeof issuerKeys.privateKey,
		) => ({
			...value,
			signatureBase64: sign(
				null,
				evidenceSignaturePayload(value),
				privateKey,
			).toString("base64"),
		});
		const challenge = signed(
			{
				schemaVersion: "naia-memory-public-execution-challenge-v1" as const,
				issuer: "external-issuer",
				challengeId: "miracl-ko-public-run-1",
				nonce: "0123456789abcdef0123456789abcdef",
				engine: binding.engine,
				datasetSha256: binding.datasetSha256,
				protocolSha256: binding.protocolSha256,
				issuedAt: "2026-08-21T23:59:00.000Z",
				expiresAt: "2026-08-22T01:00:00.000Z",
			},
			issuerKeys.privateKey,
		);
		const attestation = signed(
			{
				schemaVersion: "naia-memory-public-execution-attestation-v1" as const,
				runner: "external-runner",
				challengeId: challenge.challengeId,
				nonce: challenge.nonce,
				...binding,
				startedAt: "2026-08-22T00:00:00.000Z",
				finishedAt: "2026-08-22T00:10:00.000Z",
			},
			runnerKeys.privateKey,
		);
		const trust = {
			challengeIssuerKeys: {
				"external-issuer": issuerKeys.publicKey
					.export({ type: "spki", format: "pem" })
					.toString(),
			},
			runnerKeys: {
				"external-runner": runnerKeys.publicKey
					.export({ type: "spki", format: "pem" })
					.toString(),
			},
			benchmarkOperatorTrustDomain: "nextain-operator",
			runnerTrustDomains: { "external-runner": "independent-lab" },
		};
		const verdict = evaluateFullCorpusPublicAttestation({
			receiptPath: "/evidence/local-pass.json",
			receiptText,
			challenge,
			attestation,
			...trust,
		});
		expect(verdict.publicClaimEligible).toBe(true);
		expect(verdict.publicationGateEligible).toBe(false);
		expect(receipt.publicClaimEligible).toBe(false);

		const staleChallenge = signed(
			{
				...challenge,
				issuedAt: "2026-08-23T00:00:00.000Z",
				expiresAt: "2026-08-23T01:00:00.000Z",
				signatureBase64: undefined,
			},
			issuerKeys.privateKey,
		);
		const staleAttestation = signed(
			{
				...attestation,
				startedAt: "2026-08-23T00:10:00.000Z",
				finishedAt: "2026-08-23T00:20:00.000Z",
				signatureBase64: undefined,
			},
			runnerKeys.privateKey,
		);
		const staleReplay = evaluateFullCorpusPublicAttestation({
			receiptPath: "/evidence/local-pass.json",
			receiptText,
			challenge: staleChallenge,
			attestation: staleAttestation,
			...trust,
		});
		expect(staleReplay.publicClaimEligible).toBe(false);
		expect(staleReplay.failures).toContain(
			`${MIRACL_FULL_BENCHMARK}: execution receipt launch is outside the challenge window`,
		);
		expect(staleReplay.failures).toContain(
			`${MIRACL_FULL_BENCHMARK}: execution startedAt does not match the receipt launch`,
		);

		const byteSubstitution = evaluateFullCorpusPublicAttestation({
			receiptPath: "/evidence/local-pass.json",
			receiptText: `${receiptText}\n`,
			challenge,
			attestation,
			...trust,
		});
		expect(byteSubstitution.publicClaimEligible).toBe(false);
		expect(byteSubstitution.failures).toContain(
			`${MIRACL_FULL_BENCHMARK}: execution receiptSha256 mismatch`,
		);

		const sameDomain = evaluateFullCorpusPublicAttestation({
			receiptPath: "/evidence/local-pass.json",
			receiptText,
			challenge,
			attestation,
			...trust,
			runnerTrustDomains: { "external-runner": "nextain-operator" },
		});
		expect(sameDomain.publicClaimEligible).toBe(false);
	});

	it("requires trusted timestamps over the complete signed challenge and attestation", () => {
		const directory = mkdtempSync(join(tmpdir(), "naia-full-corpus-time-"));
		try {
			const receiptText = JSON.stringify(
				createFullCorpusEvidenceReceipt(evidence()),
			);
			const binding = deriveFullCorpusExecutionBinding(receiptText);
			const issuerKeys = generateKeyPairSync("ed25519");
			const runnerKeys = generateKeyPairSync("ed25519");
			const signed = <T extends Record<string, unknown>>(
				value: T,
				privateKey: typeof issuerKeys.privateKey,
			) => ({
				...value,
				signatureBase64: sign(
					null,
					evidenceSignaturePayload(value),
					privateKey,
				).toString("base64"),
			});
			const challenge = signed(
				{
					schemaVersion: "naia-memory-public-execution-challenge-v1" as const,
					issuer: "external-issuer",
					challengeId: "timestamped-run-1",
					nonce: "abcdef0123456789abcdef0123456789",
					engine: binding.engine,
					datasetSha256: binding.datasetSha256,
					protocolSha256: binding.protocolSha256,
					issuedAt: "2026-08-21T23:58:00.000Z",
					expiresAt: "2026-08-22T01:00:00.000Z",
				},
				issuerKeys.privateKey,
			);
			const attestation = signed(
				{
					schemaVersion: "naia-memory-public-execution-attestation-v1" as const,
					runner: "external-runner",
					challengeId: challenge.challengeId,
					nonce: challenge.nonce,
					...binding,
					startedAt: "2026-08-22T00:00:00.000Z",
					finishedAt: "2026-08-22T00:10:00.000Z",
				},
				runnerKeys.privateKey,
			);
			const token = Buffer.from("timestamp token");
			const ca = Buffer.from("timestamp CA");
			const tokenPath = join(directory, "timestamp.tsr");
			const caPath = join(directory, "tsa-ca.pem");
			writeFileSync(tokenPath, token);
			writeFileSync(caPath, ca);
			const evidenceFor = (artifact: unknown) => ({
				schemaVersion:
					"naia-memory-rfc3161-digest-timestamp-evidence-v1" as const,
				artifactSha256: evidenceObjectSha256(artifact),
				tokenSha256: createHash("sha256").update(token).digest("hex"),
				tokenPath,
			});
			const timestampTrust = {
				schemaVersion: "naia-memory-rfc3161-timestamp-trust-policy-v1" as const,
				trustedCaFilePath: caPath,
				trustedCaFileSha256: createHash("sha256").update(ca).digest("hex"),
				requiredPolicyOid: "1.2.3.4",
			};
			let inspection = 0;
			const timestampCommandRunner = (args: string[]) => {
				if (args.includes("-verify"))
					return { status: 0, stdout: "OK", stderr: "" };
				inspection += 1;
				const time =
					inspection === 1
						? "Aug 21 23:59:00 2026 GMT"
						: "Aug 22 00:11:00 2026 GMT";
				return {
					status: 0,
					stdout: `Policy OID: 1.2.3.4\nTime stamp: ${time}\n`,
					stderr: "",
				};
			};
			const common = {
				receiptPath: "/evidence/local-pass.json",
				receiptText,
				challenge,
				attestation,
				challengeIssuerKeys: {
					"external-issuer": issuerKeys.publicKey
						.export({ type: "spki", format: "pem" })
						.toString(),
				},
				runnerKeys: {
					"external-runner": runnerKeys.publicKey
						.export({ type: "spki", format: "pem" })
						.toString(),
				},
				benchmarkOperatorTrustDomain: "nextain-operator",
				runnerTrustDomains: { "external-runner": "independent-lab" },
				challengeTimestampEvidence: evidenceFor(challenge),
				challengeTimestampTrustPolicy: timestampTrust,
				attestationTimestampEvidence: evidenceFor(attestation),
				attestationTimestampTrustPolicy: timestampTrust,
				timestampCommandRunner,
			};
			const verdict =
				evaluateTimestampQualifiedFullCorpusPublicAttestation(common);
			expect(verdict.verdict).toBe(
				"TIMESTAMP_QUALIFIED_PUBLIC_ATTESTATION_PASS",
			);
			expect(verdict.publicClaimEligible).toBe(true);
			expect(verdict.publicationGateEligible).toBe(true);
			expect(verdict.assuranceModel).toBe(
				"trusted-runner-signature-with-rfc3161-chronology",
			);
			expect(verdict.timestampQualification.challengeTrustPolicySha256).toBe(
				evidenceObjectSha256({
					schemaVersion: 1,
					trustedCaFileSha256: timestampTrust.trustedCaFileSha256,
					requiredPolicyOid: timestampTrust.requiredPolicyOid,
				}),
			);

			inspection = 0;
			const substituted = evaluateTimestampQualifiedFullCorpusPublicAttestation(
				{
					...common,
					challengeTimestampEvidence: evidenceFor({
						...challenge,
						signatureBase64: "substituted",
					}),
				},
			);
			expect(substituted.publicClaimEligible).toBe(false);
			expect(
				substituted.failures.some((failure) =>
					failure.includes("artifact hash mismatch"),
				),
			).toBe(true);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("rejects binding-manifest and base-receipt substitution", () => {
		const receipt = createFullCorpusEvidenceReceipt(evidence());
		for (const [manifest, mutate, expectedHash] of [
			[
				"dataset",
				(value: typeof receipt) => {
					value.attestationBinding.manifests.dataset.documentCount += 1;
				},
				"datasetSha256",
			],
			[
				"protocol",
				(value: typeof receipt) => {
					value.attestationBinding.manifests.protocol.topK += 1;
				},
				"protocolSha256",
			],
			[
				"implementation",
				(value: typeof receipt) => {
					value.attestationBinding.manifests.implementation.qdrantCommit =
						"substituted";
				},
				"implementationArtifactSha256",
			],
			[
				"configuration",
				(value: typeof receipt) => {
					value.attestationBinding.manifests.configuration.topK += 1;
				},
				"configurationSha256",
			],
			[
				"execution evidence",
				(value: typeof receipt) => {
					value.attestationBinding.manifests.executionEvidence.resultSha256 =
						"0".repeat(64);
				},
				"executionEvidenceSha256",
			],
		] as const) {
			const tampered = structuredClone(receipt);
			mutate(tampered);
			expect(
				() => deriveFullCorpusExecutionBinding(JSON.stringify(tampered)),
				manifest,
			).toThrow(`${expectedHash} manifest mismatch`);
		}

		const promoted = { ...receipt, publicClaimEligible: true };
		expect(() =>
			deriveFullCorpusExecutionBinding(JSON.stringify(promoted)),
		).toThrow("eligible LOCAL_PASS base");
	});

	it("emits an external signing packet and verifies bounded file inputs", async () => {
		const receiptText = JSON.stringify(
			createFullCorpusEvidenceReceipt(evidence()),
		);
		const binding = deriveFullCorpusExecutionBinding(receiptText);
		const packet = buildFullCorpusChallengeSigningPacket({
			receiptText,
			issuer: "external-issuer",
			challengeId: "miracl-ko-independent-run-2026-08-23",
			nonce: "0123456789abcdef0123456789abcdef",
			issuedAt: "2026-08-21T23:59:00.000Z",
			expiresAt: "2026-08-22T01:00:00.000Z",
		});
		expect(Buffer.from(packet.signingPayloadBase64, "base64")).toEqual(
			evidenceSignaturePayload(packet.unsignedChallenge),
		);
		expect(packet.baseReceiptSha256).toBe(binding.receiptSha256);

		const issuerKeys = generateKeyPairSync("ed25519");
		const runnerKeys = generateKeyPairSync("ed25519");
		const challenge = {
			...packet.unsignedChallenge,
			signatureBase64: sign(
				null,
				evidenceSignaturePayload(packet.unsignedChallenge),
				issuerKeys.privateKey,
			).toString("base64"),
		};
		const unsignedAttestation = {
			schemaVersion: "naia-memory-public-execution-attestation-v1" as const,
			runner: "external-runner",
			challengeId: challenge.challengeId,
			nonce: challenge.nonce,
			...binding,
			startedAt: "2026-08-22T00:00:00.000Z",
			finishedAt: "2026-08-22T00:10:00.000Z",
		};
		const attestation = {
			...unsignedAttestation,
			signatureBase64: sign(
				null,
				evidenceSignaturePayload(unsignedAttestation),
				runnerKeys.privateKey,
			).toString("base64"),
		};
		const trust = {
			challengeIssuerKeys: {
				"external-issuer": issuerKeys.publicKey
					.export({ type: "spki", format: "pem" })
					.toString(),
			},
			runnerKeys: {
				"external-runner": runnerKeys.publicKey
					.export({ type: "spki", format: "pem" })
					.toString(),
			},
			benchmarkOperatorTrustDomain: "nextain-operator",
			runnerTrustDomains: { "external-runner": "independent-lab" },
		};
		const root = mkdtempSync(join(tmpdir(), "miracl-attestation-"));
		const paths = ["receipt", "challenge", "attestation", "trust"].map((name) =>
			join(root, `${name}.json`),
		);
		try {
			for (const [path, value] of paths.map(
				(path, index) =>
					[
						path,
						[JSON.parse(receiptText), challenge, attestation, trust][index],
					] as const,
			))
				writeFileSync(path, JSON.stringify(value));
			const output: string[] = [];
			vi.spyOn(process.stdout, "write").mockImplementation((value) => {
				output.push(String(value));
				return true;
			});
			expect(
				await runFullCorpusAttestationCli([
					"challenge",
					paths[0] as string,
					"external-issuer",
					"miracl-ko-independent-run-2026-08-23",
					"0123456789abcdef0123456789abcdef",
					"2026-08-21T23:59:00.000Z",
					"2026-08-22T01:00:00.000Z",
				]),
			).toBe(0);
			expect(JSON.parse(output.pop() ?? "{}").packetSha256).toBe(
				packet.packetSha256,
			);
			expect(await runFullCorpusAttestationCli(["verify", ...paths])).toBe(0);
			expect(JSON.parse(output.pop() ?? "{}").publicClaimEligible).toBe(true);
			writeFileSync(paths[2] as string, "{}");
			expect(await runFullCorpusAttestationCli(["verify", ...paths])).toBe(1);
			expect(JSON.parse(output.pop() ?? "{}").failure).toBe(
				"attestation shape is invalid",
			);
			writeFileSync(paths[2] as string, JSON.stringify(attestation));
			writeFileSync(paths[3] as string, JSON.stringify({ runnerKeys: {} }));
			expect(await runFullCorpusAttestationCli(["verify", ...paths])).toBe(1);
			expect(JSON.parse(output.pop() ?? "{}").failure).toBe(
				"trust policy shape is invalid",
			);
			writeFileSync(paths[3] as string, JSON.stringify(trust));
			const timestampPaths = [
				"challenge-timestamp",
				"challenge-timestamp-trust",
				"attestation-timestamp",
				"attestation-timestamp-trust",
			].map((name) => join(root, `${name}.json`));
			for (const path of timestampPaths) writeFileSync(path, "{}");
			expect(
				await runFullCorpusAttestationCli([
					"verify-timestamped",
					...paths,
					...timestampPaths,
				]),
			).toBe(1);
			expect(JSON.parse(output.pop() ?? "{}").failure).toBe(
				"challenge timestamp evidence shape is invalid",
			);

			const token = Buffer.from("timestamp token");
			const ca = Buffer.from("timestamp CA");
			const tokenPath = join(root, "timestamp.tsr");
			const caPath = join(root, "tsa-ca.pem");
			writeFileSync(tokenPath, token);
			writeFileSync(caPath, ca);
			const timestampEvidenceFor = (artifact: unknown) => ({
				schemaVersion:
					"naia-memory-rfc3161-digest-timestamp-evidence-v1" as const,
				artifactSha256: evidenceObjectSha256(artifact),
				tokenSha256: createHash("sha256").update(token).digest("hex"),
				tokenPath: join(root, "must-not-be-read", "timestamp.tsr"),
			});
			const timestampTrust = {
				schemaVersion: "naia-memory-rfc3161-timestamp-trust-policy-v1" as const,
				trustedCaFilePath: join(root, "must-not-be-read", "tsa-ca.pem"),
				trustedCaFileSha256: createHash("sha256").update(ca).digest("hex"),
				requiredPolicyOid: "1.2.3.4",
			};
			for (const [path, value] of timestampPaths.map(
				(path, index) =>
					[
						path,
						[
							timestampEvidenceFor(challenge),
							timestampTrust,
							timestampEvidenceFor(attestation),
							timestampTrust,
						][index],
					] as const,
			))
				writeFileSync(path, JSON.stringify(value));

			const artifactPaths = [
				...paths,
				...timestampPaths,
				tokenPath,
				caPath,
				tokenPath,
				caPath,
			];
			const artifactSha256 = Object.fromEntries(
				FULL_CORPUS_ATTESTATION_ARTIFACT_NAMES.map((name, index) => [
					name,
					createHash("sha256")
						.update(readFileSync(artifactPaths[index] as string))
						.digest("hex"),
				]),
			);
			const bundle = {
				schemaVersion: "naia-memory-full-corpus-attestation-bundle-v1",
				artifacts: Object.fromEntries(
					FULL_CORPUS_ATTESTATION_ARTIFACT_NAMES.map((name, index) => [
						name,
						{
							path: basename(artifactPaths[index] as string),
							sha256: artifactSha256[name],
						},
					]),
				),
			};
			const bundlePath = join(root, "bundle.json");
			const bundleText = JSON.stringify(bundle);
			writeFileSync(bundlePath, bundleText);
			let inspection = 0;
			const timestampCommandRunner = (
				args: string[],
				actualToken: Buffer,
				actualCa: Buffer,
			) => {
				expect(actualToken).toEqual(token);
				expect(actualCa).toEqual(ca);
				if (args.includes("-verify"))
					return { status: 0, stdout: "OK", stderr: "" };
				inspection += 1;
				return {
					status: 0,
					stdout: `Policy OID: 1.2.3.4\nTime stamp: ${
						inspection === 1
							? "Aug 21 23:59:00 2026 GMT"
							: "Aug 22 00:11:00 2026 GMT"
					}\n`,
					stderr: "",
				};
			};
			expect(
				await runFullCorpusAttestationCli(["verify-bundle", bundlePath], {
					timestampCommandRunner,
				}),
			).toBe(0);
			const bundledVerdict = JSON.parse(output.pop() ?? "{}");
			expect(bundledVerdict.verdict).toBe(
				"TIMESTAMP_QUALIFIED_PUBLIC_ATTESTATION_PASS",
			);
			expect(bundledVerdict.publicClaimEligible).toBe(true);
			expect(bundledVerdict.verificationBundle.manifestSha256).toBe(
				createHash("sha256").update(bundleText).digest("hex"),
			);
			expect(bundledVerdict.verificationBundle.artifactSha256).toEqual(
				artifactSha256,
			);
		} finally {
			vi.restoreAllMocks();
			rmSync(root, { recursive: true });
		}
	});

	it("binds the true-batch result to its candidate source and collection", () => {
		const policy = fullCorpusEmbeddingExecutionPolicy(
			MIRACL_EMBEDDING_POLICY,
			MIRACL_PASSAGE_COMPOSITION,
			"padded-array-batch-v1",
		);
		const candidateResult = {
			...result,
			configuration: {
				...result.configuration,
				passageComposition: MIRACL_PASSAGE_COMPOSITION,
				embedding: MIRACL_EMBEDDING_POLICY,
				embeddingInferenceMode: "padded-array-batch-v1" as const,
				embeddingExecutionPolicySha256: policy.embeddingPolicySha256,
				collectionName: `naia_miracl_ko_${EXPECTED_MIRACL_SOURCE_LOCK_SHA256.slice(0, 8)}_${policy.embeddingPolicySha256.slice(0, 8)}`,
			},
		};
		const launchReceipt = {
			...parsedLaunchReceipt(),
			evaluationSourceSha256: EXPECTED_TRUE_BATCH_EVALUATION_SOURCE_SHA256,
			embeddingInferenceMode: "padded-array-batch-v1" as const,
		};
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({ result: candidateResult, launchReceipt }),
			),
		).not.toThrow();
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					result: candidateResult,
					launchReceipt: {
						...launchReceipt,
						evaluationSourceSha256: EXPECTED_EVALUATION_SOURCE_SHA256,
					},
				}),
			),
		).toThrow("launch evidence");
	});

	it("rejects omitted or substituted embedding identity for the baseline", () => {
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					result: {
						...result,
						configuration: { ...result.configuration, embedding: undefined },
					},
				}),
			),
		).toThrow("embedding identity");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					result: {
						...result,
						configuration: {
							...result.configuration,
							embedding: { ...MIRACL_EMBEDDING_POLICY, revision: "changed" },
						},
					},
				}),
			),
		).toThrow("embedding identity");
	});

	it("rejects a result hash that does not bind the parsed result content", () => {
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({ resultSha256: "forged-result-hash" }),
			),
		).toThrow("result content hash");
	});

	it("rejects launch artifact substitution against the observed raw hash", () => {
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					launchReceipt: {
						...parsedLaunchReceipt(),
						capturedAt: "2026-08-22T00:00:01.000Z",
					},
					runtimeObservation: parsedRuntimeObservation(),
				}),
			),
		).toThrow("runtime observation");
	});

	it("rejects a runtime observation that names a different launch artifact", () => {
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					runtimeObservation: {
						...parsedRuntimeObservation(),
						launchReceipt: {
							...parsedRuntimeObservation().launchReceipt,
							path: "/outputs/substituted-launch.json",
						},
					},
				}),
			),
		).toThrow("runtime observation");
	});

	it("rejects incomplete TREC query coverage even when its hash is consistent", () => {
		const incompleteTrec = trecRunText
			.split("\n")
			.filter((line) => !line.startsWith("1582 "))
			.join("\n");
		const incompleteSha256 = sha256Bytes(incompleteTrec);
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					trecRunText: incompleteTrec,
					trecSha256: incompleteSha256,
					result: {
						...result,
						trecSha256: incompleteSha256,
					},
				}),
			),
		).toThrow("TREC query cardinality");
	});

	it("rejects substituted query IDs even when count and depth are unchanged", () => {
		const substitutedTrec = trecRunText.replaceAll(/^1582 /gm, "999999 ");
		const substitutedSha256 = sha256Bytes(substitutedTrec);
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					trecRunText: substitutedTrec,
					trecSha256: substitutedSha256,
					result: { ...result, trecSha256: substitutedSha256 },
				}),
			),
		).toThrow("TREC coverage mismatch");
	});

	it("rejects a substituted or incomplete checkpoint chain", () => {
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					checkpointChain: {
						...evidence().checkpointChain,
						lastChunkReceiptSha256: "substituted",
					},
				}),
			),
		).toThrow("checkpoint chain");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					checkpointChain: {
						...evidence().checkpointChain,
						chunkCount: 2_903,
					},
				}),
			),
		).toThrow("checkpoint chain");
	});

	it("fails closed on metric, artifact, policy, and runtime drift", () => {
		expect(() =>
			createFullCorpusEvidenceReceipt(evidence({ topicsSha256: "changed" })),
		).toThrow("canonical topics hash");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					topicsSha256: "changed",
					result: {
						...result,
						inputs: { ...result.inputs, topicsSha256: "changed" },
					},
				}),
			),
		).toThrow("canonical topics hash");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({ topicsPath: "/inputs/substituted-topics.tsv" }),
			),
		).toThrow("canonical topics hash");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					result: {
						...result,
						inputs: { ...result.inputs, sourceLockSha256: "changed" },
					},
				}),
			),
		).toThrow("source lock");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					qrelsSha256: "changed",
					result: {
						...result,
						inputs: { ...result.inputs, qrelsSha256: "changed" },
					},
				}),
			),
		).toThrow("canonical qrels provenance");
		expect(() =>
			createFullCorpusEvidenceReceipt(evidence({ trecSha256: "changed" })),
		).toThrow("TREC hash");
		expect(() =>
			createFullCorpusEvidenceReceipt(evidence({ qrelsSha256: "changed" })),
		).toThrow("qrels hash");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({ qrelsPath: "/inputs/substituted-qrels.tsv" }),
			),
		).toThrow("canonical qrels provenance");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({ trecEvalBinarySha256: "changed" }),
			),
		).toThrow("binary hash");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					evaluationStability: {
						...evidence().evaluationStability,
						trecAfterSha256: "changed",
					},
				}),
			),
		).toThrow("execution stability");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					trecEvalStdout: "ndcg_cut_10 all 0.4\nrecall_100 all 0.7\n",
				}),
			),
		).toThrow("metric reproduction");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({ qdrant: { ...evidence().qdrant, commit: "changed" } }),
			),
		).toThrow("Qdrant runtime");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					result: {
						...result,
						configuration: { ...result.configuration, cpuOnly: false },
					},
				}),
			),
		).toThrow("execution policy");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					launchReceipt: {
						...parsedLaunchReceipt(),
						cudaVisibleDevices: "1",
					},
				}),
			),
		).toThrow("launch evidence");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					runtimeObservation: {
						...parsedRuntimeObservation(),
						result: { path: "/outputs/result.json", sha256: "changed" },
					},
				}),
			),
		).toThrow("runtime observation");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					runtimeObservation: {
						...parsedRuntimeObservation(),
						observation: {
							...parsedRuntimeObservation().observation,
							samples: 1.5,
						},
					},
				}),
			),
		).toThrow("runtime observation");
		expect(() =>
			createFullCorpusEvidenceReceipt(
				evidence({
					runtimeObservation: {
						...parsedRuntimeObservation(),
						observation: {
							...parsedRuntimeObservation().observation,
							startedAt: "2026-08-21T23:59:59.000Z",
						},
					},
				}),
			),
		).toThrow("runtime observation");
	});
});
