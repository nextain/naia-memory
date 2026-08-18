import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import {
	PUBLIC_EVIDENCE_CLAIM,
	type PublicEvidenceManifest,
	type PublicEvidenceTrustPolicy,
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
	publicRetrievalMetricName,
	scorePublicRetrieval,
} from "./public-retrieval-scorer.js";

export const hash = "a".repeat(64);
export const identities = [
	"nextain-release",
	"naia",
	"competitor-a",
	"competitor-b",
	"opencode/model@revision",
	"independent-challenge-service",
	"runner-naia",
	"runner-competitor-a",
	"runner-competitor-b",
	"author-1",
	"reviewer-ko",
	"reviewer-en",
	"reviewer-ja",
] as const;
export const keys = Object.fromEntries(
	identities.map((identity) => [identity, generateKeyPairSync("ed25519")]),
) as Record<
	(typeof identities)[number],
	ReturnType<typeof generateKeyPairSync>
>;
export const trustPolicy: PublicEvidenceTrustPolicy = {
	publisherPublicKeys: {
		"nextain-release": keys["nextain-release"].publicKey
			.export({ type: "spki", format: "pem" })
			.toString(),
	},
	enginePublicKeys: Object.fromEntries(
		identities
			.slice(1, 4)
			.map((identity) => [
				identity,
				keys[identity].publicKey
					.export({ type: "spki", format: "pem" })
					.toString(),
			]),
	),
	reviewerPublicKeys: {
		"opencode/model@revision": keys["opencode/model@revision"].publicKey
			.export({ type: "spki", format: "pem" })
			.toString(),
	},
	datasetAuthorPublicKeys: {
		"author-1": keys["author-1"].publicKey
			.export({ type: "spki", format: "pem" })
			.toString(),
	},
	nativeReviewerPublicKeysByLanguage: Object.fromEntries(
		["ko", "en", "ja"].map((language) => {
			const identity = `reviewer-${language}` as
				| "reviewer-ko"
				| "reviewer-en"
				| "reviewer-ja";
			return [
				language,
				{
					[identity]: keys[identity].publicKey
						.export({ type: "spki", format: "pem" })
						.toString(),
				},
			];
		}),
	),
	challengeIssuerPublicKeys: {
		"independent-challenge-service": keys[
			"independent-challenge-service"
		].publicKey
			.export({ type: "spki", format: "pem" })
			.toString(),
	},
	runnerPublicKeys: Object.fromEntries(
		["runner-naia", "runner-competitor-a", "runner-competitor-b"].map(
			(identity) => [
				identity,
				keys[identity as "runner-naia"].publicKey
					.export({ type: "spki", format: "pem" })
					.toString(),
			],
		),
	),
	approvedScoringPolicies: {
		[PUBLIC_RETRIEVAL_SCORING_POLICY_ID]: createHash("sha256")
			.update(JSON.stringify(PUBLIC_RETRIEVAL_SCORING_POLICY))
			.digest("hex"),
	},
};

export function signed<T extends Record<string, unknown>>(
	value: T,
	identity: (typeof identities)[number],
): T & { signatureBase64: string } {
	return {
		...value,
		signatureBase64: sign(
			null,
			publicEvidenceSignaturePayload(value),
			keys[identity].privateKey,
		).toString("base64"),
	};
}

