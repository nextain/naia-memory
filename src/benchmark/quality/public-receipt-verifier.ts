import { isDeepStrictEqual } from "node:util";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import type {
	PublicCaseRecord,
	PublicDatasetCase,
	PublicEvidenceEngine,
	PublicEvidenceManifest,
	PublicEvidenceReceipt,
} from "./public-evidence-types.js";
import {
	PUBLIC_RETRIEVAL_SCORING_POLICY_ID,
	scorePublicRetrieval,
} from "./public-retrieval-scorer.js";

export function publicCaseOutputSha256(
	engine: string,
	caseId: string,
	repetition: number,
	output: string,
): string {
	return evidenceObjectSha256({ engine, caseId, repetition, output });
}

export function publicCaseJudgmentSha256(
	engine: string,
	caseId: string,
	repetition: number,
	outputSha256: string,
	score: number,
	failed: boolean,
	judgment: string,
	scoringPolicyId: string,
): string {
	return evidenceObjectSha256({
		engine,
		caseId,
		repetition,
		outputSha256,
		score,
		failed,
		judgment,
		scoringPolicyId,
	});
}

/** Computes a normal 95% CI across case means; failed repetitions contribute score zero. */
export function summarizePublicCaseRecords(records: PublicCaseRecord[]): {
	failureCount: number;
	value: number;
	ci95Low: number;
	ci95High: number;
} {
	if (
		records.length === 0 ||
		records.some((record) => !Number.isFinite(record.score))
	)
		throw new Error("case records require finite scores");
	const failureCount = records.filter((record) => record.failed).length;
	const scoresByCase = new Map<string, number[]>();
	for (const record of records)
		scoresByCase.set(record.caseId, [
			...(scoresByCase.get(record.caseId) ?? []),
			record.score,
		]);
	const caseScores = [...scoresByCase.values()].map(
		(scores) => scores.reduce((sum, score) => sum + score, 0) / scores.length,
	);
	const value =
		caseScores.reduce((sum, score) => sum + score, 0) / caseScores.length;
	const variance =
		caseScores.length > 1
			? caseScores.reduce((sum, score) => sum + (score - value) ** 2, 0) /
				(caseScores.length - 1)
			: 0;
	const margin = 1.96 * Math.sqrt(variance / caseScores.length);
	return {
		failureCount,
		value,
		ci95Low: Math.max(0, value - margin),
		ci95High: Math.min(1, value + margin),
	};
}

