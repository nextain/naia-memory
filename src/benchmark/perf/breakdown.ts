/**
 * Recall latency breakdown — attributes deep-recall time across the SQL stages
 * WITHOUT worker IPC (opens the preserved perf-bench DB directly), so we can
 * see where the ~41ms goes before optimizing. Reuses the DB left by
 * run-latency.ts (~/.naia/memory/perf-bench-latency.db).
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
const limit = TOPK * 10;

const db = new Database(dbPath, { readonly: false });
sqliteVec.load(db);
db.pragma("cache_size = -64000");

const embedder = new DeterministicEmbeddingProvider(DIMS);

const queries = [1, 42, 100, 250, 500, 777, 999, 12, 333, 654].map((n) => `topic-${n}`);

function med(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)];
}

async function main() {
	const total = db.prepare("SELECT count(*) c FROM facts").get() as any;
	const vecCold = db.prepare("SELECT count(*) c FROM vec_facts").get() as any;
	console.log(`DB: facts=${total.c}, vec_facts=${vecCold.c}, dims=${DIMS}`);

	// prepared statements (deep path = full corpus tables)
	const ftsStmt = db.prepare(
		"SELECT rowid, bm25(facts_fts) as score FROM facts_fts WHERE facts_fts MATCH ? ORDER BY bm25(facts_fts) LIMIT ?",
	);
	const vecStmt = db.prepare(
		"SELECT fact_id, distance FROM vec_facts WHERE embedding MATCH ? AND k = ?",
	);

	const acc = { embed: [] as number[], fts: [] as number[], vec: [] as number[], idmap: [] as number[], final: [] as number[], all: [] as number[] };

	// warmup
	for (const q of queries) {
		const v = await embedder.embed(q);
		ftsStmt.all(q.replace(/[^\w\s]/g, " ").trim().split(/\s+/).map((t) => `${t}*`).join(" OR "), limit);
		vecStmt.all(Buffer.from(new Float32Array(v).buffer), limit);
	}

	const ROUNDS = 20;
	for (let r = 0; r < ROUNDS; r++) {
		for (const q of queries) {
			const a0 = performance.now();
			const qvec = await embedder.embed(q);
			const a1 = performance.now();
			const match = q.replace(/[^\w\s]/g, " ").trim().split(/\s+/).map((t) => `${t}*`).join(" OR ");
			const ftsRows = ftsStmt.all(match, limit) as any[];
			const a2 = performance.now();
			const vecRows = vecStmt.all(Buffer.from(new Float32Array(qvec).buffer), limit) as any[];
			const a3 = performance.now();

			const rrfMap = new Map<string, number>();
			if (ftsRows.length > 0) {
				const resolved = db
					.prepare(`SELECT rowid, fact_id FROM id_map WHERE fid IN (${ftsRows.map((r2: any) => r2.rowid).join(",")})`)
					.all() as any[];
				resolved.forEach((r2: any, i: number) => rrfMap.set(r2.fact_id, 1.0 / (60 + (i + 1))));
			}
			const a4 = performance.now();
			vecRows.forEach((r2: any, i: number) => rrfMap.set(r2.fact_id, (rrfMap.get(r2.fact_id) || 0) + 1.0 / (60 + (i + 1))));
			const ids = Array.from(rrfMap.keys()).slice(0, 50);
			if (ids.length > 0) {
				db.prepare(`SELECT * FROM facts WHERE id IN (${ids.map(() => "?").join(",")}) LIMIT ?`).all(...ids, TOPK * 2);
			}
			const a5 = performance.now();

			acc.embed.push(a1 - a0);
			acc.fts.push(a2 - a1);
			acc.vec.push(a3 - a2);
			acc.idmap.push(a4 - a3);
			acc.final.push(a5 - a4);
			acc.all.push(a5 - a0);
		}
	}

	console.log(`\n--- Deep recall SQL breakdown (median ms over ${ROUNDS * queries.length} calls, NO worker IPC) ---`);
	console.log(`embed (local):     ${med(acc.embed).toFixed(3)}`);
	console.log(`FTS query:         ${med(acc.fts).toFixed(3)}`);
	console.log(`vec brute scan:    ${med(acc.vec).toFixed(3)}   <-- full-corpus KNN`);
	console.log(`id_map resolve:    ${med(acc.idmap).toFixed(3)}`);
	console.log(`final SELECT:      ${med(acc.final).toFixed(3)}`);
	console.log(`TOTAL (SQL only):  ${med(acc.all).toFixed(3)}`);
	console.log(`\n(vs worker-path deep p50 ~40.7ms → IPC/serialization overhead ≈ p50 - SQL total)`);
	db.close();
}

main();
