#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	MIRACL_KO_LOCK,
	parseQrelsTsv,
	parseTrecRun,
	verifyLockedFile,
} from "./public-miracl-source.js";
import {
	analyzeRankingAb,
	validateBoundRankingResult,
	validateReportedRankingMetrics,
	validateSharedRankingProtocol,
} from "./ranking-ab-analysis.js";

const baselinePath =
	process.env.MIRACL_AB_BASELINE_TREC ??
	"reports/quality/miracl-ko-full-corpus-vector-exact.json.trec";
const candidatePath =
	process.env.MIRACL_AB_CANDIDATE_TREC ??
	"reports/quality/miracl-ko-full-corpus-vector-exact-true-batch.json.trec";
const baselineResultPath =
	process.env.MIRACL_AB_BASELINE_RESULT ?? baselinePath.replace(/\.trec$/, "");
const candidateResultPath =
	process.env.MIRACL_AB_CANDIDATE_RESULT ??
	candidatePath.replace(/\.trec$/, "");
const sourceRoot =
	process.env.MIRACL_SOURCE_DIR ?? ".cache/benchmark-sources/miracl-ko-v1.0";
const qrelsPath = join(sourceRoot, MIRACL_KO_LOCK.files[1].path);
const outputPath =
	process.env.MIRACL_AB_OUTPUT ??
	"reports/quality/miracl-ko-true-batch-ab-analysis.json";

const MAX_QUALITY_LOSS = 0.005;
const MIN_TOP_10_JACCARD = 0.9;
const MIN_TOP_100_JACCARD = 0.95;
const EXPECTED_QUERIES = 213;
const BOOTSTRAP_REPETITIONS = 10_000;
const BOOTSTRAP_SEED = 0x4e414941;

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

async function main(): Promise<void> {
	if (existsSync(outputPath)) throw new Error("A/B output already exists");
	const qrelsLock = MIRACL_KO_LOCK.files[1];
	if (!qrelsLock) throw new Error("MIRACL qrels lock missing");
	await verifyLockedFile(qrelsPath, qrelsLock);
	const baselineText = readFileSync(baselinePath, "utf8");
	const candidateText = readFileSync(candidatePath, "utf8");
	const qrelsText = readFileSync(qrelsPath, "utf8");
	const baselineResultText = readFileSync(baselineResultPath, "utf8");
	const candidateResultText = readFileSync(candidateResultPath, "utf8");
	const baselineSha256 = sha256(baselineText);
	const candidateSha256 = sha256(candidateText);
	const qrelsSha256 = sha256(qrelsText);
	validateBoundRankingResult(
		baselineResultText,
		baselineSha256,
		qrelsSha256,
		EXPECTED_QUERIES,
	);
	validateBoundRankingResult(
		candidateResultText,
		candidateSha256,
		qrelsSha256,
		EXPECTED_QUERIES,
	);
	validateSharedRankingProtocol(baselineResultText, candidateResultText);
	const baseline = [...parseTrecRun(baselineText)].map(
		([queryId, ranking]) => ({
			queryId,
			ranking,
		}),
	);
	const candidate = [...parseTrecRun(candidateText)].map(
		([queryId, ranking]) => ({
			queryId,
			ranking,
		}),
	);
	if (
		baseline.length !== EXPECTED_QUERIES ||
		candidate.length !== EXPECTED_QUERIES
	)
		throw new Error("MIRACL A/B query count mismatch");
	const relevantByQuery = new Map(
		[...parseQrelsTsv(qrelsText)].map(([queryId, docids]) => [
			queryId,
			new Set(docids),
		]),
	);
	const analysis = analyzeRankingAb({
		baseline,
		candidate,
		relevantByQuery,
		bootstrapRepetitions: BOOTSTRAP_REPETITIONS,
		bootstrapSeed: BOOTSTRAP_SEED,
	});
	validateReportedRankingMetrics(baselineResultText, {
		ndcgAt10: analysis.metrics.ndcgAt10.baseline,
		recallAt100: analysis.metrics.recallAt100.baseline,
	});
	validateReportedRankingMetrics(candidateResultText, {
		ndcgAt10: analysis.metrics.ndcgAt10.candidate,
		recallAt100: analysis.metrics.recallAt100.candidate,
	});
	const checks = {
		ndcgMeanNoninferior: analysis.metrics.ndcgAt10.delta >= -MAX_QUALITY_LOSS,
		ndcgIntervalNoninferior:
			analysis.metrics.ndcgAt10.delta95PercentileInterval.lower >=
			-MAX_QUALITY_LOSS,
		recallMeanNoninferior:
			analysis.metrics.recallAt100.delta >= -MAX_QUALITY_LOSS,
		recallIntervalNoninferior:
			analysis.metrics.recallAt100.delta95PercentileInterval.lower >=
			-MAX_QUALITY_LOSS,
		top10Stable:
			analysis.rankingStability.meanTop10Jaccard >= MIN_TOP_10_JACCARD,
		top100Stable:
			analysis.rankingStability.meanTop100Jaccard >= MIN_TOP_100_JACCARD,
	};
	const receipt = {
		schemaVersion: 1,
		benchmark: "miracl-ko-per-item-vs-true-batch-ranking-ab-v1",
		claimBoundary:
			"ranking noninferiority only; throughput, policy identity, multilingual behavior, and Naia lifecycle require separate evidence",
		inputs: {
			baseline: {
				resultPath: baselineResultPath,
				resultSha256: sha256(baselineResultText),
				trecPath: baselinePath,
				trecSha256: baselineSha256,
			},
			candidate: {
				resultPath: candidateResultPath,
				resultSha256: sha256(candidateResultText),
				trecPath: candidatePath,
				trecSha256: candidateSha256,
			},
			qrels: { path: qrelsPath, sha256: qrelsSha256 },
		},
		thresholds: {
			maxQualityLoss: MAX_QUALITY_LOSS,
			minMeanTop10Jaccard: MIN_TOP_10_JACCARD,
			minMeanTop100Jaccard: MIN_TOP_100_JACCARD,
		},
		analysis,
		checks,
		passed: Object.values(checks).every(Boolean),
	};
	const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
	const temporary = `${outputPath}.${process.pid}.tmp`;
	writeFileSync(temporary, serialized, { flag: "wx", mode: 0o600 });
	renameSync(temporary, outputPath);
	process.stdout.write(serialized);
}

await main();