export function compareReceipt(
	receipt: PublicEvidenceReceipt,
	engine: PublicEvidenceEngine,
	protocol: PublicEvidenceManifest["protocol"],
	datasetCases: Map<string, PublicDatasetCase>,
): string[] {
	const failures: string[] = [];
	const prefix = `${engine.engine}: receipt`;
	const mismatch = (condition: boolean, field: string) => {
		if (condition) failures.push(`${prefix} ${field} mismatch`);
	};
	mismatch(
		receipt.schemaVersion !== "naia-memory-public-engine-receipt-v4",
		"schema version",
	);
	mismatch(receipt.engine !== engine.engine, "engine identity");
	mismatch(receipt.kind !== engine.kind, "engine kind");
	mismatch(
		receipt.implementationFamily !== engine.implementationFamily,
		"implementation family",
	);
	mismatch(receipt.datasetSha256 !== engine.datasetSha256, "dataset hash");
	mismatch(
		receipt.implementationRevision !== engine.implementationRevision,
		"implementation revision",
	);
	mismatch(
		receipt.implementationArtifactPath !== engine.implementationArtifactPath,
		"implementation artifact path",
	);
	mismatch(
		receipt.implementationArtifactSha256 !==
			engine.implementationArtifactSha256,
		"implementation artifact hash",
	);
	mismatch(
		receipt.configurationPath !== engine.configurationPath,
		"configuration path",
	);
	mismatch(
		receipt.configurationSha256 !== engine.configurationSha256,
		"configuration hash",
	);
	mismatch(
		!isDeepStrictEqual(receipt.providerModels, engine.providerModels),
		"provider/model identities",
	);
	mismatch(!isDeepStrictEqual(receipt.protocol, protocol), "frozen protocol");
	mismatch(receipt.elapsedMs !== engine.elapsedMs, "elapsed time");
	mismatch(receipt.estimatedCostUsd !== engine.estimatedCostUsd, "cost");
	mismatch(receipt.failureCount !== engine.failureCount, "failure count");
	mismatch(
		!isDeepStrictEqual(receipt.primaryMetric, engine.primaryMetric),
		"primary metric",
	);
	mismatch(
		!isDeepStrictEqual(
			receipt.languagePrimaryMetrics,
			engine.languagePrimaryMetrics,
		),
		"language metrics",
	);
	if (!Array.isArray(receipt.caseRecords))
		return [...failures, `${prefix} case records are missing`];
	const recordKeys = new Set<string>();
	for (const record of receipt.caseRecords) {
		const datasetCase = record && datasetCases.get(record.caseId);
		if (!datasetCase) {
			failures.push(`${prefix} case identity mismatch`);
			continue;
		}
		if (record.inputSha256 !== datasetCase.inputSha256)
			failures.push(`${prefix} case input hash mismatch`);
		if (
			!Number.isInteger(record.repetition) ||
			record.repetition < 1 ||
			record.repetition > protocol.repetitions
		)
			failures.push(`${prefix} repetition is invalid`);
		if (typeof record.output !== "string")
			failures.push(`${prefix} output is invalid`);
		else if (
			record.outputSha256 !==
			publicCaseOutputSha256(
				engine.engine,
				record.caseId,
				record.repetition,
				record.output,
			)
		)
			failures.push(`${prefix} output hash is invalid`);
		if (!Number.isFinite(record.score) || record.score < 0 || record.score > 1)
			failures.push(`${prefix} case score is invalid`);
		if (
			typeof record.failed !== "boolean" ||
			(record.failed && record.score !== 0)
		)
			failures.push(`${prefix} case failure semantics are invalid`);
		if (typeof record.judgment !== "string" || !record.judgment.trim())
			failures.push(`${prefix} case judgment is missing`);
		else if (
			record.judgmentSha256 !==
			publicCaseJudgmentSha256(
				engine.engine,
				record.caseId,
				record.repetition,
				record.outputSha256,
				record.score,
				record.failed,
				record.judgment,
				protocol.scoringPolicyId,
			)
		)
			failures.push(`${prefix} case judgment hash is invalid`);
		if (
			protocol.scoringPolicyId === PUBLIC_RETRIEVAL_SCORING_POLICY_ID &&
			Number.isInteger(protocol.topK) &&
			protocol.topK >= 1 &&
			typeof record.output === "string"
		) {
			const replayed = scorePublicRetrieval(
				record.output,
				datasetCase,
				protocol.topK,
			);
			if (record.score !== replayed.score)
				failures.push(`${prefix} replayed case score mismatch`);
			if (record.judgment !== replayed.judgment)
				failures.push(`${prefix} replayed case judgment mismatch`);
		}
		const key = `${record.caseId}\0${record.repetition}`;
		if (recordKeys.has(key))
			failures.push(`${prefix} case records are duplicated`);
		recordKeys.add(key);
	}
	if (receipt.caseRecords.length !== datasetCases.size * protocol.repetitions)
		failures.push(`${prefix} case coverage mismatch`);
	if (
		receipt.caseRecords.length > 0 &&
		receipt.caseRecords.every((record) => Number.isFinite(record.score))
	) {
		const summary = summarizePublicCaseRecords(receipt.caseRecords);
		mismatch(
			summary.failureCount !== engine.failureCount,
			"recomputed failure count",
		);
		mismatch(
			summary.value !== engine.primaryMetric.value,
			"recomputed primary metric",
		);
		mismatch(
			summary.ci95Low !== engine.primaryMetric.ci95Low ||
				summary.ci95High !== engine.primaryMetric.ci95High,
			"recomputed confidence interval",
		);
		const recordsByLanguage = new Map<string, PublicCaseRecord[]>();
		for (const record of receipt.caseRecords) {
			const datasetCase = datasetCases.get(record.caseId);
			if (!datasetCase) continue;
			const languageRecords = recordsByLanguage.get(datasetCase.language) ?? [];
			languageRecords.push(record);
			recordsByLanguage.set(datasetCase.language, languageRecords);
		}
		for (const [language, languageRecords] of recordsByLanguage) {
			if (!languageRecords.every((record) => Number.isFinite(record.score)))
				continue;
			const languageSummary = summarizePublicCaseRecords(languageRecords);
			const claimed = engine.languagePrimaryMetrics[language];
			mismatch(
				!claimed ||
					languageSummary.value !== claimed.value ||
					languageSummary.ci95Low !== claimed.ci95Low ||
					languageSummary.ci95High !== claimed.ci95High,
				`recomputed ${language} language metric`,
			);
		}
	}
	return failures;
}
