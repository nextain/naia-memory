/**
 * Same-condition Mem0 OSS raw-memory control for the structured supersession
 * contract. This deliberately uses infer:false: no remote LLM, no extraction,
 * and the exact same local multilingual embedder used by the Naia run.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Memory } from "mem0ai/oss";
import { OFFLINE_MODEL_REVISIONS, OfflineEmbeddingProvider } from "../../memory/embeddings.js";
import { benchmarkReceipt } from "../provenance.js";
import { validateStructuredContract } from "./structured-supersession-schema.js";

const CONTRACT = process.env.BENCH_CONTRACT ?? "src/benchmark/quality/structured-supersession-contract-v2.json";
const TOPK = Number(process.env.BENCH_TOPK ?? 5);
const MODEL = (process.env.BENCH_EMBED_MODEL ?? "paraphrase-multilingual-MiniLM-L12-v2") as ConstructorParameters<typeof OfflineEmbeddingProvider>[0];
const EMBEDDING_DTYPE = MODEL.startsWith("multilingual-e5-") ? "q8" : "fp32";
const MODEL_REVISION = process.env.BENCH_EMBED_REVISION ?? OFFLINE_MODEL_REVISIONS[MODEL];

type Statement = { id: string; content: string; project: string };
type ContractCase = {
	id: string;
	language: string;
	query: string;
	statements: Statement[];
	acceptable_statement_ids: string[];
	forbidden_statement_ids: string[];
	expected_inactive_statement_ids: string[];
	recall_project?: string;
};
type Contract = { schema_version: string; cases: ContractCase[] };

function contractName(): string {
	const match = CONTRACT.match(/structured-supersession-contract-(v\d+)\.json$/);
	if (!match) throw new Error("BENCH_CONTRACT must be a structured-supersession contract JSON fixture");
	return `structured-supersession-contract-${match[1]}`;
}

function pct(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
	if (!Number.isInteger(TOPK) || TOPK < 1) throw new Error("BENCH_TOPK must be a positive integer");
	if (!MODEL_REVISION) throw new Error("BENCH_EMBED_REVISION is required for an unrecognized embedding model");
	const contract = JSON.parse(readFileSync(join(process.cwd(), CONTRACT), "utf8")) as Contract;
	validateStructuredContract(contract as Parameters<typeof validateStructuredContract>[0]);

	const embedder = new OfflineEmbeddingProvider(MODEL, "cpu", MODEL_REVISION);
	const langchainEmbedder = {
		embedQuery: (text: string) => embedder.embed(text),
		embedDocuments: (texts: string[]) => embedder.embedBatch(texts),
	};
	const base = join(tmpdir(), `naia-mem0-control-${process.pid}`);
	const vectorDb = `${base}-vec.db`;
	const historyDb = `${base}-history.db`;
	for (const path of [vectorDb, historyDb]) if (existsSync(path)) unlinkSync(path);

	const memory = new Memory({
		embedder: { provider: "langchain", config: { model: langchainEmbedder, embeddingDims: embedder.dims } },
		vectorStore: { provider: "memory", config: { collectionName: `bench-${process.pid}`, dimension: embedder.dims, dbPath: vectorDb } },
		// Constructed for Mem0's config contract but never called with infer:false.
		llm: { provider: "openai", config: { apiKey: "not-used", model: "not-used" } },
		historyDbPath: historyDb,
		disableHistory: true,
	});

	for (const c of contract.cases) {
		for (const statement of c.statements) {
			await memory.add([{ role: "user", content: statement.content }], {
				userId: statement.project,
				infer: false,
				metadata: { statementId: statement.id },
			});
		}
	}

	const cases = [];
	for (const c of contract.cases) {
		const result = await memory.search(c.query, { userId: c.recall_project ?? "profile", limit: TOPK });
		const retrieved = result.results.map((item) => item.metadata?.statementId as string | undefined).filter((id): id is string => Boolean(id));
		const acceptableIndex = retrieved.findIndex((id) => c.acceptable_statement_ids.includes(id));
		const acceptableRanks = retrieved.map((id, index) => c.acceptable_statement_ids.includes(id) ? index + 1 : 0).filter(Boolean);
		const forbiddenRanks = retrieved.map((id, index) => c.forbidden_statement_ids.includes(id) ? index + 1 : 0).filter(Boolean);
		const staleForbiddenRanks = retrieved.map((id, index) => c.forbidden_statement_ids.includes(id) && c.expected_inactive_statement_ids.includes(id) ? index + 1 : 0).filter(Boolean);
		const activeDistractorRanks = retrieved.map((id, index) => c.forbidden_statement_ids.includes(id) && !c.expected_inactive_statement_ids.includes(id) ? index + 1 : 0).filter(Boolean);
		cases.push({
			id: c.id,
			language: c.language,
			query: c.query,
			retrieved_statement_ids: retrieved,
			acceptable_rank: acceptableIndex < 0 ? null : acceptableIndex + 1,
			acceptable_ranks: acceptableRanks,
			forbidden_ranks: forbiddenRanks,
			stale_forbidden_ranks: staleForbiddenRanks,
			active_distractor_ranks: activeDistractorRanks,
		});
	}

	const evaluated = cases.length;
	const score = {
		evaluated,
		hitAt1: cases.filter((c) => c.acceptable_rank === 1).length / evaluated,
		hitAtK: cases.filter((c) => c.acceptable_rank !== null).length / evaluated,
		completeAcceptableAtK: cases.filter((c, index) => c.acceptable_ranks.length === contract.cases[index].acceptable_statement_ids.length).length / evaluated,
		acceptableRecallAtK: cases.reduce((sum, c, index) => sum + c.acceptable_ranks.length / contract.cases[index].acceptable_statement_ids.length, 0) / evaluated,
		mrr: cases.reduce((sum, c) => sum + (c.acceptable_rank ? 1 / c.acceptable_rank : 0), 0) / evaluated,
		forbiddenAt1: cases.filter((c) => c.forbidden_ranks.includes(1)).length / evaluated,
		forbiddenAtK: cases.filter((c) => c.forbidden_ranks.length > 0).length / evaluated,
		staleForbiddenAtK: cases.filter((c) => c.stale_forbidden_ranks.length > 0).length / evaluated,
		activeDistractorAtK: cases.filter((c) => c.active_distractor_ranks.length > 0).length / evaluated,
		cases,
	};
	const receipt = benchmarkReceipt([CONTRACT], {
		engine: "mem0ai-oss",
		engineVersion: "2.4.5",
		mode: "infer:false raw memory",
		model: MODEL,
		modelRepository: `Xenova/${MODEL}`,
		modelRevision: MODEL_REVISION,
		device: "cpu",
		embeddingDtype: EMBEDDING_DTYPE,
		topK: TOPK,
	}, [
		"src/benchmark/quality/structured-supersession-mem0-control.ts",
		"src/benchmark/provenance.ts",
		"src/memory/embeddings.ts",
		"package.json",
		"pnpm-lock.yaml",
	]);
	const benchmark = `${contractName()}-mem0-oss-raw-control`;
	const output = {
		benchmark,
		receipt,
		interpretation: "Executable retrieval control only. infer:false disables Mem0 LLM extraction/update logic; lifecycle and history are unsupported by this control and are not scored.",
		score,
	};
	const directory = join(process.cwd(), "reports", "quality");
	mkdirSync(directory, { recursive: true });
	const modelSuffix = MODEL === "paraphrase-multilingual-MiniLM-L12-v2"
		? ""
		: `-${String(MODEL).replace(/[^a-zA-Z0-9._-]+/g, "-")}`;
	const topKSuffix = TOPK === 5 ? "" : `-top${TOPK}`;
	const artifact = join(directory, `${benchmark}${modelSuffix}${topKSuffix}.json`);
	writeFileSync(artifact, JSON.stringify(output, null, 2));
	console.log(`mem0-oss-raw: hit@1=${pct(score.hitAt1)} hit@${TOPK}=${pct(score.hitAtK)} complete@${TOPK}=${pct(score.completeAcceptableAtK)} acceptable-recall@${TOPK}=${pct(score.acceptableRecallAtK)} MRR=${score.mrr.toFixed(3)} forbidden@1=${pct(score.forbiddenAt1)} forbidden@${TOPK}=${pct(score.forbiddenAtK)}`);
	console.log(`Artifact: ${artifact}`);
	for (const path of [vectorDb, historyDb]) if (existsSync(path)) unlinkSync(path);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
