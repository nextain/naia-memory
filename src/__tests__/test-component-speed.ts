import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { join } from "node:path";
import { homedir } from "node:os";

const dbPath = join(homedir(), ".naia", "memory", "stress-test-100k.db");
const db = new Database(dbPath);
sqliteVec.load(db);

const queryVec = new Float32Array(384).fill(0);

console.log("--- Performance Test: Vector Only ---");
const startVec = performance.now();
const rowsVec = db.prepare("SELECT fact_id, distance FROM vec_facts WHERE embedding MATCH ? AND k = 20").all(Buffer.from(queryVec.buffer));
const endVec = performance.now();
console.log(`Vector Search (k=20) took: ${(endVec - startVec).toFixed(4)}ms`);

console.log("--- Performance Test: FTS Only (100k matches) ---");
const startFTS = performance.now();
const rowsFTS = db.prepare("SELECT rowid, bm25(facts_fts) as score FROM facts_fts WHERE facts_fts MATCH 'synthetic*' ORDER BY bm25(facts_fts) LIMIT 200").all();
const endFTS = performance.now();
console.log(`FTS Rank (100k matches, top 200) took: ${(endFTS - startFTS).toFixed(4)}ms`);

console.log("--- Performance Test: Surgical Join (200 IDs) ---");
const ids = rowsFTS.map((r: any) => r.rowid);
const startJoin = performance.now();
const rowsJoin = db.prepare(`SELECT * FROM facts WHERE rowid IN (${ids.join(",") || "-1"})`).all();
const endJoin = performance.now();
console.log(`Surgical Join (200 rowids) took: ${(endJoin - startJoin).toFixed(4)}ms`);

db.close();
