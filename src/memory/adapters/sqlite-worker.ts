import { parentPort, workerData } from "node:worker_threads";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

const { dbPath } = workerData;
const db = new Database(dbPath);
sqliteVec.load(db);

// Minimal state needed in worker
let kgCache: any = null;
let kgDirty = true;

function bumpFactGeneration() {
    db.prepare(`INSERT INTO memory_metadata (key, value) VALUES ('facts_generation', '1')
        ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1`).run();
}

parentPort?.on("message", async (msg) => {
    const { id, type, payload } = msg;
    try {
        let result;
        switch (type) {
            case "exec":
                result = db.exec(payload.sql);
                break;
            case "prepare-all":
                result = db.prepare(payload.sql).all(...payload.params);
                break;
            case "prepare-get":
                result = db.prepare(payload.sql).get(...payload.params);
                break;
            case "prepare-run":
                result = db.prepare(payload.sql).run(...payload.params);
                break;
            case "transaction":
                // Execute a series of prepared statements in a transaction
                const tx = db.transaction((ops: any[]) => {
                    for (const op of ops) {
                        db.prepare(op.sql).run(...op.params);
                    }
                });
                result = tx(payload.ops);
                break;
            case "upsert-facts": {
                const tx = db.transaction((facts: any[]) => {
                    const getMappedId = db.prepare("SELECT fid FROM id_map WHERE fact_id = ?");
                    const getNextId = db.prepare("SELECT COALESCE(MAX(fid), 0) + 1 AS fid FROM id_map");
                    const upsertId = db.prepare("INSERT OR REPLACE INTO id_map (fid, fact_id) VALUES (?, ?)");
                    const upsertTime = db.prepare("INSERT OR REPLACE INTO facts_time_idx (id, min_ts, max_ts) VALUES (?, ?, ?)");
                    const deleteFts = ["facts_fts", "facts_fts_hot"].map((table) => db.prepare(`DELETE FROM ${table} WHERE rowid = ?`));
                    const deleteVectors = ["vec_facts", "vec_facts_hot"].map((table) => db.prepare(`DELETE FROM ${table} WHERE fact_id = ?`));
                    const insertFts = db.prepare("INSERT INTO facts_fts (rowid, content, entities, topics) VALUES (?, ?, ?, ?)");
                    const insertHotFts = db.prepare("INSERT INTO facts_fts_hot (rowid, content, entities, topics) VALUES (?, ?, ?, ?)");
                    const insertVector = db.prepare("INSERT INTO vec_facts (fact_id, embedding) VALUES (?, ?)");
                    const insertHotVector = db.prepare("INSERT INTO vec_facts_hot (fact_id, embedding) VALUES (?, ?)");
                    for (const p of facts) {
                    const previous = getMappedId.get(p.factId) as { fid?: number } | undefined;
                    const fid = previous?.fid ?? Number((getNextId.get() as { fid: number }).fid);
                    db.prepare(p.factSql).run(...p.factParams);
                    upsertId.run(fid, p.factId);
                    upsertTime.run(fid, p.minTs, p.maxTs);
                    for (const statement of deleteFts) statement.run(fid);
                    for (const statement of deleteVectors) statement.run(p.factId);
                    insertFts.run(fid, p.content, p.entities, p.topics);
                    if (p.hot) insertHotFts.run(fid, p.content, p.entities, p.topics);
                    if (p.vector) {
                        insertVector.run(p.factId, p.vector);
                        if (p.hot) insertHotVector.run(p.factId, p.vector);
                    }
                    bumpFactGeneration();
                    }
                });
                result = tx(payload.facts);
                break;
            }
            case "archive-fact": {
                const tx = db.transaction((factId: string) => {
                    const mapped = db.prepare("SELECT fid FROM id_map WHERE fact_id = ?").get(factId) as { fid?: number } | undefined;
                    const changed = db.prepare("UPDATE facts SET status = 'archived', updated_at = ? WHERE id = ?").run(Date.now(), factId);
                    if (!changed.changes) return false;
                    if (mapped?.fid !== undefined) {
                        db.prepare("DELETE FROM facts_fts_hot WHERE rowid = ?").run(mapped.fid);
                    }
                    db.prepare("DELETE FROM vec_facts_hot WHERE fact_id = ?").run(factId);
                    bumpFactGeneration();
                    return true;
                });
                result = tx(payload.factId);
                break;
            }
            case "replace-vectors": {
                const tx = db.transaction((p: any) => {
                    const generation = Number((db.prepare("SELECT value FROM memory_metadata WHERE key = 'facts_generation'").get() as { value?: string } | undefined)?.value ?? 0);
                    if (generation !== p.expectedGeneration) throw new Error("Facts changed during embedding reindex; retry required");
                    db.exec("DROP TABLE IF EXISTS vec_facts; DROP TABLE IF EXISTS vec_facts_hot;");
                    db.exec(`CREATE VIRTUAL TABLE vec_facts USING vec0(fact_id TEXT PRIMARY KEY, embedding float[${p.dims}]); CREATE VIRTUAL TABLE vec_facts_hot USING vec0(fact_id TEXT PRIMARY KEY, embedding float[${p.dims}]);`);
                    const insert = db.prepare("INSERT INTO vec_facts (fact_id, embedding) VALUES (?, ?)");
                    const insertHot = db.prepare("INSERT INTO vec_facts_hot (fact_id, embedding) VALUES (?, ?)");
                    for (const vector of p.vectors) {
                        insert.run(vector.factId, vector.embedding);
                        if (vector.hot) insertHot.run(vector.factId, vector.embedding);
                    }
                    db.prepare("INSERT OR REPLACE INTO memory_metadata (key, value) VALUES ('embedding_space_id', ?)").run(p.embeddingSpaceId);
                    db.prepare("INSERT OR REPLACE INTO memory_metadata (key, value) VALUES ('embedding_dimensions', ?)").run(String(p.dims));
                });
                result = tx(payload);
                break;
            }
            default:
                throw new Error(`Unknown worker command: ${type}`);
        }
        parentPort?.postMessage({ id, result });
    } catch (error: any) {
        parentPort?.postMessage({ id, error: error.message });
    }
});
