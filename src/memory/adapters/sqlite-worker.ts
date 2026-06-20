import { parentPort, workerData } from "node:worker_threads";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

const { dbPath } = workerData;
const db = new Database(dbPath);
sqliteVec.load(db);

// Minimal state needed in worker
let kgCache: any = null;
let kgDirty = true;

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
            default:
                throw new Error(`Unknown worker command: ${type}`);
        }
        parentPort?.postMessage({ id, result });
    } catch (error: any) {
        parentPort?.postMessage({ id, error: error.message });
    }
});
