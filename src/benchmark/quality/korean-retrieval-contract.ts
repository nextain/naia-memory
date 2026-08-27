/**
 * Korean retrieval contract benchmark.
 *
 * Unlike the legacy query-template score, this fixture is intentionally small
 * and reviewed: each case has one or more acceptable facts and explicit hard
 * negatives. It measures retrieval only; answer generation and abstention are
 * separate product responsibilities.
 *
 * Env: BENCH_EMBED_MODEL (default paraphrase-multilingual-MiniLM-L12-v2),
 *      BENCH_TOPK (default 5), BENCH_SEARCH_MODE (rrf|vector-only),
 *      BENCH_DISABLE_KG_SPREADING=1,
 *      BENCH_RERANKER=none|bge-reranker-base,
 *      NAIA_MMR=off,
 *      BENCH_VALIDATE_ONLY=1.
 */
import { MemorySystem } from "../../memory/index.js";
import { LocalAdapter } from "../../memory/adapters/local.js";
import { OFFLINE_MODEL_REVISIONS, OfflineEmbeddingProvider } from "../../memory/embeddings.js";
import { OfflineRerankerProvider } from "../../memory/reranker.js";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { benchmarkReceipt } from "../provenance.js";

const FACT_BANK = "src/benchmark/fact-bank-v2.json";
const CONTRACT = "src/benchmark/quality/korean-retrieval-contract-v1.json";
const TOPK = Number(process.env.BENCH_TOPK ?? 5);
const MODEL = (process.env.BENCH_EMBED_MODEL ?? "paraphrase-multilingual-MiniLM-L12-v2") as any;
const MODEL_REVISION = process.env.BENCH_EMBED_REVISION ?? OFFLINE_MODEL_REVISIONS[MODEL as keyof typeof OFFLINE_MODEL_REVISIONS];
const EMBEDDING_DTYPE = String(MODEL).startsWith("multilingual-e5-") ? "q8" : "fp32";
const SEARCH_MODE = process.env.BENCH_SEARCH_MODE ?? "rrf";
const DISABLE_KG_SPREADING = process.env.BENCH_DISABLE_KG_SPREADING === "1";
const MMR_MODE = process.env.NAIA_MMR === "off" ? "off" : "on";
const RERANKER = process.env.BENCH_RERANKER ?? "none";
const NOW = 1_720_000_000_000;
const load = (path: string) => JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));

type ContractCase = { id: string; category: string; query: string; acceptable_fact_ids: string[]; forbidden_fact_ids: string[] };
type Score = { evaluated: number; hitAt1: number; hitAtK: number; mrr: number; forbiddenAt1: number; forbiddenAtK: number; cases: Array<ContractCase & { retrieved_ids: string[]; acceptable_rank: number | null; forbidden_ranks: number[] }> };

export function validateContract(contract: { cases?: ContractCase[] }, availableIds: Set<string>) {
	if (!Array.isArray(contract.cases) || contract.cases.length < 12) throw new Error("Korean contract needs at least 12 reviewed cases");
	const ids = new Set<string>();
	for (const c of contract.cases) {
		if (!c.id || ids.has(c.id) || !c.category || !c.query) throw new Error(`Invalid or duplicate contract case: ${c.id}`);
		ids.add(c.id);
		if (!c.acceptable_fact_ids?.length) throw new Error(`${c.id}: acceptable_fact_ids is required`);
		for (const id of [...c.acceptable_fact_ids, ...c.forbidden_fact_ids]) if (!availableIds.has(id)) throw new Error(`${c.id}: unknown fact id ${id}`);
		if (c.acceptable_fact_ids.some((id) => c.forbidden_fact_ids.includes(id))) throw new Error(`${c.id}: acceptable and forbidden facts overlap`);
	}
}