export function engine(engine: string, kind: "naia" | "external") {
	return {
		engine,
		kind,
		implementationFamily: engine,
		executed: true,
		receiptPath: `${engine}.json`,
		receiptSha256: createHash("sha256").update(engine).digest("hex"),
		challengePath: `${engine}.challenge.json`,
		challengeSha256: createHash("sha256")
			.update(`challenge:${engine}`)
			.digest("hex"),
		attestationPath: `${engine}.attestation.json`,
		attestationSha256: createHash("sha256")
			.update(`attestation:${engine}`)
			.digest("hex"),
		executionEvidencePath: `${engine}.execution.log`,
		executionEvidenceSha256: createHash("sha256")
			.update(`execution:${engine}`)
			.digest("hex"),
		datasetSha256: hash,
		implementationRevision: "revision",
		implementationArtifactPath: `${engine}.artifact`,
		implementationArtifactSha256: createHash("sha256")
			.update(`artifact:${engine}`)
			.digest("hex"),
		configurationPath: `${engine}.config`,
		configurationSha256: createHash("sha256")
			.update(`config:${engine}`)
			.digest("hex"),
		providerModels: ["provider/model@revision"],
		elapsedMs: 100,
		estimatedCostUsd: 0,
		failureCount: 0,
		primaryMetric: {
			name: "current-hit@20",
			value: 0.8,
			ci95Low: 0.7,
			ci95High: 0.9,
		},
		languagePrimaryMetrics: {
			ko: { value: 1, ci95Low: 1, ci95High: 1 },
			en: { value: 1, ci95Low: 1, ci95High: 1 },
			ja: {
				value: 0.4,
				ci95Low: 0.24624495005166375,
				ci95High: 0.5537550499483364,
			},
		},
	};
}

export function validManifest(): PublicEvidenceManifest {
	const manifest: PublicEvidenceManifest = {
		schemaVersion: "naia-memory-public-evidence-v8",
		publisher: "nextain-release",
		signatureBase64: "",
		claim: PUBLIC_EVIDENCE_CLAIM,
		dataset: {
			path: "dataset.json",
			benchmarkTier: "held-out-public",
			construction: "independent-authored",
			nativeReviewStatus: "reviewed",
			sealedBeforeRun: true,
			sha256: hash,
			provenancePath: "dataset.provenance.json",
			provenanceSha256: hash,
			caseCount: 120,
			languageCaseCounts: { ko: 40, en: 40, ja: 40 },
			authorIds: ["author-1"],
			reviewerIdsByLanguage: {
				ko: ["reviewer-ko"],
				en: ["reviewer-en"],
				ja: ["reviewer-ja"],
			},
		},
		protocol: {
			sameInputSha256: hash,
			topK: 20,
			repetitions: 2,
			primaryMetricName: publicRetrievalMetricName(20),
			scoringPolicyId: PUBLIC_RETRIEVAL_SCORING_POLICY_ID,
			scorerArtifactPath: "scorer.js",
			scorerArtifactSha256: hash,
			frozenBeforeRun: true,
		},
		engines: [
			engine("naia", "naia"),
			engine("competitor-a", "external"),
			engine("competitor-b", "external"),
		],
		adversarialReview: {
			independent: true,
			reviewer: "opencode/model@revision",
			evidenceScopeSha256: hash,
			artifactPath: "review.md",
			artifactSha256: hash,
			verdict: "PASS",
		},
	};
	manifest.adversarialReview.evidenceScopeSha256 =
		publicEvidenceScopeSha256(manifest);
	return manifest;
}

export function datasetCases() {
	return ["ko", "en", "ja"].flatMap((language) =>
		Array.from({ length: 40 }, (_, index) => {
			const input = `${language} input ${index + 1}`;
			const currentId = `current-${language}-${index + 1}`;
			const staleId = `stale-${language}-${index + 1}`;
			return {
				id: `${language}-${index + 1}`,
				language,
				memories: [
					{
						id: staleId,
						content: `${language} stale memory ${index + 1}`,
						date: "2026-01-01T00:00:00.000Z",
					},
					{
						id: currentId,
						content: `${language} current memory ${index + 1}`,
						date: "2026-01-02T00:00:00.000Z",
					},
				],
				input,
				expected: [currentId],
				forbidden: [staleId],
				inputSha256: createHash("sha256").update(input).digest("hex"),
			};
		}),
	);
}

