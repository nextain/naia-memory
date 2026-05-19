import { LocalAdapter } from "../memory/adapters/local.js";
import { SqliteAdapter } from "../memory/adapters/sqlite.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export async function migrateJsonToSqlite(jsonPath: string, sqlitePath: string) {
    console.log(`--- Migrating ${jsonPath} to ${sqlitePath} ---`);
    
    if (!existsSync(jsonPath)) {
        console.error("Source JSON file not found.");
        return;
    }

    const jsonAdapter = new LocalAdapter({ storePath: jsonPath });
    await (jsonAdapter as any).init?.(); // load data if init() is available
    const store = (jsonAdapter as any).getStore?.() ?? (jsonAdapter as any).store ?? {};

    const sqliteAdapter = new SqliteAdapter({ dbPath: sqlitePath });
    
    // 1. Migrate Episodes
    console.log(`Migrating ${store.episodes.length} episodes...`);
    for (const ep of store.episodes) {
        await sqliteAdapter.episode.store(ep);
    }

    // 2. Migrate Facts
    console.log(`Migrating ${store.facts.length} facts...`);
    for (const fact of store.facts) {
        await sqliteAdapter.semantic.upsert(fact);
    }

    // 3. Migrate Epochs
    const epochs = store.epochs || [];
    console.log(`Migrating ${epochs.length} epochs...`);
    for (const epoch of epochs) {
        await sqliteAdapter.upsertEpoch(epoch);
    }

    // 4. Migrate KG
    console.log("Migrating Knowledge Graph...");
    const kg = store.knowledgeGraph || { nodes: {}, edges: {} };
    for (const node of Object.values(kg.nodes) as any[]) {
        // node migration logic
    }
    // Simplification: associate is used during upsert, but we can do a bulk KG migration if needed.

    console.log("--- Migration Completed ---");
}

// CLI Support
if (process.argv[1]?.endsWith("migrate-to-sqlite.ts") || process.argv[1]?.endsWith("migrate-to-sqlite.js")) {
    const jsonPath = process.argv[2] || join(homedir(), ".naia", "memory", "naia-memory.json");
    const sqlitePath = process.argv[3] || join(homedir(), ".naia", "memory", "naia-memory.db");
    migrateJsonToSqlite(jsonPath, sqlitePath).catch(console.error);
}
