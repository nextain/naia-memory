/**
 * Recall strength feedback loop benchmark (nextain/naia-memory#51).
 *
 * Measures whether memory strength / recall history distorts fact ranking.
 * Evaluates ranking accuracy under uniform, varied, reinforced (hijacker),
 * and after-traffic conditions across Korean retrieval contract and query template cases.
 *
 * How to run:
 *   npx tsx src/benchmark/quality/recall-strength-loop.ts
 *
 * Environment variables:
 *   BENCH_EMBED_MODEL: default "multilingual-e5-large"
 *   BENCH_TOPK: default 5
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalAdapter } from "../../memory/adapters/local.js";
import { calculateStrength } from "../../memory/decay.js";
import { OFFLINE_MODEL_REVISIONS, OfflineEmbeddingProvider } from "../../memory/embeddings.js";
import { benchmarkReceipt } from "../provenance.js";

const FACT_BANK_PATH = "src/benchmark/fact-bank-v2.json";
const CONTRACT_PATH = "src/benchmark/quality/korean-retrieval-contract-v1.json";
const TEMPLATES_PATH = "src/benchmark/query-templates-v2.json";

const TOPK = Number(process.env.BENCH_TOPK ?? 5);
const MODEL = (process.env.BENCH_EMBED_MODEL ?? "multilingual-e5-large") as any;
const MODEL_REVISION =
	process.env.BENCH_EMBED_REVISION ??
	OFFLINE_MODEL_REVISIONS[MODEL as keyof typeof OFFLINE_MODEL_REVISIONS];
const EMBEDDING_DTYPE = String(MODEL).startsWith("multilingual-e5-") ? "q8" : "fp32";
const NOW = 1_720_000_000_000;
const DAY_MS = 86_400_000;
const PROJECT = "recall-strength-loop";

const load = (relPath: string) =>
	JSON.parse(readFileSync(join(process.cwd(), relPath), "utf8"));

function h(s: string): number {
	const hash = createHash("sha256").update(s).digest();
	const uint32 = hash.readUInt32BE(0);
	return uint32 / 0xffffffff;
}

interface EvalCase {
	id: string;
	query: string;
	acceptable_fact_ids: string[];
	forbidden_fact_ids: string[];
}

interface EvalCaseResult extends EvalCase {
	retrieved_ids: string[];
	acceptable_rank: number | null;
	forbidden_ranks: number[];
}

interface EvalSetScore {
	evaluated: number;
	hitAt1: number;
	hitAtK: number;
	mrr: number;
	forbiddenAt1: number;
	forbiddenAtK: number;
	distinctIds: number;
	cases: EvalCaseResult[];
}

async function evaluateCases(
	adapter: LocalAdapter,
	cases: EvalCase[],
): Promise<EvalSetScore> {
	const storedFacts = await adapter.semantic.getAll();
	const recallState = storedFacts.map((fact) => ({
		fact,
		recallCount: fact.recallCount,
		lastAccessed: fact.lastAccessed,
		strength: fact.strength,
	}));
	const resetRecallState = () => {
		for (const snapshot of recallState) {
			Object.assign(snapshot.fact, {
				recallCount: snapshot.recallCount,
				lastAccessed: snapshot.lastAccessed,
				strength: snapshot.strength,
			});
		}
	};

	let hit1 = 0;
	let hitK = 0;
	let forbidden1 = 0;
	let forbiddenK = 0;
	let mrr = 0;
	const distinctIds = new Set<string>();
	const detailedCases: EvalCaseResult[] = [];

	for (const c of cases) {
		resetRecallState();
		const hits = await adapter.semantic.search(c.query, TOPK, false, {
			project: PROJECT,
		});
		const ids = hits.map((f) => f.id);
		for (const id of ids) distinctIds.add(id);

		const acceptableRank = ids.findIndex((id) =>
			c.acceptable_fact_ids.includes(id),
		);
		const forbiddenRanks = ids
			.map((id, index) => (c.forbidden_fact_ids.includes(id) ? index + 1 : 0))
			.filter(Boolean);

		if (acceptableRank === 0) hit1++;
		if (acceptableRank >= 0) {
			hitK++;
			mrr += 1 / (acceptableRank + 1);
		}
		if (forbiddenRanks.includes(1)) forbidden1++;
		if (forbiddenRanks.length > 0) forbiddenK++;

		detailedCases.push({
			...c,
			retrieved_ids: ids,
			acceptable_rank: acceptableRank >= 0 ? acceptableRank + 1 : null,
			forbidden_ranks: forbiddenRanks,
		});
	}

	// Leave the store exactly as found, so one eval set cannot bias the next.
	resetRecallState();

	return {
		evaluated: cases.length,
		hitAt1: cases.length > 0 ? hit1 / cases.length : 0,
		hitAtK: cases.length > 0 ? hitK / cases.length : 0,
		mrr: cases.length > 0 ? mrr / cases.length : 0,
		forbiddenAt1: cases.length > 0 ? forbidden1 / cases.length : 0,
		forbiddenAtK: cases.length > 0 ? forbiddenK / cases.length : 0,
		distinctIds: distinctIds.size,
		cases: detailedCases,
	};
}

async function main() {
	if (!Number.isInteger(TOPK) || TOPK < 1) {
		throw new Error("BENCH_TOPK must be a positive integer");
	}
	if (!MODEL_REVISION) {
		throw new Error(
			"BENCH_EMBED_REVISION is required for an unrecognized embedding model",
		);
	}

	const systemNow = Date.now;
	const generatedAt = new Date(systemNow()).toISOString();
	Date.now = () => NOW;

	try {
		const factBank = load(FACT_BANK_PATH);
		const contractData = load(CONTRACT_PATH) as { cases: EvalCase[] };
		const templatesData = load(TEMPLATES_PATH) as {
			queries: Array<{
				category: string;
				fact_ref?: string;
				query: string;
			}>;
		};

		const corpus: Array<{ id: string; statement: string }> =
			factBank.facts.flatMap((fact: any) => [
				fact,
				...(fact.distractor?.statement ? [fact.distractor] : []),
			]);
		const corpusIds = new Set(corpus.map((f) => f.id));

		// (a) Korean contract cases
		const koreanContractCases: EvalCase[] = contractData.cases.map((c) => ({
			id: c.id,
			query: c.query,
			acceptable_fact_ids: c.acceptable_fact_ids,
			forbidden_fact_ids: c.forbidden_fact_ids,
		}));

		// (b) Query templates cases
		const validCategories = new Set([
			"direct_recall",
			"semantic_search",
			"entity_disambiguation",
		]);
		const queryTemplateCases: EvalCase[] = [];
		let qtIndex = 0;
		for (const q of templatesData.queries) {
			if (
				validCategories.has(q.category) &&
				typeof q.fact_ref === "string" &&
				corpusIds.has(q.fact_ref)
			) {
				qtIndex++;
				const distractorId = q.fact_ref + "d";
				queryTemplateCases.push({
					id: `QT-${qtIndex}-${q.fact_ref}`,
					query: q.query,
					acceptable_fact_ids: [q.fact_ref],
					forbidden_fact_ids: corpusIds.has(distractorId) ? [distractorId] : [],
				});
			}
		}

		// Find 5 hijacker ids for reinforced scenario
		const evalCaseIds = new Set<string>();
		for (const c of [...koreanContractCases, ...queryTemplateCases]) {
			for (const id of c.acceptable_fact_ids) evalCaseIds.add(id);
			for (const id of c.forbidden_fact_ids) evalCaseIds.add(id);
		}
		const nonEvalCorpusIds = corpus
			.map((f) => f.id)
			.filter((id) => !evalCaseIds.has(id));
		const hijackerIds = new Set(
			[...nonEvalCorpusIds]
				.sort((a, b) => h("hj:" + a) - h("hj:" + b))
				.slice(0, 5),
		);

		const embedder = new OfflineEmbeddingProvider(MODEL, "cpu", MODEL_REVISION);

		type Scenario = "uniform" | "varied" | "reinforced" | "after-traffic";
		const scenarios: Scenario[] = [
			"uniform",
			"varied",
			"reinforced",
			"after-traffic",
		];
		const scenarioResults: Record<
			string,
			{ "korean-contract": EvalSetScore; "query-templates": EvalSetScore }
		> = {};

		for (const scenario of scenarios) {
			const storePath = join(
				tmpdir(),
				`naia-recall-loop-${scenario}-${randomUUID()}.json`,
			);
			if (existsSync(storePath)) unlinkSync(storePath);

			const adapter = new LocalAdapter({
				storePath,
				embeddingProvider: embedder,
				disableKGSpreading: false,
			});

			try {
				for (const item of corpus) {
					let importance = 0.5;
					let createdAt = NOW;
					let lastAccessed = NOW;
					let recallCount = 0;
					let strength = 0.5;

					if (scenario === "uniform") {
						importance = 0.5;
						createdAt = NOW;
						lastAccessed = NOW;
						recallCount = 0;
						strength = 0.5;
					} else {
						// varied base
						const imp = 0.1 + 0.8 * h("imp:" + item.id);
						const ageDays = 90 * h("age:" + item.id);
						const ageMs = Math.round(ageDays * DAY_MS);

						if (scenario === "reinforced" && hijackerIds.has(item.id)) {
							importance = 0.225;
							createdAt = NOW - ageMs;
							lastAccessed = NOW;
							recallCount = 259;
							strength = calculateStrength(
								importance,
								createdAt,
								recallCount,
								lastAccessed,
								NOW,
							);
						} else {
							importance = imp;
							createdAt = NOW - ageMs;
							lastAccessed = NOW - ageMs;
							recallCount = 0;
							strength = calculateStrength(
								importance,
								createdAt,
								recallCount,
								lastAccessed,
								NOW,
							);
						}
					}

					await adapter.semantic.upsert({
						id: item.id,
						content: item.statement,
						entities: [],
						topics: [],
						// maxEmotion is deliberately omitted: with 0.1 (as in
						// korean-retrieval-contract.ts) the arousal rule
						// |0.1 - 0.5| * 2 = 0.8 >= 0.6 marks every fact a flashbulb.
						importance,
						strength,
						status: "active",
						createdAt,
						updatedAt: createdAt,
						lastAccessed,
						recallCount,
						validFrom: createdAt,
						validTo: null,
						sourceEpisodes: [randomUUID()],
						encodingContext: { project: PROJECT },
					});
				}

				if (scenario === "after-traffic") {
					for (const t of templatesData.queries) {
						await adapter.semantic.search(t.query, TOPK, false, {
							project: PROJECT,
						});
					}
				}

				const scoreKorean = await evaluateCases(adapter, koreanContractCases);
				const scoreTemplates = await evaluateCases(adapter, queryTemplateCases);

				scenarioResults[scenario] = {
					"korean-contract": scoreKorean,
					"query-templates": scoreTemplates,
				};

				const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
				console.log(
					`[recall-strength-loop] scenario=${scenario.padEnd(13)} eval=korean-contract  ` +
						`hit@1=${pct(scoreKorean.hitAt1).padStart(5)} hit@${TOPK}=${pct(scoreKorean.hitAtK).padStart(5)} ` +
						`MRR=${scoreKorean.mrr.toFixed(3)} distinct=${scoreKorean.distinctIds}`,
				);
				console.log(
					`[recall-strength-loop] scenario=${scenario.padEnd(13)} eval=query-templates  ` +
						`hit@1=${pct(scoreTemplates.hitAt1).padStart(5)} hit@${TOPK}=${pct(scoreTemplates.hitAtK).padStart(5)} ` +
						`MRR=${scoreTemplates.mrr.toFixed(3)} distinct=${scoreTemplates.distinctIds}`,
				);
			} finally {
				await adapter.close();
				if (existsSync(storePath)) unlinkSync(storePath);
			}
		}

		const receipt = benchmarkReceipt(
			[FACT_BANK_PATH, CONTRACT_PATH, TEMPLATES_PATH],
			{
				model: MODEL,
				modelRepository: `Xenova/${MODEL}`,
				modelRevision: MODEL_REVISION,
				device: "cpu",
				embeddingDtype: EMBEDDING_DTYPE,
				topK: TOPK,
				searchMode: "rrf",
				benchmarkClock: new Date(NOW).toISOString(),
				corpusFacts: corpus.length,
			},
			[
				"src/benchmark/quality/recall-strength-loop.ts",
				"src/benchmark/provenance.ts",
				"src/memory/index.ts",
				"src/memory/memory-system.ts",
				"src/memory/memory-system-api.ts",
				"src/memory/memory-system-core.ts",
				"src/memory/adapters/local.ts",
				"src/memory/adapters/local-search.ts",
				"src/memory/adapters/local-semantic-search.ts",
				"src/memory/embeddings.ts",
				"src/memory/decay.ts",
				"src/memory/knowledge-graph.ts",
				"src/memory/ko-normalize.ts",
				"package.json",
				"pnpm-lock.yaml",
			],
			generatedAt,
		);

		const modelSuffix = String(MODEL).replace(/[^a-zA-Z0-9._-]+/g, "-");
		const artifact = `recall-strength-loop-${modelSuffix}.json`;
		const outDir = join(process.cwd(), "reports", "quality");
		mkdirSync(outDir, { recursive: true });

		const output = {
			benchmark: "recall-strength-loop",
			receipt,
			dimensions: embedder.dims,
			topK: TOPK,
			scenarios: scenarioResults,
		};

		writeFileSync(join(outDir, artifact), JSON.stringify(output, null, 2));
		console.log(`Artifact: reports/quality/${artifact}`);
	} finally {
		Date.now = systemNow;
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
