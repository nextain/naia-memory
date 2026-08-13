/**
 * Retrieval quality (recall@k / MRR) on the labeled Korean fact-bank v2 —
 * the /goal's "기억 품질" axis, fully local (no external API).
 *
 * Corpus: src/benchmark/fact-bank-v2.json (200 facts). Queries:
 * query-templates-v2.json (each has `fact_ref` = gold fact id).
 * Metric per query: rank of the gold fact in recall(query, topK).
 *   recall@1/5/10, MRR.
 *
 * Compares the two retrieval modes because Korean FTS5 tokenization is weak:
 *   - RRF (BM25 + vector, default for dims < 2000)
 *   - vector-only (NAIA_SEARCH_MODE=vector-only)
 * Stores the corpus ONCE (embedding dominates cost) then runs both passes.
 *
 * Env: BENCH_EMBED_MODEL (default multilingual-e5-large), BENCH_TOPK (10),
 *      WITH_DISTRACTOR (add hard negatives), RUN_BINQUANT (binary-quant check).
 * Run: npx tsx src/benchmark/quality/recall-at-k.ts
 */
import { MemorySystem } from "../../memory/index.js";
import { LocalAdapter } from "../../memory/adapters/local.js";
import { OfflineEmbeddingProvider } from "../../memory/embeddings.js";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { readFileSync, mkdirSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { benchmarkReceipt } from "../provenance.js";

const TOPK = Number(process.env.BENCH_TOPK ?? 10);
const NOW = 1_720_000_000_000;
const MODEL = (process.env.BENCH_EMBED_MODEL ?? "multilingual-e5-large") as any;
const loadJson = (p: string) => JSON.parse(readFileSync(join(process.cwd(), p), "utf-8"));

interface QResult { recall1: number; recall5: number; recall10: number; mrr: number; evaluated: number; }

async function scorePass(memory: MemorySystem, labeled: any[]): Promise<QResult> {
	let r1 = 0, r5 = 0, r10 = 0, mrrSum = 0, n = 0;
	for (const q of labeled) {
		const res = await memory.recall(q.query, { topK: TOPK });
		const rank = res.facts.map((f: any) => f.id).indexOf(q.fact_ref);
		n++;
		if (rank === 0) r1++;
		if (rank >= 0 && rank < 5) r5++;
		if (rank >= 0 && rank < 10) r10++;
		mrrSum += rank >= 0 ? 1 / (rank + 1) : 0;
	}
	return { recall1: r1 / n, recall5: r5 / n, recall10: r10 / n, mrr: mrrSum / n, evaluated: n };
}

async function main() {
	const fb = loadJson("src/benchmark/fact-bank-v2.json");
	const qt = loadJson("src/benchmark/query-templates-v2.json");
	const facts: any[] = fb.facts;
	const queries: any[] = Object.values(qt).find((v) => Array.isArray(v)) as any[];
	const factById = new Map(facts.map((f) => [f.id, f]));
	const catFilter = process.env.BENCH_CATEGORY;
	const labeled = queries.filter((q) => q.fact_ref && factById.has(q.fact_ref) && (!catFilter || q.category === catFilter));
	const cats = [...new Set(queries.map((q) => q.category))];
	console.log(`categories: ${cats.join(", ")}${catFilter ? ` | FILTER=${catFilter}` : ""}`);
	const withDistractor = !!process.env.WITH_DISTRACTOR;
	console.log(`=== recall@k on fact-bank v2 (facts=${facts.length}, labeled=${labeled.length}, model=${MODEL}, topK=${TOPK}, distractor=${withDistractor}) ===`);

	const storePath = join(tmpdir(), `naia-recall-bench-${NOW}.json`);
	if (existsSync(storePath)) unlinkSync(storePath);
	const embedder = new OfflineEmbeddingProvider(MODEL);
	const adapter = new LocalAdapter({ storePath, embeddingProvider: embedder });
	const memory = new MemorySystem({ adapter });
	await memory.init();

	const store = async (id: string, content: string) =>
		adapter.semantic.upsert({ id, content, entities: [], topics: [], importance: 0.5, maxEmotion: 0.1, strength: 0.8, status: "active", createdAt: NOW, updatedAt: NOW, lastAccessed: NOW, recallCount: 0, validFrom: NOW, validTo: null, sourceEpisodes: [randomUUID()], encodingContext: { project: "recall-bench" } } as any);

	const embStart = performance.now();
	for (const f of facts) {
		await store(f.id, f.statement);
		if (withDistractor && f.distractor?.statement) await store(f.distractor.id, f.distractor.statement);
	}
	console.log(`Stored ${facts.length}${withDistractor ? "+distractors" : ""} in ${((performance.now() - embStart) / 1000).toFixed(1)}s`);

	// Pass 1: RRF (default for e5 dims<2000)
	delete process.env.NAIA_SEARCH_MODE;
	const rrf = await scorePass(memory, labeled);
	// Pass 2: vector-only
	process.env.NAIA_SEARCH_MODE = "vector-only";
	const vec = await scorePass(memory, labeled);

	const pct = (x: number) => (x * 100).toFixed(1);
	console.log(`\n--- Retrieval quality (${rrf.evaluated} queries) ---`);
	console.log("| mode | recall@1 | recall@5 | recall@10 | MRR |");
	console.log("|---|---|---|---|---|");
	console.log(`| RRF (BM25+vec) | ${pct(rrf.recall1)}% | ${pct(rrf.recall5)}% | ${pct(rrf.recall10)}% | ${rrf.mrr.toFixed(3)} |`);
	console.log(`| vector-only | ${pct(vec.recall1)}% | ${pct(vec.recall5)}% | ${pct(vec.recall10)}% | ${vec.mrr.toFixed(3)} |`);

	// Optional: binary-quant recall validation on REAL embeddings (Phase 3 gate)
	let binq: any = null;
	if (process.env.RUN_BINQUANT) {
		console.log(`\n--- binary-quant recall validation on REAL embeddings (dims=${embedder.dims}) ---`);
		const vecs = await embedder.embedBatch(facts.map((f) => f.statement));
		const dims = embedder.dims;
		const db = new Database(":memory:");
		sqliteVec.load(db);
		db.exec(`CREATE VIRTUAL TABLE vf USING vec0(fact_id TEXT PRIMARY KEY, embedding float[${dims}])`);
		db.exec(`CREATE VIRTUAL TABLE vb USING vec0(fact_id TEXT PRIMARY KEY, embedding bit[${dims}])`);
		const insF = db.prepare("INSERT INTO vf(fact_id, embedding) VALUES (?, ?)");
		for (let i = 0; i < vecs.length; i++) insF.run(String(i), Buffer.from(new Float32Array(vecs[i]).buffer));
		db.exec("INSERT INTO vb(fact_id, embedding) SELECT fact_id, vec_quantize_binary(embedding) FROM vf");
		const fStmt = db.prepare("SELECT fact_id FROM vf WHERE embedding MATCH ? AND k = ?");
		const bStmt = db.prepare("SELECT fact_id FROM vb WHERE embedding MATCH vec_quantize_binary(?) AND k = ?");
		let ovBin = 0, ovTwo = 0, qn = 0;
		const COARSE = Math.min(50, vecs.length);
		for (const q of labeled) {
			const qvArr = await embedder.embed(`query: ${q.query}`);
			const qv = Buffer.from(new Float32Array(qvArr).buffer);
			const floatTop = (fStmt.all(qv, TOPK) as any[]).map((x) => x.fact_id);
			if (!floatTop.length) continue;
			const fset = new Set(floatTop);
			const binTop = (bStmt.all(qv, TOPK) as any[]).map((x) => x.fact_id);
			const coarse = (bStmt.all(qv, COARSE) as any[]).map((x) => x.fact_id);
			const scored = coarse.map((id: string) => {
				const a = vecs[Number(id)]; let s = 0;
				for (let d = 0; d < dims; d++) { const df = a[d] - qvArr[d]; s += df * df; }
				return { id, d: s };
			}).sort((a, b) => a.d - b.d).slice(0, TOPK).map((x) => x.id);
			ovBin += binTop.filter((x) => fset.has(x)).length / floatTop.length;
			ovTwo += scored.filter((x) => fset.has(x)).length / floatTop.length;
			qn++;
		}
		binq = { binaryOnlyOverlap: ovBin / qn, twoStageOverlap: ovTwo / qn, coarse: COARSE };
		console.log(`binary-only overlap@${TOPK} vs float: ${pct(binq.binaryOnlyOverlap)}%`);
		console.log(`2-stage(coarse${COARSE}) overlap@${TOPK} vs float: ${pct(binq.twoStageOverlap)}%`);
		db.close();
	}

	await memory.close?.();
	if (existsSync(storePath)) unlinkSync(storePath);

	const outDir = join(process.cwd(), "reports", "quality");
	mkdirSync(outDir, { recursive: true });
	const receipt = benchmarkReceipt(
		["src/benchmark/fact-bank-v2.json", "src/benchmark/query-templates-v2.json"],
		{ model: MODEL, topK: TOPK, withDistractor, benchmarkClock: new Date(NOW).toISOString() },
	);
	writeFileSync(join(outDir, "recall-at-k.json"), JSON.stringify({ benchmark: "recall-at-k", receipt, model: MODEL, dims: embedder.dims, facts: facts.length, withDistractor, evaluated: rrf.evaluated, rrf, vectorOnly: vec, binaryQuant: binq }, null, 2));
	console.log(`\nArtifact: reports/quality/recall-at-k.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
