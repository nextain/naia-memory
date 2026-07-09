/**
 * PROBE: binary-quantization coarse scan vs float32 brute-force for deep recall.
 * No adapter change — builds a `bit[dims]` table from the existing float
 * embeddings in the preserved perf-bench DB and measures:
 *   - Hamming KNN latency (coarse)
 *   - 2-stage latency (binary coarse top-N → float rerank → top-K)
 *   - recall overlap vs the float32 ground-truth top-K (quality cost of quant)
 * Decides whether binary quant is worth wiring into SqliteAdapter.
 */
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { DeterministicEmbeddingProvider } from "./deterministic-embedder.js";

const dbPath = join(homedir(), ".naia", "memory", "perf-bench-latency.db");
if (!existsSync(dbPath)) {
	console.error(`DB not found: ${dbPath} — run run-latency.ts first`);
	process.exit(1);
}
const DIMS = Number(process.env.BENCH_DIMS ?? 384);
const TOPK = 10;
const COARSE = Number(process.env.COARSE ?? 200); // binary candidates before rerank

const db = new Database(dbPath);
sqliteVec.load(db);
db.pragma("cache_size = -64000");
const embedder = new DeterministicEmbeddingProvider(DIMS);
const queries = [1, 42, 100, 250, 500, 777, 999, 12, 333, 654].map((n) => `topic-${n}`);
const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function main() {
	const n = (db.prepare("SELECT count(*) c FROM vec_facts").get() as any).c;
	console.log(`Building binary table from ${n} float vectors (dims=${DIMS})...`);
	db.exec("DROP TABLE IF EXISTS vec_facts_bin");
	db.exec(`CREATE VIRTUAL TABLE vec_facts_bin USING vec0(fact_id TEXT PRIMARY KEY, embedding bit[${DIMS}])`);
	const t0 = performance.now();
	db.exec("INSERT INTO vec_facts_bin(fact_id, embedding) SELECT fact_id, vec_quantize_binary(embedding) FROM vec_facts");
	console.log(`Binary build: ${((performance.now() - t0) / 1000).toFixed(2)}s`);

	const floatStmt = db.prepare("SELECT fact_id, distance FROM vec_facts WHERE embedding MATCH ? AND k = ?");
	const binStmt = db.prepare("SELECT fact_id, distance FROM vec_facts_bin WHERE embedding MATCH vec_quantize_binary(?) AND k = ?");
	// 2-stage: binary coarse candidates, then rerank by float L2 on those ids.

	// warmup
	for (const q of queries) {
		const v = Buffer.from(new Float32Array(await embedder.embed(q)).buffer);
		floatStmt.all(v, TOPK);
		binStmt.all(v, COARSE);
	}

	// Build a PK-indexed float store for fast candidate rerank (vec0 IN-filter is slow).
	db.exec("DROP TABLE IF EXISTS float_store");
	db.exec(`CREATE TABLE float_store (fact_id TEXT PRIMARY KEY, emb BLOB)`);
	db.exec("INSERT INTO float_store(fact_id, emb) SELECT fact_id, embedding FROM vec_facts");
	const getEmb = db.prepare("SELECT emb FROM float_store WHERE fact_id = ?");
	const l2 = (a: Float32Array, b: Float32Array) => {
		let s = 0;
		for (let i = 0; i < a.length; i++) {
			const d = a[i] - b[i];
			s += d * d;
		}
		return s;
	};

	const lat = { float: [] as number[], bin: [] as number[], twostage: [] as number[], twostageJs: [] as number[] };
	const overlapBin: number[] = [];
	const overlapTwo: number[] = [];
	const overlapJs: number[] = [];
	const ROUNDS = 20;
	for (let r = 0; r < ROUNDS; r++) {
		for (const q of queries) {
			const v = Buffer.from(new Float32Array(await embedder.embed(q)).buffer);

			let s = performance.now();
			const floatTop = (floatStmt.all(v, TOPK) as any[]).map((x) => x.fact_id);
			lat.float.push(performance.now() - s);

			s = performance.now();
			const binTop = (binStmt.all(v, TOPK) as any[]).map((x) => x.fact_id);
			lat.bin.push(performance.now() - s);

			// 2-stage: binary coarse top-COARSE → float rerank → top-K
			s = performance.now();
			const coarse = (binStmt.all(v, COARSE) as any[]).map((x) => x.fact_id);
			let twoTop: string[] = [];
			if (coarse.length > 0) {
				const rerank = db
					.prepare(
						`SELECT fact_id, vec_distance_l2(embedding, ?) as d FROM vec_facts WHERE fact_id IN (${coarse.map(() => "?").join(",")}) ORDER BY d LIMIT ?`,
					)
					.all(v, ...coarse, TOPK) as any[];
				twoTop = rerank.map((x) => x.fact_id);
			}
			lat.twostage.push(performance.now() - s);

			// 2-stage JS: binary coarse → BATCH-load candidate floats (1 query) → JS L2 rerank
			s = performance.now();
			const qf = new Float32Array(v.buffer, v.byteOffset, DIMS);
			const coarse2 = (binStmt.all(v, COARSE) as any[]).map((x) => x.fact_id);
			const rows = db
				.prepare(`SELECT fact_id, emb FROM float_store WHERE fact_id IN (${coarse2.map(() => "?").join(",")})`)
				.all(...coarse2) as any[];
			const scored = rows.map((row) => {
				const emb = new Float32Array((row.emb as Buffer).buffer, (row.emb as Buffer).byteOffset, DIMS);
				return { fid: row.fact_id, d: l2(qf, emb) };
			});
			scored.sort((a, b) => a.d - b.d);
			const jsTop = scored.slice(0, TOPK).map((x) => x.fid);
			lat.twostageJs.push(performance.now() - s);

			const fset = new Set(floatTop);
			overlapBin.push(binTop.filter((x) => fset.has(x)).length / Math.max(1, floatTop.length));
			overlapTwo.push(twoTop.filter((x) => fset.has(x)).length / Math.max(1, floatTop.length));
			overlapJs.push(jsTop.filter((x) => fset.has(x)).length / Math.max(1, floatTop.length));
		}
	}

	const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
	console.log(`\n--- Deep vec KNN: float32 vs binary (median ms, ${ROUNDS * queries.length} calls, topK=${TOPK}, coarse=${COARSE}) ---`);
	console.log(`float32 brute (baseline): ${med(lat.float).toFixed(2)} ms`);
	console.log(`binary Hamming (coarse):  ${med(lat.bin).toFixed(2)} ms   overlap@${TOPK} vs float = ${(avg(overlapBin) * 100).toFixed(1)}%`);
	console.log(`2-stage vec0-rerank:       ${med(lat.twostage).toFixed(2)} ms   overlap@${TOPK} vs float = ${(avg(overlapTwo) * 100).toFixed(1)}%`);
	console.log(`2-stage JS-rerank (PK):    ${med(lat.twostageJs).toFixed(2)} ms   overlap@${TOPK} vs float = ${(avg(overlapJs) * 100).toFixed(1)}%   <-- candidate design`);
	const binSize = (db.prepare("SELECT count(*) c FROM vec_facts_bin").get() as any).c;
	console.log(`\nbinary rows: ${binSize}`);
	db.close();
}
main();
