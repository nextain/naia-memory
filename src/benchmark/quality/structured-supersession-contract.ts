/**
 * Structured supersession mechanism contract.
 *
 * Runs the same fixed multilingual sequence with write-structure and query-
 * assistance ablations. It measures lifecycle correctness and retrieval
 * exposure; it does not claim general answer quality.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HeuristicContradictionFilter, MemorySystem, type FactExtractor, type StructuredFact } from "../../memory/index.js";
import { LocalAdapter } from "../../memory/adapters/local.js";
import { OFFLINE_MODEL_REVISIONS, OfflineEmbeddingProvider } from "../../memory/embeddings.js";
import { OfflineRerankerProvider } from "../../memory/reranker.js";
import { benchmarkReceipt } from "../provenance.js";
import { validateStructuredContract, type StructuredContract as Contract, type StructuredContractCase as ContractCase } from "./structured-supersession-schema.js";

const CONTRACT = process.env.BENCH_CONTRACT ?? "src/benchmark/quality/structured-supersession-contract-v2.json";
const TOPK = Number(process.env.BENCH_TOPK ?? 5);
const MODEL = (process.env.BENCH_EMBED_MODEL ?? "paraphrase-multilingual-MiniLM-L12-v2") as any;
const MODEL_REVISION = process.env.BENCH_EMBED_REVISION ?? OFFLINE_MODEL_REVISIONS[MODEL as keyof typeof OFFLINE_MODEL_REVISIONS];
const EMBEDDING_DTYPE = String(MODEL).startsWith("multilingual-e5-") ? "q8" : "fp32";
const SEARCH_MODE = process.env.BENCH_SEARCH_MODE ?? "rrf";
const MMR_MODE = process.env.NAIA_MMR === "off" ? "off" : "on";
const RERANKER = process.env.BENCH_RERANKER ?? "none";
const CATEGORY_FILTER = process.env.BENCH_CATEGORY;
const NOW = 1_720_000_000_000;
type VariantName = "unstructured-control" | "explicit-structure-natural-query" | "explicit-structure-oracle-query" | "explicit-structure-wrong-query";
type CaseResult = ContractCase & { retrieved_statement_ids: string[]; history_statement_ids: string[]; acceptable_rank: number | null; acceptable_ranks: number[]; forbidden_ranks: number[]; stale_forbidden_ranks: number[]; active_distractor_ranks: number[]; active_statement_ids: string[]; inactive_statement_ids: string[] };
type Score = { evaluated: number; hitAt1: number; hitAtK: number; mrr: number; acceptableRecallAtK: number; completeAcceptableAtK: number; forbiddenAt1: number; forbiddenAtK: number; staleForbiddenAtK: number; activeDistractorAtK: number; lifecyclePass: number; transitionCases: number; transitionLifecyclePass: number | null; historyCoverageAtK: number; cases: CaseResult[] };

function load(): Contract {
	return JSON.parse(readFileSync(join(process.cwd(), CONTRACT), "utf8")) as Contract;
}

function contractName(): string {
	const match = CONTRACT.match(/structured-supersession-contract-(v\d+)\.json$/);
	if (!match) throw new Error("BENCH_CONTRACT must be a structured-supersession contract JSON fixture");
	return `structured-supersession-contract-${match[1]}`;
}

function pct(value: number) { return `${(value * 100).toFixed(1)}%`; }
function summarize(cases: CaseResult[]): Score {
	const evaluated = cases.length;
	const lifecycleOk = (c: CaseResult) => c.expected_active_statement_ids.every((id) => c.active_statement_ids.includes(id)) && c.expected_inactive_statement_ids.every((id) => c.inactive_statement_ids.includes(id));
	const historyOk = (c: CaseResult) => c.expected_history_statement_ids.every((id) => c.history_statement_ids.includes(id));
	const transitionCases = cases.filter((c) => c.expected_inactive_statement_ids.length > 0);
	return {
		evaluated,
		hitAt1: cases.filter((c) => c.acceptable_rank === 1).length / evaluated,
		hitAtK: cases.filter((c) => c.acceptable_rank !== null).length / evaluated,
		mrr: cases.reduce((total, c) => total + (c.acceptable_rank ? 1 / c.acceptable_rank : 0), 0) / evaluated,
		acceptableRecallAtK: cases.reduce((total, c) => total + c.acceptable_ranks.length / c.acceptable_statement_ids.length, 0) / evaluated,
		completeAcceptableAtK: cases.filter((c) => c.acceptable_ranks.length === c.acceptable_statement_ids.length).length / evaluated,
		forbiddenAt1: cases.filter((c) => c.forbidden_ranks.includes(1)).length / evaluated,
		forbiddenAtK: cases.filter((c) => c.forbidden_ranks.length > 0).length / evaluated,
		staleForbiddenAtK: cases.filter((c) => c.stale_forbidden_ranks.length > 0).length / evaluated,
		activeDistractorAtK: cases.filter((c) => c.active_distractor_ranks.length > 0).length / evaluated,
		lifecyclePass: cases.filter(lifecycleOk).length / evaluated,
		transitionCases: transitionCases.length,
		transitionLifecyclePass: transitionCases.length > 0 ? transitionCases.filter(lifecycleOk).length / transitionCases.length : null,
		historyCoverageAtK: cases.filter(historyOk).length / evaluated,
		cases,
	};
}

function recallStructure(name: VariantName, contract: Contract, current: ContractCase) {
	if (name === "explicit-structure-oracle-query") return current.recall_structured_query;
	if (name !== "explicit-structure-wrong-query") return undefined;
	const donor = contract.cases.find((candidate) =>
		candidate.id !== current.id
		&& candidate.recall_structured_query
		&& candidate.recall_project === current.recall_project,
	) ?? contract.cases.find((candidate) => candidate.id !== current.id && candidate.recall_structured_query);
	if (!donor?.recall_structured_query) throw new Error(`${current.id}: no wrong-query donor available`);
	return donor.recall_structured_query;
}

async function runVariant(name: VariantName, contract: Contract, embedder: OfflineEmbeddingProvider, reranker: OfflineRerankerProvider | undefined) {
	const path = join(tmpdir(), `naia-structured-contract-${name}-${process.pid}.json`);
	if (existsSync(path)) unlinkSync(path);
	const byContent = new Map(contract.cases.flatMap((c) => c.statements).map((s) => [s.content, s]));
	const extractor: FactExtractor = async (episodes) => episodes.map((episode) => {
		const statement = byContent.get(episode.content);
		if (!statement) throw new Error(`Unexpected benchmark episode: ${episode.content}`);
		return { content: statement.content, entities: [], topics: [], importance: 0.8, sourceEpisodeIds: [episode.id], ...(name === "unstructured-control" ? {} : { structured: statement.structured }) };
	});
	const adapter = new LocalAdapter({ storePath: path, embeddingProvider: embedder, reranker });
	const memory = new MemorySystem({
		adapter,
		factExtractor: extractor,
		contradictionFilter: new HeuristicContradictionFilter(),
		consolidationIntervalMs: 0,
	});
	await memory.init();
	for (const c of contract.cases) {
		for (let index = 0; index < c.statements.length; index++) {
			const statement = c.statements[index];
			await memory.encode({ content: statement.content, role: "user", timestamp: NOW + index + contract.cases.indexOf(c) * 100 }, { project: statement.project });
			await memory.consolidateNow(true);
		}
	}
	const stored = await adapter.semantic.getAll();
	const recallState = stored.map((fact) => ({ fact, recallCount: fact.recallCount, lastAccessed: fact.lastAccessed, strength: fact.strength }));
	const resetRecallState = () => {
		for (const snapshot of recallState) Object.assign(snapshot.fact, { recallCount: snapshot.recallCount, lastAccessed: snapshot.lastAccessed, strength: snapshot.strength });
	};
	const statementByContent = new Map(contract.cases.flatMap((c) => c.statements).map((s) => [s.content, s.id]));
	const result: CaseResult[] = [];
	for (const c of contract.cases) {
		const structuredQuery = recallStructure(name, contract, c);
		resetRecallState();
		const facts = (await memory.recall(c.query, { topK: TOPK, project: c.recall_project ?? "profile", scopeMode: "strict", ...(structuredQuery ? { structuredQuery } : {}) })).facts;
		resetRecallState();
		const historyFacts = (await memory.recall(c.query, { topK: TOPK, project: c.recall_project ?? "profile", scopeMode: "strict", mode: "history", ...(structuredQuery ? { structuredQuery } : {}) })).facts;
		const retrieved = facts.map((fact) => statementByContent.get(fact.content)).filter((id): id is string => Boolean(id));
		const history = historyFacts.map((fact) => statementByContent.get(fact.content)).filter((id): id is string => Boolean(id));
		const active = stored.filter((fact) => c.statements.some((s) => s.content === fact.content) && fact.status === "active").map((fact) => statementByContent.get(fact.content)!).sort();
		const inactive = stored.filter((fact) => c.statements.some((s) => s.content === fact.content) && fact.status !== "active").map((fact) => statementByContent.get(fact.content)!).sort();
		const acceptableRank = retrieved.findIndex((id) => c.acceptable_statement_ids.includes(id));
		const acceptableRanks = retrieved.map((id, index) => c.acceptable_statement_ids.includes(id) ? index + 1 : 0).filter(Boolean);
		const forbiddenRanks = retrieved.map((id, index) => c.forbidden_statement_ids.includes(id) ? index + 1 : 0).filter(Boolean);
		const staleForbiddenRanks = retrieved.map((id, index) => c.forbidden_statement_ids.includes(id) && c.expected_inactive_statement_ids.includes(id) ? index + 1 : 0).filter(Boolean);
		const activeDistractorRanks = retrieved.map((id, index) => c.forbidden_statement_ids.includes(id) && !c.expected_inactive_statement_ids.includes(id) ? index + 1 : 0).filter(Boolean);
		result.push({ ...c, retrieved_statement_ids: retrieved, history_statement_ids: history, acceptable_rank: acceptableRank < 0 ? null : acceptableRank + 1, acceptable_ranks: acceptableRanks, forbidden_ranks: forbiddenRanks, stale_forbidden_ranks: staleForbiddenRanks, active_distractor_ranks: activeDistractorRanks, active_statement_ids: active, inactive_statement_ids: inactive });
	}
	await memory.close();
	if (existsSync(path)) unlinkSync(path);
	const score = summarize(result);
	console.log(`${name}: hit@1=${pct(score.hitAt1)} hit@${TOPK}=${pct(score.hitAtK)} complete@${TOPK}=${pct(score.completeAcceptableAtK)} acceptable-recall@${TOPK}=${pct(score.acceptableRecallAtK)} MRR=${score.mrr.toFixed(3)} forbidden@1=${pct(score.forbiddenAt1)} forbidden@${TOPK}=${pct(score.forbiddenAtK)} lifecycle=${pct(score.lifecyclePass)} transition-lifecycle=${score.transitionLifecyclePass === null ? "n/a" : pct(score.transitionLifecyclePass)} history-coverage@${TOPK}=${pct(score.historyCoverageAtK)}`);
	return score;
}

async function runBenchmark(generatedAt: string) {
	if (!Number.isInteger(TOPK) || TOPK < 1) throw new Error("BENCH_TOPK must be a positive integer");
	if (!["rrf", "vector-only"].includes(SEARCH_MODE)) throw new Error("BENCH_SEARCH_MODE must be rrf or vector-only");
	if (!["none", "bge-reranker-base"].includes(RERANKER)) throw new Error("BENCH_RERANKER must be none or bge-reranker-base");
	if (!MODEL_REVISION) throw new Error("BENCH_EMBED_REVISION is required for an unrecognized embedding model");
	const contract = load();
	const benchmark = contractName();
	validateStructuredContract(contract);
	const selectedCases = CATEGORY_FILTER ? contract.cases.filter((c) => c.category === CATEGORY_FILTER) : contract.cases;
	if (selectedCases.length === 0) throw new Error(`BENCH_CATEGORY did not match any cases: ${CATEGORY_FILTER}`);
	const runContract = CATEGORY_FILTER ? { ...contract, cases: selectedCases } : contract;
	console.log(`Validated ${contract.cases.length} fixed cases; running ${selectedCases.length} in ${new Set(selectedCases.map((c) => c.language)).size} languages (category=${CATEGORY_FILTER ?? "all"}, search=${SEARCH_MODE}, reranker=${RERANKER}).`);
	if (process.env.BENCH_VALIDATE_ONLY === "1") return;
	if (SEARCH_MODE === "vector-only") process.env.NAIA_SEARCH_MODE = "vector-only";
	else delete process.env.NAIA_SEARCH_MODE;
	const embedder = new OfflineEmbeddingProvider(MODEL, "cpu", MODEL_REVISION);
	const reranker = RERANKER === "bge-reranker-base" ? new OfflineRerankerProvider("bge-reranker-base") : undefined;
	const variants = {
		"unstructured-control": await runVariant("unstructured-control", runContract, embedder, reranker),
		"explicit-structure-natural-query": await runVariant("explicit-structure-natural-query", runContract, embedder, reranker),
		"explicit-structure-oracle-query": await runVariant("explicit-structure-oracle-query", runContract, embedder, reranker),
		"explicit-structure-wrong-query": await runVariant("explicit-structure-wrong-query", runContract, embedder, reranker),
	};
	const receipt = benchmarkReceipt([CONTRACT], { model: MODEL, modelRepository: `Xenova/${MODEL}`, modelRevision: MODEL_REVISION, device: "cpu", embeddingDtype: EMBEDDING_DTYPE, rerankerDtype: RERANKER === "none" ? null : "q8", contradictionFilter: "heuristic", topK: TOPK, categoryFilter: CATEGORY_FILTER ?? null, searchMode: SEARCH_MODE, mmr: MMR_MODE, reranker: RERANKER, benchmarkClock: new Date(NOW).toISOString(), variants: Object.keys(variants) }, [
		"src/benchmark/quality/structured-supersession-contract.ts",
		"src/benchmark/quality/structured-supersession-schema.ts",
		"src/benchmark/quality/generate-structured-supersession-v3.ts",
		"src/benchmark/provenance.ts",
		"src/memory/embeddings.ts",
		"src/memory/importance.ts",
		"src/memory/index.ts",
		"src/memory/adapters/local.ts",
		"src/memory/adapters/local-model.ts",
		"src/memory/adapters/local-search.ts",
		"src/memory/adapters/local-semantic-search.ts",
		"src/memory/decay.ts",
		"src/memory/knowledge-graph.ts",
		"src/memory/ko-normalize.ts",
		"src/memory/reranker.ts",
		"src/memory/memory-system.ts",
		"src/memory/memory-system-api.ts",
		"src/memory/memory-system-core.ts",
		"src/memory/memory-system-backup.ts",
		"src/memory/memory-system-consolidation.ts",
		"src/memory/memory-system-rolling.ts",
		"src/memory/memory-system-compaction.ts",
		"src/memory/consolidation-primitives.ts",
		"src/memory/contradiction-filter.ts",
		"src/memory/negative-capture.ts",
		"src/memory/reconsolidation.ts",
		"src/memory/structured-facts.ts",
		"package.json",
		"pnpm-lock.yaml",
	], generatedAt);
	const perLanguage = Object.fromEntries(["ko", "en", "ja"].map((language) => [
		language,
		Object.fromEntries(Object.entries(variants).map(([name, score]) => [name, summarize(score.cases.filter((c) => c.language === language))])),
	]));
	const output = {
		benchmark,
		receipt,
		dimensions: embedder.dims,
		fixtureDisclosure: { benchmarkTier: contract.benchmark_tier ?? "legacy-reviewed-diagnostic", nativeReviewStatus: contract.native_review_status ?? "not-recorded", purpose: contract.purpose ?? null },
		interpretation: "Mechanism diagnostic only. Natural-query and wrong-query ablations separate write-time lifecycle value from query-side identity assistance; this fixture cannot support a general or native-language superiority claim.",
		queryAssistanceDisclosure: {
			"unstructured-control": "No structured write metadata and no query identity.",
			"explicit-structure-natural-query": "Structured write metadata; natural-language query only.",
			"explicit-structure-oracle-query": "Structured write metadata plus fixture-supplied correct subject/property identity.",
			"explicit-structure-wrong-query": "Structured write metadata plus a different case's subject/property identity.",
		},
		variants,
		perLanguage,
	};
	const directory = join(process.cwd(), "reports", "quality");
	mkdirSync(directory, { recursive: true });
	const modelSuffix = MODEL === "paraphrase-multilingual-MiniLM-L12-v2"
		? ""
		: `-${String(MODEL).replace(/[^a-zA-Z0-9._-]+/g, "-")}`;
	const topKSuffix = TOPK === 5 ? "" : `-top${TOPK}`;
	const categorySuffix = CATEGORY_FILTER ? `-${CATEGORY_FILTER.replace(/[^a-zA-Z0-9._-]+/g, "-")}-only` : "";
	const artifact = `${benchmark}${modelSuffix}${topKSuffix}${categorySuffix}${MMR_MODE === "off" ? "-no-mmr" : ""}${RERANKER === "none" ? "" : `-${RERANKER}-q8`}${SEARCH_MODE === "rrf" ? "" : `-${SEARCH_MODE}`}.json`;
	writeFileSync(join(directory, artifact), JSON.stringify(output, null, 2));
	console.log(`Artifact: reports/quality/${artifact}`);
}

async function main() {
	const systemNow = Date.now;
	const generatedAt = new Date(systemNow()).toISOString();
	Date.now = () => NOW;
	try {
		await runBenchmark(generatedAt);
	} finally {
		Date.now = systemNow;
	}
}
main().catch((error) => { console.error(error); process.exit(1); });