export function receiptBytes(
	manifest: PublicEvidenceManifest,
	engine: PublicEvidenceManifest["engines"][number],
	cases = datasetCases(),
): string {
	const caseRecords = cases.flatMap((item, index) =>
		Array.from({ length: manifest.protocol.repetitions }, (_, repetition) => {
			const output = JSON.stringify(
				index < 96 ? [item.expected[0]] : [item.forbidden[0]],
			);
			const { score, judgment } = scorePublicRetrieval(
				output,
				item,
				manifest.protocol.topK,
			);
			return {
				caseId: item.id,
				inputSha256: item.inputSha256,
				repetition: repetition + 1,
				output,
				outputSha256: publicCaseOutputSha256(
					engine.engine,
					item.id,
					repetition + 1,
					output,
				),
				score,
				failed: false,
				judgment,
				judgmentSha256: publicCaseJudgmentSha256(
					engine.engine,
					item.id,
					repetition + 1,
					publicCaseOutputSha256(
						engine.engine,
						item.id,
						repetition + 1,
						output,
					),
					score,
					false,
					judgment,
					manifest.protocol.scoringPolicyId,
				),
			};
		}),
	);
	const summary = summarizePublicCaseRecords(caseRecords);
	engine.failureCount = summary.failureCount;
	engine.primaryMetric = {
		name: manifest.protocol.primaryMetricName,
		value: summary.value,
		ci95Low: summary.ci95Low,
		ci95High: summary.ci95High,
	};
	const recordsByLanguage = new Map<string, typeof caseRecords>();
	for (const [index, item] of cases.entries()) {
		for (
			let repetition = 1;
			repetition <= manifest.protocol.repetitions;
			repetition++
		) {
			const record =
				caseRecords[index * manifest.protocol.repetitions + (repetition - 1)];
			const bucket = recordsByLanguage.get(item.language) ?? [];
			bucket.push(record);
			recordsByLanguage.set(item.language, bucket);
		}
	}
	engine.languagePrimaryMetrics = Object.fromEntries(
		[...recordsByLanguage].map(([language, records]) => {
			const languageSummary = summarizePublicCaseRecords(records);
			return [
				language,
				{
					value: languageSummary.value,
					ci95Low: languageSummary.ci95Low,
					ci95High: languageSummary.ci95High,
				},
			];
		}),
	);
	return JSON.stringify(
		signed(
			{
				schemaVersion: "naia-memory-public-engine-receipt-v4",
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
				languagePrimaryMetrics: engine.languagePrimaryMetrics,
				caseRecords,
			},
			engine.engine as "naia" | "competitor-a" | "competitor-b",
		),
	);
}