async function main() {
	if (!Number.isInteger(TOPK) || TOPK < 1) throw new Error("BENCH_TOPK must be a positive integer");
	if (!["rrf", "vector-only"].includes(SEARCH_MODE)) throw new Error("BENCH_SEARCH_MODE must be rrf or vector-only");
	if (!["none", "bge-reranker-base"].includes(RERANKER)) throw new Error("BENCH_RERANKER must be none or bge-reranker-base");
	if (!MODEL_REVISION) throw new Error("BENCH_EMBED_REVISION is required for an unrecognized embedding model");
	const systemNow = Date.now;
	const generatedAt = new Date(systemNow()).toISOString();
	Date.now = () => NOW;
	try {
	const factBank = load(FACT_BANK);
	const contract = load(CONTRACT) as { cases: ContractCase[] };
	const corpus = factBank.facts.flatMap((fact: any) => [fact, ...(fact.distractor?.statement ? [fact.distractor] : [])]);
	validateContract(contract, new Set(corpus.map((fact: any) => fact.id)));
	console.log(`Validated ${contract.cases.length} Korean contract cases across ${new Set(contract.cases.map((c) => c.category)).size} categories (reranker=${RERANKER}).`);
	if (process.env.BENCH_VALIDATE_ONLY === "1") return;

	const storePath = join(tmpdir(), `naia-korean-contract-${process.pid}.json`);
	if (existsSync(storePath)) unlinkSync(storePath);
	const embedder = new OfflineEmbeddingProvider(MODEL, "cpu", MODEL_REVISION);
	const reranker = RERANKER === "bge-reranker-base" ? new OfflineRerankerProvider("bge-reranker-base") : undefined;
	const adapter = new LocalAdapter({ storePath, embeddingProvider: embedder, disableKGSpreading: DISABLE_KG_SPREADING, reranker });
	const memory = new MemorySystem({ adapter });
	await memory.init();
	const store = (id: string, content: string) => adapter.semantic.upsert({ id, content, entities: [], topics: [], importance: 0.5, maxEmotion: 0.1, strength: 0.8, status: "active", createdAt: NOW, updatedAt: NOW, lastAccessed: NOW, recallCount: 0, validFrom: NOW, validTo: null, sourceEpisodes: [randomUUID()], encodingContext: { project: "korean-retrieval-contract" } } as any);
	const started = performance.now();
	for (const fact of corpus) await store(fact.id, fact.statement);
	console.log(`Stored ${corpus.length} facts and hard negatives in ${((performance.now() - started) / 1000).toFixed(1)}s (CPU).`);
	if (SEARCH_MODE === "vector-only") process.env.NAIA_SEARCH_MODE = "vector-only";
	else delete process.env.NAIA_SEARCH_MODE;
	const storedFacts = await adapter.semantic.getAll();
	const recallState = storedFacts.map((fact) => ({ fact, recallCount: fact.recallCount, lastAccessed: fact.lastAccessed, strength: fact.strength }));
	const resetRecallState = () => {
		for (const snapshot of recallState) Object.assign(snapshot.fact, { recallCount: snapshot.recallCount, lastAccessed: snapshot.lastAccessed, strength: snapshot.strength });
	};

	let hit1 = 0, hitK = 0, forbidden1 = 0, forbiddenK = 0, mrr = 0;
	const cases: Score["cases"] = [];
	for (const c of contract.cases) {
		resetRecallState();
		const ids = (await memory.recall(c.query, { topK: TOPK })).facts.map((fact: any) => fact.id);
		const acceptableRank = ids.findIndex((id: string) => c.acceptable_fact_ids.includes(id));
		const forbiddenRanks = ids.map((id: string, index: number) => c.forbidden_fact_ids.includes(id) ? index + 1 : 0).filter(Boolean);
		if (acceptableRank === 0) hit1++;
		if (acceptableRank >= 0) { hitK++; mrr += 1 / (acceptableRank + 1); }
		if (forbiddenRanks.includes(1)) forbidden1++;
		if (forbiddenRanks.length) forbiddenK++;
		cases.push({ ...c, retrieved_ids: ids, acceptable_rank: acceptableRank >= 0 ? acceptableRank + 1 : null, forbidden_ranks: forbiddenRanks });
	}
	await memory.close?.();
	if (existsSync(storePath)) unlinkSync(storePath);
	const score: Score = { evaluated: cases.length, hitAt1: hit1 / cases.length, hitAtK: hitK / cases.length, mrr: mrr / cases.length, forbiddenAt1: forbidden1 / cases.length, forbiddenAtK: forbiddenK / cases.length, cases };
	const receipt = benchmarkReceipt([FACT_BANK, CONTRACT], { model: MODEL, modelRepository: `Xenova/${MODEL}`, modelRevision: MODEL_REVISION, device: "cpu", embeddingDtype: EMBEDDING_DTYPE, topK: TOPK, searchMode: SEARCH_MODE, mmr: MMR_MODE, reranker: RERANKER, disableKGSpreading: DISABLE_KG_SPREADING, benchmarkClock: new Date(NOW).toISOString(), corpusFacts: corpus.length }, [
		"src/benchmark/quality/korean-retrieval-contract.ts", "src/benchmark/provenance.ts",
		"src/memory/index.ts", "src/memory/memory-system.ts", "src/memory/memory-system-api.ts",
		"src/memory/memory-system-core.ts", "src/memory/adapters/local.ts",
		"src/memory/adapters/local-search.ts", "src/memory/adapters/local-semantic-search.ts",
		"src/memory/embeddings.ts", "src/memory/decay.ts", "src/memory/knowledge-graph.ts",
		"src/memory/ko-normalize.ts", "src/memory/reranker.ts", "package.json", "pnpm-lock.yaml",
	], generatedAt);
	const output = { benchmark: "korean-retrieval-contract-v1", receipt, dimensions: embedder.dims, score };
	const outDir = join(process.cwd(), "reports", "quality");
	mkdirSync(outDir, { recursive: true });
	const modelSuffix = MODEL === "paraphrase-multilingual-MiniLM-L12-v2"
		? ""
		: `-${String(MODEL).replace(/[^a-zA-Z0-9._-]+/g, "-")}`;
	const artifact = `korean-retrieval-contract-v1-${SEARCH_MODE}${modelSuffix}${DISABLE_KG_SPREADING ? "-no-kg-spreading" : ""}${MMR_MODE === "off" ? "-no-mmr" : ""}${RERANKER === "none" ? "" : `-${RERANKER}`}.json`;
	writeFileSync(join(outDir, artifact), JSON.stringify(output, null, 2));
	const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
	console.log(`hit@1=${pct(score.hitAt1)} hit@${TOPK}=${pct(score.hitAtK)} MRR=${score.mrr.toFixed(3)} forbidden@1=${pct(score.forbiddenAt1)} forbidden@${TOPK}=${pct(score.forbiddenAtK)}`);
	console.log(`Artifact: reports/quality/${artifact}`);
	} finally {
		Date.now = systemNow;
	}
}

main().catch((error) => { console.error(error); process.exit(1); });
