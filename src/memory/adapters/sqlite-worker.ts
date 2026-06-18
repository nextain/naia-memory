import { parentPort, workerData } from "node:worker_threads";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
// 이 파일은 sqlite.ts 에서 `new Worker(new URL("./sqlite-worker.ts"))` 로 런타임에 .ts 로 직접 로드된다(빌드 산출물 아님).
// 따라서 worker 내부 import 는 .ts 확장자가 필수(.js 로 바꾸면 worker 모듈 해석 실패 → 행). tsconfig.typecheck 의 allowImportingTsExtensions 가 이를 수용.
import { normalize, tokenize } from "../ko-normalize.ts";

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