export async function writeValidEvidence(
	root: string,
	manifest: PublicEvidenceManifest,
	cases = datasetCases(),
): Promise<void> {
	const datasetBytes = JSON.stringify({
		schemaVersion: "naia-memory-public-dataset-v3",
		cases,
	});
	const datasetSha256 = createHash("sha256").update(datasetBytes).digest("hex");
	await writeFile(join(root, manifest.dataset.path), datasetBytes);
	manifest.dataset.sha256 = datasetSha256;
	manifest.protocol.sameInputSha256 = datasetSha256;
	const provenanceBytes = JSON.stringify({
		schemaVersion: "naia-memory-public-dataset-provenance-v1",
		datasetSha256,
		authors: manifest.dataset.authorIds.map((author) =>
			signed(
				{
					schemaVersion: "naia-memory-public-dataset-author-attestation-v1",
					author,
					datasetSha256,
					statement: "AUTHORED_INDEPENDENTLY",
				},
				author as "author-1",
			),
		),
		nativeReviews: Object.entries(
			manifest.dataset.reviewerIdsByLanguage,
		).flatMap(([language, reviewers]) =>
			reviewers.map((reviewer) =>
				signed(
					{
						schemaVersion: "naia-memory-public-dataset-native-review-v1",
						reviewer,
						language,
						datasetSha256,
						verdict: "PASS",
					},
					reviewer as "reviewer-ko",
				),
			),
		),
	});
	await writeFile(join(root, manifest.dataset.provenancePath), provenanceBytes);
	manifest.dataset.provenanceSha256 = createHash("sha256")
		.update(provenanceBytes)
		.digest("hex");
	const scorer = JSON.stringify(PUBLIC_RETRIEVAL_SCORING_POLICY);
	await writeFile(join(root, manifest.protocol.scorerArtifactPath), scorer);
	manifest.protocol.scorerArtifactSha256 = createHash("sha256")
		.update(scorer)
		.digest("hex");
	for (const engine of manifest.engines) {
		engine.datasetSha256 = datasetSha256;
		const artifact = `artifact:${engine.engine}`;
		const config = `config:${engine.engine}`;
		await writeFile(join(root, engine.implementationArtifactPath), artifact);
		await writeFile(join(root, engine.configurationPath), config);
		const executionEvidence = `execution:${engine.engine}`;
		await writeFile(
			join(root, engine.executionEvidencePath),
			executionEvidence,
		);
		engine.implementationArtifactSha256 = createHash("sha256")
			.update(artifact)
			.digest("hex");
		engine.configurationSha256 = createHash("sha256")
			.update(config)
			.digest("hex");
		engine.executionEvidenceSha256 = createHash("sha256")
			.update(executionEvidence)
			.digest("hex");
		const bytes = receiptBytes(manifest, engine, cases);
		await writeFile(join(root, engine.receiptPath), bytes);
		engine.receiptSha256 = createHash("sha256").update(bytes).digest("hex");
		const nonce = Buffer.from(
			`nonce:${engine.engine}:0123456789abcdef`,
		).toString("base64url");
		const challenge = JSON.stringify(
			signed(
				{
					schemaVersion: "naia-memory-public-execution-challenge-v1",
					issuer: "independent-challenge-service",
					challengeId: `challenge-${engine.engine}`,
					nonce,
					engine: engine.engine,
					datasetSha256,
					protocolSha256: evidenceObjectSha256(manifest.protocol),
					issuedAt: "2026-08-18T00:00:00.000Z",
					expiresAt: "2026-08-18T01:00:00.000Z",
				},
				"independent-challenge-service",
			),
		);
		await writeFile(join(root, engine.challengePath), challenge);
		engine.challengeSha256 = createHash("sha256")
			.update(challenge)
			.digest("hex");
		const runner = `runner-${engine.engine}` as
			| "runner-naia"
			| "runner-competitor-a"
			| "runner-competitor-b";
		const attestation = JSON.stringify(
			signed(
				{
					schemaVersion: "naia-memory-public-execution-attestation-v1",
					runner,
					challengeId: `challenge-${engine.engine}`,
					nonce,
					engine: engine.engine,
					datasetSha256,
					protocolSha256: evidenceObjectSha256(manifest.protocol),
					receiptSha256: engine.receiptSha256,
					implementationArtifactSha256: engine.implementationArtifactSha256,
					configurationSha256: engine.configurationSha256,
					executionEvidenceSha256: engine.executionEvidenceSha256,
					startedAt: "2026-08-18T00:10:00.000Z",
					finishedAt: "2026-08-18T00:20:00.000Z",
				},
				runner,
			),
		);
		await writeFile(join(root, engine.attestationPath), attestation);
		engine.attestationSha256 = createHash("sha256")
			.update(attestation)
			.digest("hex");
	}
	manifest.adversarialReview.evidenceScopeSha256 =
		publicEvidenceScopeSha256(manifest);
	const reviewBytes = JSON.stringify(
		signed(
			{
				schemaVersion: "naia-memory-public-adversarial-review-v2",
				reviewer: manifest.adversarialReview.reviewer,
				evidenceScopeSha256: manifest.adversarialReview.evidenceScopeSha256,
				verdict: manifest.adversarialReview.verdict,
			},
			"opencode/model@revision",
		),
	);
	await writeFile(join(root, "review.md"), reviewBytes);
	manifest.adversarialReview.artifactSha256 = createHash("sha256")
		.update(reviewBytes)
		.digest("hex");
	manifest.signatureBase64 = signed(
		manifest as unknown as Record<string, unknown>,
		"nextain-release",
	).signatureBase64;
}
