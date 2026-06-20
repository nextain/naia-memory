import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { join } from "node:path";
import { homedir } from "node:os";

const dbPath = join(homedir(), ".naia", "memory", "stress-test-100k.db");
const db = new Database(dbPath);
sqliteVec.load(db);

const queryVec = new Float32Array(384).fill(0);
const middleTs = Date.now() - (50000 * 1000);
const startT = middleTs - (5000 * 1000);
const endT = middleTs + (5000 * 1000);

console.log("--- Performance Test: Gated FTS (constraining to 10k rows) ---");
const startGated = performance.now();
// First get candidates from R-Tree
const candidateIds = db.prepare("SELECT id FROM facts_time_idx WHERE min_ts <= ? AND max_ts >= ?").all(endT, startT).map((r: any) => r.id);
console.log(`R-Tree found ${candidateIds.length} candidates in ${(performance.now() - startGated).toFixed(4)}ms`);

const startFTS = performance.now();
const rowsFTS = db.prepare(`SELECT rowid, bm25(facts_fts) as score FROM facts_fts WHERE facts_fts MATCH 'synthetic*' AND rowid IN (${candidateIds.slice(0, 1000).join(",")}) ORDER BY score LIMIT 20`).all();
const endFTS = performance.now();
console.log(`Gated FTS (1000 candidates) took: ${(endFTS - startFTS).toFixed(4)}ms`);

console.log("--- Performance Test: Vector with RowID filter ---");
const startVec = performance.now();
// Note: vec0 doesn't support 'fact_id IN' efficiently, but let's check
const rowsVec = db.prepare(`SELECT v.fact_id, v.distance FROM vec_facts v JOIN facts f ON f.id = v.fact_id WHERE v.embedding MATCH ? AND v.k = 20 AND f.rowid IN (${candidateIds.slice(0, 100).join(",")})`).all(Buffer.from(queryVec.buffer));
const endVec = performance.now();
console.log(`Gated Vector (100 candidates) took: ${(endVec - startVec).toFixed(4)}ms`);

db.close();
