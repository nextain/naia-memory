import { parentPort, workerData } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

type ExactVectorRow = {
    fact_id: string;
    embedding: Uint8Array | ArrayBuffer;
};

type VectorSearchModule = {
    exactVectorTopN(
        rowSource: () => Iterable<ExactVectorRow>,
        query: readonly number[],
        limit: number,
    ): Array<{ fact_id: string; distance: number }>;
};

type DecayModule = {
    calculateStrength(
        importance: number,
        createdAt: number,
        recallCount: number,
        lastAccessed: number,
        now: number,
    ): number;
    shouldArchive(strength: number): boolean;
};

// Worker entry points run from either the source tree through tsx or the
// built package. Resolve the helper beside this file in both layouts; a
// static .js import is not remapped by the worker's tsx loader.
const vectorSearchJsUrl = new URL("./sqlite-vector-search.js", import.meta.url);
const vectorSearchUrl = existsSync(fileURLToPath(vectorSearchJsUrl))
    ? vectorSearchJsUrl
    : new URL("./sqlite-vector-search.ts", import.meta.url);
const { exactVectorTopN } = await import(vectorSearchUrl.href) as VectorSearchModule;
const decayJsUrl = new URL("../decay.js", import.meta.url);
const decayUrl = existsSync(fileURLToPath(decayJsUrl))
    ? decayJsUrl
    : new URL("../decay.ts", import.meta.url);
const { calculateStrength, shouldArchive } = await import(decayUrl.href) as DecayModule;

const { dbPath, mmapSizeBytes = 0 } = workerData as {
    dbPath: string;
    mmapSizeBytes?: number;
};
const db = new Database(dbPath);
// Multiple adapter instances may initialize and write the same database at
// once. Wait for the writer to leave the lock rather than surfacing a
// transient SQLITE_BUSY to the caller.
db.pragma("busy_timeout = 10000");

// better-sqlite3's busy handler handles ordinary writer hand-off, but a
// transaction can still surface SQLITE_BUSY when another connection changes
// the journal mode or wins the lock between the handler's checks. Retry the
// complete transaction so the read/modify/write unit remains atomic. The
// retry is deliberately outside the transaction callback: a failed attempt
// is rolled back before another attempt can begin.
const busySleep = new Int32Array(new SharedArrayBuffer(4));
function isBusyError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /(?:database|table) is locked|SQLITE_BUSY/i.test(message);
}

function withBusyRetry<T>(operation: () => T): T {
    for (let attempt = 0; ; attempt += 1) {
        try {
            return operation();
        } catch (error) {
            if (!isBusyError(error) || attempt >= 99) throw error;
            Atomics.wait(busySleep, 0, 0, Math.min(50, 5 + attempt));
        }
    }
}

// mmap_size is a per-connection setting, so it must be applied in the same
// worker connection that serves product queries. SQLite may report a smaller
// effective value (or zero) on platforms that cannot honor the request.
db.pragma(`mmap_size = ${mmapSizeBytes}`);
sqliteVec.load(db);

// Minimal state needed in worker
let kgCache: any = null;
let kgDirty = true;

// Version 3 records the one-time procedural-state backfill. Keeping this
// revision durable prevents a reopen from treating a legitimate learned_at=0
// value as legacy data again.
const SCHEMA_VERSION = 3;

// Keep the initial schema creation in the same transaction as migrations.
// In particular, do not create memory_metadata (or any bootstrap table) before
// checking an existing schema version: a database from a newer package must be
// rejected without leaving a partial downgrade or bootstrap behind.
const BASE_SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS episodes (id TEXT PRIMARY KEY, content TEXT NOT NULL, timestamp INTEGER NOT NULL, role TEXT NOT NULL, consolidated BOOLEAN DEFAULT 0, importance_importance REAL, importance_surprise REAL, importance_emotion REAL, importance_utility REAL, encoding_context TEXT, summary TEXT NOT NULL DEFAULT '', recall_count INTEGER NOT NULL DEFAULT 0, last_accessed INTEGER NOT NULL DEFAULT 0, strength REAL NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'active');
    CREATE INDEX IF NOT EXISTS idx_episodes_timestamp ON episodes(timestamp);
    CREATE TABLE IF NOT EXISTS facts (id TEXT PRIMARY KEY, base_id TEXT NOT NULL, content TEXT NOT NULL, entities TEXT, topics TEXT, importance REAL, max_emotion REAL, strength REAL, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_accessed INTEGER NOT NULL, recall_count INTEGER DEFAULT 0, valid_from INTEGER NOT NULL, valid_to INTEGER, successor_id TEXT, supersedes TEXT, source_episodes TEXT, encoding_context TEXT, structured_fact TEXT);
    CREATE INDEX IF NOT EXISTS idx_facts_base_id ON facts(base_id);
    CREATE INDEX IF NOT EXISTS idx_facts_status ON facts(status);
    CREATE VIRTUAL TABLE IF NOT EXISTS facts_time_idx USING rtree(id, min_ts, max_ts);
    CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(content, entities, topics);
    CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts_hot USING fts5(content, entities, topics);
    CREATE TABLE IF NOT EXISTS id_map (fid INTEGER PRIMARY KEY, fact_id TEXT UNIQUE);
    CREATE TABLE IF NOT EXISTS epochs (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, start_time INTEGER NOT NULL, end_time INTEGER, source_episode_id TEXT);
    CREATE TABLE IF NOT EXISTS kg_nodes (name TEXT PRIMARY KEY, frequency INTEGER DEFAULT 1, last_seen INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS kg_edges (source TEXT NOT NULL, target TEXT NOT NULL, weight REAL DEFAULT 0.05, co_occurrences INTEGER NOT NULL DEFAULT 0, last_strengthened INTEGER NOT NULL, PRIMARY KEY (source, target));
    CREATE TABLE IF NOT EXISTS skills (id TEXT, name TEXT PRIMARY KEY, description TEXT NOT NULL DEFAULT '', learned_at INTEGER NOT NULL DEFAULT 0, usage_count INTEGER NOT NULL DEFAULT 0, success_count INTEGER NOT NULL DEFAULT 0, failure_count INTEGER NOT NULL DEFAULT 0, confidence REAL NOT NULL DEFAULT 0, last_used INTEGER);
    CREATE TABLE IF NOT EXISTS reflections (id TEXT PRIMARY KEY, task TEXT NOT NULL DEFAULT '', failure TEXT NOT NULL DEFAULT '', analysis TEXT NOT NULL DEFAULT '', correction TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', timestamp INTEGER NOT NULL, importance REAL);
    CREATE TABLE IF NOT EXISTS memory_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT OR IGNORE INTO memory_metadata (key, value) VALUES ('facts_generation', '0');
`;

function tableHasColumn(table: string, column: string): boolean {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>;
    return rows.some((row) => row.name === column);
}

function addColumnIfMissing(table: string, definition: string): void {
    const column = definition.trim().split(/\s+/, 1)[0];
    if (!tableHasColumn(table, column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
    }
}

function writeSchemaVersion(version: number): void {
    db.prepare(`
        INSERT INTO memory_metadata (key, value) VALUES ('schema_version', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(version));
}

function normalizeEntity(value: unknown): string {
    return String(value ?? "").toLowerCase().trim();
}

// LocalAdapter uses the untrimmed, lower-case association key while the
// knowledge graph itself normalizes entity names. Keep those two details
// separate so persisted associations remain compatible with Local.
function associationKey(entityA: unknown, entityB: unknown): string {
    const sorted = [String(entityA ?? "").toLowerCase(), String(entityB ?? "").toLowerCase()].sort();
    return `${sorted[0]}::${sorted[1]}`;
}

function readSchemaVersion(): number {
    const metadataObject = db.prepare(
        "SELECT type FROM sqlite_master WHERE name = 'memory_metadata'",
    ).get() as { type?: string } | undefined;
    if (metadataObject && metadataObject.type !== "table") {
        throw new Error("SQLite memory_metadata must be a table");
    }
    const versionRow = metadataObject
        ? db.prepare("SELECT value FROM memory_metadata WHERE key = 'schema_version'").get() as { value?: string } | undefined
        : undefined;
    const parsedVersion = Number(versionRow?.value ?? 0);
    const currentVersion = Number.isFinite(parsedVersion)
        ? Math.max(0, Math.trunc(parsedVersion))
        : 0;
    if (currentVersion > SCHEMA_VERSION) {
        throw new Error(`Unsupported SQLite schema version: ${currentVersion}`);
    }
    return currentVersion;
}

function parseEntityList(value: unknown): string[] {
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
    if (typeof value !== "string") return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.filter((item): item is string => typeof item === "string")
            : [];
    } catch {
        return [];
    }
}

function touchKnowledgeNode(name: string, now: number): void {
    db.prepare(`
        INSERT INTO kg_nodes (name, frequency, last_seen) VALUES (?, 1, ?)
        ON CONFLICT(name) DO UPDATE SET
            frequency = COALESCE(kg_nodes.frequency, 0) + 1,
            last_seen = excluded.last_seen
    `).run(name, now);
}

function strengthenKnowledgeEdge(entityA: unknown, entityB: unknown, boost: number, now: number): void {
    const a = normalizeEntity(entityA);
    const b = normalizeEntity(entityB);
    if (a === b) return;

    touchKnowledgeNode(a, now);
    touchKnowledgeNode(b, now);
    const [source, target] = a < b ? [a, b] : [b, a];
    const existing = db.prepare(
        "SELECT weight, co_occurrences FROM kg_edges WHERE source = ? AND target = ?",
    ).get(source, target) as { weight?: number; co_occurrences?: number } | undefined;
    if (existing) {
        const coOccurrences = Number(existing.co_occurrences ?? 0) + 1;
        const weight = Math.min(1, Number(existing.weight ?? 0.05) + boost / Math.sqrt(coOccurrences));
        db.prepare(
            "UPDATE kg_edges SET weight = ?, co_occurrences = ?, last_strengthened = ? WHERE source = ? AND target = ?",
        ).run(weight, coOccurrences, now, source, target);
    } else {
        db.prepare(
            "INSERT INTO kg_edges (source, target, weight, co_occurrences, last_strengthened) VALUES (?, ?, ?, 1, ?)",
        ).run(source, target, boost, now);
    }
}

function migrateProceduralState(): void {
    // The original SQLite schema only persisted a lossy skill counter and a
    // single reflection blob. Add the LocalAdapter fields in place so an
    // existing database can be reopened without replacing either table.
    addColumnIfMissing("skills", "id TEXT");
    addColumnIfMissing("skills", "learned_at INTEGER NOT NULL DEFAULT 0");
    addColumnIfMissing("skills", "failure_count INTEGER NOT NULL DEFAULT 0");
    addColumnIfMissing("skills", "confidence REAL NOT NULL DEFAULT 0");
    addColumnIfMissing("reflections", "task TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing("reflections", "failure TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing("reflections", "analysis TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing("reflections", "correction TEXT NOT NULL DEFAULT ''");

    db.exec("UPDATE skills SET id = 'legacy-skill:' || name WHERE id IS NULL OR id = ''");
    db.exec("UPDATE skills SET learned_at = COALESCE(last_used, 0) WHERE learned_at IS NULL OR learned_at = 0");
    db.exec(`
        UPDATE skills
        SET failure_count = CASE
            WHEN COALESCE(usage_count, 0) > COALESCE(success_count, 0)
            THEN COALESCE(usage_count, 0) - COALESCE(success_count, 0)
            ELSE 0
        END
        WHERE failure_count IS NULL OR failure_count = 0
    `);
    db.exec(`
        UPDATE skills
        SET confidence = CASE
            WHEN COALESCE(success_count, 0) + COALESCE(failure_count, 0) > 0
            THEN CAST(COALESCE(success_count, 0) AS REAL)
                / (COALESCE(success_count, 0) + COALESCE(failure_count, 0))
            ELSE 0
        END
        WHERE confidence IS NULL OR (confidence = 0 AND COALESCE(success_count, 0) > 0)
    `);
    // Preserve the old free-form reflection content when no structured
    // analysis was available. New writes use the structured columns below.
    db.exec("UPDATE reflections SET analysis = content WHERE analysis IS NULL OR analysis = ''");
}

function migrateSchemaBody(currentVersion: number): void {
        if (currentVersion < 1) {
            // These columns were absent from the original SQLite schema. The
            // defaults make ALTER TABLE safe for existing rows; the backfills
            // preserve the old episode timestamp/content semantics.
            addColumnIfMissing("episodes", "summary TEXT NOT NULL DEFAULT ''");
            addColumnIfMissing("episodes", "recall_count INTEGER NOT NULL DEFAULT 0");
            addColumnIfMissing("episodes", "last_accessed INTEGER NOT NULL DEFAULT 0");
            addColumnIfMissing("episodes", "strength REAL NOT NULL DEFAULT 1");
            addColumnIfMissing("episodes", "status TEXT NOT NULL DEFAULT 'active'");
            db.exec("UPDATE episodes SET summary = content WHERE summary IS NULL OR summary = ''");
            db.exec("UPDATE episodes SET last_accessed = timestamp WHERE last_accessed IS NULL OR last_accessed = 0");

            // Legacy edge co-occurrence history is unknowable. Start it at zero
            // rather than fabricating a count from the existing edge weight.
            addColumnIfMissing("kg_edges", "co_occurrences INTEGER NOT NULL DEFAULT 0");
            writeSchemaVersion(1);
        }

        if (currentVersion < 2) {
            // Keep table creation in the migration transaction so a failed
            // v2 migration cannot leave a partially upgraded database.
            const semanticObject = db.prepare(
                "SELECT type FROM sqlite_master WHERE name = 'semantic_associations'",
            ).get() as { type?: string } | undefined;
            if (semanticObject && semanticObject.type !== "table") {
                throw new Error("SQLite semantic_associations must be a table");
            }
            db.exec(`
                CREATE TABLE IF NOT EXISTS semantic_associations (
                    association_key TEXT PRIMARY KEY,
                    entity_a TEXT NOT NULL,
                    entity_b TEXT NOT NULL,
                    weight REAL NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_episodes_status ON episodes(status);
                CREATE INDEX IF NOT EXISTS idx_kg_nodes_frequency ON kg_nodes(frequency DESC);
                CREATE INDEX IF NOT EXISTS idx_kg_edges_source ON kg_edges(source);
                CREATE INDEX IF NOT EXISTS idx_kg_edges_target ON kg_edges(target);
            `);
            writeSchemaVersion(2);
        }

        if (currentVersion < 3) {
            // The procedural columns and their data backfills, including the
            // revision marker, must commit or roll back as one unit. This is
            // what makes learned_at=0 stable after a later outcome and reopen.
            migrateProceduralState();
            writeSchemaVersion(3);
        }
}

function migrateSchema(): void {
    const migrate = db.transaction(() => {
        migrateSchemaBody(readSchemaVersion());
    });
    withBusyRetry(() => migrate());
}

function initializeSchema(): void {
    const initialize = db.transaction(() => {
        // Read the version within every retry transaction. A failed attempt
        // can be retried after another connection commits the migration, so a
        // version captured outside this boundary would replay old backfills.
        // This read still precedes bootstrap DDL, keeping newer-schema refusal
        // before any initialization mutation.
        const currentVersion = readSchemaVersion();
        db.exec(BASE_SCHEMA_SQL);
        migrateSchemaBody(currentVersion);
    });
    // These connection settings are applied only after schema initialization
    // commits. journal_mode can itself write SQLite sidecar state, so its
    // retry must never re-enter a completed migration transaction.
    withBusyRetry(() => initialize());
    withBusyRetry(() => {
        db.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA cache_size = -64000;
        `);
    });
}

function bumpFactGeneration() {
    db.prepare(`INSERT INTO memory_metadata (key, value) VALUES ('facts_generation', '1')
        ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1`).run();
}

type BackupVectorRow = {
    factId: string;
    embedding: number[];
    hot: boolean;
};

type BackupSnapshot = {
    schemaVersion: number;
    factsGeneration: number;
    episodes: Array<Record<string, unknown>>;
    facts: Array<Record<string, unknown>>;
    epochs: Array<Record<string, unknown>>;
    skills: Array<Record<string, unknown>>;
    reflections: Array<Record<string, unknown>>;
    kgNodes: Array<Record<string, unknown>>;
    kgEdges: Array<Record<string, unknown>>;
    associations: Array<Record<string, unknown>>;
    vectors: {
        dimensions: number | null;
        embeddingSpaceId?: string;
        facts: BackupVectorRow[];
    };
};

type BackupTarget = {
    schemaVersion: number;
    schemaDimensions: number | null;
    embeddingDimensions: number | null;
    embeddingSpaceId?: string;
};

type BackupExport = {
    snapshot: BackupSnapshot;
    target: BackupTarget;
};

function vectorToNumbers(value: unknown): number[] {
    let numbers: number[];
    if (Array.isArray(value)) {
        numbers = value.slice() as number[];
    } else if (value instanceof ArrayBuffer) {
        if (value.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
            throw new Error("SQLite backup contains an invalid vector blob");
        }
        numbers = Array.from(new Float32Array(value.slice(0)));
    } else if (ArrayBuffer.isView(value)) {
        if (value.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
            throw new Error("SQLite backup contains an invalid vector blob");
        }
        const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        numbers = Array.from(new Float32Array(bytes.slice().buffer));
    } else {
        throw new Error("SQLite backup contains an invalid vector blob");
    }
    // Validate both the JSON number and the value SQLite will actually store.
    // A finite JavaScript number can overflow to Infinity when converted to
    // Float32, which would otherwise make an authenticated backup unusable
    // only after the replacement transaction has begun.
    if (
        numbers.length === 0
        || numbers.some((item) =>
            typeof item !== "number"
            || !Number.isFinite(item)
            || !Number.isFinite(Math.fround(item)))
    ) {
        throw new Error("SQLite backup contains a non-finite vector");
    }
    return numbers;
}

function metadataValue(key: string): string | undefined {
    const row = db.prepare("SELECT value FROM memory_metadata WHERE key = ?").get(key) as { value?: unknown } | undefined;
    return row?.value === undefined || row.value === null ? undefined : String(row.value);
}

function vecDimensions(): number | null {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'vec_facts'").get() as { sql?: unknown } | undefined;
    const match = String(row?.sql ?? "").match(/embedding\s+float\s*\[\s*(\d+)\s*\]/i);
    return match ? Number(match[1]) : null;
}

function backupTarget(): BackupTarget {
    const schemaVersion = Number(metadataValue("schema_version") ?? SCHEMA_VERSION);
    const dimensionsValue = metadataValue("embedding_dimensions");
    const dimensions = dimensionsValue === undefined ? null : Number(dimensionsValue);
    return {
        schemaVersion: Number.isFinite(schemaVersion) ? schemaVersion : SCHEMA_VERSION,
        schemaDimensions: vecDimensions(),
        embeddingDimensions: dimensionsValue === undefined || !Number.isFinite(dimensions) ? null : dimensions,
        ...(metadataValue("embedding_space_id") === undefined
            ? {}
            : { embeddingSpaceId: metadataValue("embedding_space_id") }),
    };
}

function sameBackupTarget(left: BackupTarget, right: BackupTarget): boolean {
    return left.schemaVersion === right.schemaVersion
        && left.schemaDimensions === right.schemaDimensions
        && left.embeddingDimensions === right.embeddingDimensions
        && left.embeddingSpaceId === right.embeddingSpaceId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireArray(value: unknown, name: string): asserts value is Array<Record<string, unknown>> {
    if (!Array.isArray(value) || value.some((row) => !isRecord(row))) {
        throw new Error(`SQLite backup ${name} must be an array of records`);
    }
}

function requireString(value: unknown, name: string, allowEmpty = false): asserts value is string {
    if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
        throw new Error(`SQLite backup ${name} must be a non-empty string`);
    }
}

function rawField(row: Record<string, unknown>, field: string, name: string): unknown {
    if (!Object.prototype.hasOwnProperty.call(row, field) || row[field] === undefined) {
        throw new Error(`SQLite backup ${name}.${field} is missing`);
    }
    return row[field];
}

function validateRawString(value: unknown, name: string, options: { allowEmpty?: boolean; nullable?: boolean } = {}): void {
    if (value === null && options.nullable) return;
    if (typeof value !== "string" || (options.allowEmpty !== true && value.length === 0)) {
        throw new Error(`SQLite backup ${name} must be a string`);
    }
}

function validateRawNumber(value: unknown, name: string, nullable = false): void {
    if (value === null && nullable) return;
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`SQLite backup ${name} must be a finite number`);
    }
}

function validateRawEnum(value: unknown, name: string, values: readonly string[], allowEmpty = false): void {
    validateRawString(value, name, { allowEmpty });
    if (value === "" && allowEmpty) return;
    if (!values.includes(value as string)) {
        throw new Error(`SQLite backup ${name} has an unsupported value`);
    }
}

function parseRawStringList(value: unknown, name: string): void {
    if (value === null || value === "") return;
    validateRawString(value, name, { allowEmpty: true });
    let parsed: unknown;
    try {
        parsed = JSON.parse(value as string);
    } catch {
        throw new Error(`SQLite backup ${name} is not valid JSON`);
    }
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
        throw new Error(`SQLite backup ${name} must be a JSON string array`);
    }
}

function parseRawEncodingContext(value: unknown, name: string): void {
    if (value === null || value === "") return;
    validateRawString(value, name, { allowEmpty: true });
    let parsed: unknown;
    try {
        parsed = JSON.parse(value as string);
    } catch {
        throw new Error(`SQLite backup ${name} is not valid JSON`);
    }
    if (!isRecord(parsed)) {
        throw new Error(`SQLite backup ${name} must be a JSON object`);
    }
    for (const key of ["project", "activeFile", "taskDescription", "sessionId", "category"]) {
        if (Object.prototype.hasOwnProperty.call(parsed, key) && typeof parsed[key] !== "string") {
            throw new Error(`SQLite backup ${name}.${key} must be a string`);
        }
    }
}

function parseRawStructuredFact(value: unknown, name: string): void {
    if (value === null || value === "null") return;
    validateRawString(value, name, { allowEmpty: true });
    let parsed: unknown;
    try {
        parsed = JSON.parse(value as string);
    } catch {
        throw new Error(`SQLite backup ${name} is not valid JSON`);
    }
    if (!isRecord(parsed)) {
        throw new Error(`SQLite backup ${name} must be a JSON object`);
    }
    for (const key of ["subject", "property", "value"]) {
        if (typeof parsed[key] !== "string") {
            throw new Error(`SQLite backup ${name}.${key} must be a string`);
        }
    }
    if (parsed.polarity !== "affirmed" && parsed.polarity !== "negated") {
        throw new Error(`SQLite backup ${name}.polarity is invalid`);
    }
    if (parsed.cardinality !== "single" && parsed.cardinality !== "multi") {
        throw new Error(`SQLite backup ${name}.cardinality is invalid`);
    }
    for (const key of ["subjectId", "propertyId"]) {
        if (parsed[key] !== undefined && typeof parsed[key] !== "string") {
            throw new Error(`SQLite backup ${name}.${key} must be a string`);
        }
    }
    if (
        parsed.provenance !== undefined
        && parsed.provenance !== "extractor"
        && parsed.provenance !== "caller"
        && parsed.provenance !== "heuristic"
    ) {
        throw new Error(`SQLite backup ${name}.provenance is invalid`);
    }
}

function validateRawRows(snapshot: BackupSnapshot): void {
    for (const [index, row] of snapshot.episodes.entries()) {
        const name = `episodes[${index}]`;
        validateRawString(rawField(row, "id", name), `${name}.id`, { allowEmpty: false });
        validateRawString(rawField(row, "content", name), `${name}.content`, { allowEmpty: true });
        validateRawNumber(rawField(row, "timestamp", name), `${name}.timestamp`);
        validateRawString(rawField(row, "role", name), `${name}.role`, { allowEmpty: true });
        validateRawNumber(rawField(row, "consolidated", name), `${name}.consolidated`, true);
        for (const field of [
            "importance_importance",
            "importance_surprise",
            "importance_emotion",
            "importance_utility",
        ]) {
            validateRawNumber(rawField(row, field, name), `${name}.${field}`, true);
        }
        parseRawEncodingContext(rawField(row, "encoding_context", name), `${name}.encoding_context`);
        validateRawString(rawField(row, "summary", name), `${name}.summary`, { allowEmpty: true });
        validateRawNumber(rawField(row, "recall_count", name), `${name}.recall_count`);
        validateRawNumber(rawField(row, "last_accessed", name), `${name}.last_accessed`);
        validateRawNumber(rawField(row, "strength", name), `${name}.strength`);
        validateRawString(rawField(row, "status", name), `${name}.status`, { allowEmpty: true });
        validateRawEnum(rawField(row, "role", name), `${name}.role`, ["user", "assistant", "tool"], true);
        validateRawEnum(rawField(row, "status", name), `${name}.status`, ["active", "archived"], true);
    }

    for (const [index, row] of snapshot.facts.entries()) {
        const name = `facts[${index}]`;
        validateRawString(rawField(row, "id", name), `${name}.id`, { allowEmpty: false });
        validateRawString(rawField(row, "base_id", name), `${name}.base_id`, { allowEmpty: true });
        validateRawString(rawField(row, "content", name), `${name}.content`, { allowEmpty: true });
        parseRawStringList(rawField(row, "entities", name), `${name}.entities`);
        parseRawStringList(rawField(row, "topics", name), `${name}.topics`);
        validateRawNumber(rawField(row, "importance", name), `${name}.importance`, true);
        validateRawNumber(rawField(row, "max_emotion", name), `${name}.max_emotion`, true);
        validateRawNumber(rawField(row, "strength", name), `${name}.strength`, true);
        validateRawEnum(rawField(row, "status", name), `${name}.status`, ["active", "superseded", "archived"]);
        for (const field of ["created_at", "updated_at", "last_accessed", "valid_from"]) {
            validateRawNumber(rawField(row, field, name), `${name}.${field}`);
        }
        validateRawNumber(rawField(row, "recall_count", name), `${name}.recall_count`, true);
        validateRawNumber(rawField(row, "valid_to", name), `${name}.valid_to`, true);
        for (const field of ["successor_id", "supersedes"]) {
            validateRawString(rawField(row, field, name), `${name}.${field}`, { allowEmpty: true, nullable: true });
        }
        parseRawStringList(rawField(row, "source_episodes", name), `${name}.source_episodes`);
        parseRawEncodingContext(rawField(row, "encoding_context", name), `${name}.encoding_context`);
        parseRawStructuredFact(rawField(row, "structured_fact", name), `${name}.structured_fact`);
    }

    for (const [index, row] of snapshot.epochs.entries()) {
        const name = `epochs[${index}]`;
        validateRawString(rawField(row, "id", name), `${name}.id`, { allowEmpty: false });
        validateRawString(rawField(row, "name", name), `${name}.name`, { allowEmpty: true });
        validateRawString(rawField(row, "description", name), `${name}.description`, { allowEmpty: true, nullable: true });
        validateRawNumber(rawField(row, "start_time", name), `${name}.start_time`);
        validateRawNumber(rawField(row, "end_time", name), `${name}.end_time`, true);
        validateRawString(rawField(row, "source_episode_id", name), `${name}.source_episode_id`, { allowEmpty: true, nullable: true });
    }

    for (const [index, row] of snapshot.skills.entries()) {
        const name = `skills[${index}]`;
        validateRawString(rawField(row, "id", name), `${name}.id`, { allowEmpty: true, nullable: true });
        validateRawString(rawField(row, "name", name), `${name}.name`, { allowEmpty: false });
        validateRawString(rawField(row, "description", name), `${name}.description`, { allowEmpty: true });
        for (const field of ["learned_at", "usage_count", "success_count", "failure_count", "confidence"]) {
            validateRawNumber(rawField(row, field, name), `${name}.${field}`);
        }
        validateRawNumber(rawField(row, "last_used", name), `${name}.last_used`, true);
    }

    for (const [index, row] of snapshot.reflections.entries()) {
        const name = `reflections[${index}]`;
        for (const field of ["id", "task", "failure", "analysis", "correction", "content"]) {
            validateRawString(rawField(row, field, name), `${name}.${field}`, { allowEmpty: true });
        }
        validateRawNumber(rawField(row, "timestamp", name), `${name}.timestamp`);
        validateRawNumber(rawField(row, "importance", name), `${name}.importance`, true);
    }

    for (const [index, row] of snapshot.kgNodes.entries()) {
        const name = `kgNodes[${index}]`;
        validateRawString(rawField(row, "name", name), `${name}.name`, { allowEmpty: false });
        validateRawNumber(rawField(row, "frequency", name), `${name}.frequency`, true);
        validateRawNumber(rawField(row, "last_seen", name), `${name}.last_seen`);
    }
    for (const [index, row] of snapshot.kgEdges.entries()) {
        const name = `kgEdges[${index}]`;
        validateRawString(rawField(row, "source", name), `${name}.source`, { allowEmpty: false });
        validateRawString(rawField(row, "target", name), `${name}.target`, { allowEmpty: false });
        validateRawNumber(rawField(row, "weight", name), `${name}.weight`, true);
        validateRawNumber(rawField(row, "co_occurrences", name), `${name}.co_occurrences`);
        validateRawNumber(rawField(row, "last_strengthened", name), `${name}.last_strengthened`);
    }
    for (const [index, row] of snapshot.associations.entries()) {
        const name = `associations[${index}]`;
        validateRawString(rawField(row, "association_key", name), `${name}.association_key`, { allowEmpty: false });
        validateRawString(rawField(row, "entity_a", name), `${name}.entity_a`, { allowEmpty: true });
        validateRawString(rawField(row, "entity_b", name), `${name}.entity_b`, { allowEmpty: true });
        validateRawNumber(rawField(row, "weight", name), `${name}.weight`);
    }
}

function validateUnique(rows: Array<Record<string, unknown>>, field: string, name: string): Set<string> {
    const seen = new Set<string>();
    for (const row of rows) {
        requireString(row[field], `${name}.${field}`);
        const value = row[field] as string;
        if (seen.has(value)) throw new Error(`SQLite backup contains duplicate ${name} key: ${value}`);
        seen.add(value);
    }
    return seen;
}

function validateBackupSnapshot(snapshot: BackupSnapshot): void {
    if (!isRecord(snapshot) || snapshot.schemaVersion !== SCHEMA_VERSION) {
        throw new Error(`SQLite backup schema version must be ${SCHEMA_VERSION}`);
    }
    if (!Number.isSafeInteger(snapshot.factsGeneration) || snapshot.factsGeneration < 0) {
        throw new Error("SQLite backup facts generation is invalid");
    }
    requireArray(snapshot.episodes, "episodes");
    requireArray(snapshot.facts, "facts");
    requireArray(snapshot.epochs, "epochs");
    requireArray(snapshot.skills, "skills");
    requireArray(snapshot.reflections, "reflections");
    requireArray(snapshot.kgNodes, "kgNodes");
    requireArray(snapshot.kgEdges, "kgEdges");
    requireArray(snapshot.associations, "associations");
    if (!isRecord(snapshot.vectors) || !Array.isArray(snapshot.vectors.facts)) {
        throw new Error("SQLite backup vectors are invalid");
    }
    validateRawRows(snapshot);
    validateUnique(snapshot.episodes, "id", "episode");
    const factIds = validateUnique(snapshot.facts, "id", "fact");
    validateUnique(snapshot.epochs, "id", "epoch");
    validateUnique(snapshot.skills, "name", "skill");
    validateUnique(snapshot.reflections, "id", "reflection");
    const nodeNames = validateUnique(snapshot.kgNodes, "name", "knowledge-graph node");
    const edgeKeys = new Set<string>();
    for (const row of snapshot.kgEdges) {
        requireString(row.source, "knowledge-graph edge.source");
        requireString(row.target, "knowledge-graph edge.target");
        if (!nodeNames.has(row.source as string) || !nodeNames.has(row.target as string)) {
            throw new Error("SQLite backup knowledge-graph edge references an unknown node");
        }
        const key = `${row.source}\u0000${row.target}`;
        if (edgeKeys.has(key)) throw new Error("SQLite backup contains duplicate knowledge-graph edge");
        edgeKeys.add(key);
    }
    validateUnique(snapshot.associations, "association_key", "association");

    const dimensions = snapshot.vectors.dimensions;
    if (dimensions !== null && (!Number.isSafeInteger(dimensions) || dimensions <= 0)) {
        throw new Error("SQLite backup vector dimensions are invalid");
    }
    if (snapshot.vectors.embeddingSpaceId !== undefined) {
        requireString(snapshot.vectors.embeddingSpaceId, "vectors.embeddingSpaceId");
    }
    if ((dimensions === null) !== (snapshot.vectors.embeddingSpaceId === undefined)) {
        throw new Error("SQLite backup vector identity is incomplete");
    }
    const vectorIds = new Set<string>();
    let vectorDimensions: number | null = null;
    for (const [index, vector] of snapshot.vectors.facts.entries()) {
        if (!isRecord(vector)) throw new Error("SQLite backup vector row is invalid");
        if (!Object.prototype.hasOwnProperty.call(vector, "factId") || vector.factId === undefined) {
            throw new Error(`SQLite backup vectors[${index}].factId is missing`);
        }
        if (!Object.prototype.hasOwnProperty.call(vector, "embedding") || vector.embedding === undefined) {
            throw new Error(`SQLite backup vectors[${index}].embedding is missing`);
        }
        if (!Object.prototype.hasOwnProperty.call(vector, "hot") || vector.hot === undefined) {
            throw new Error(`SQLite backup vectors[${index}].hot is missing`);
        }
        requireString(vector.factId, "vector.factId");
        if (vectorIds.has(vector.factId as string)) {
            throw new Error(`SQLite backup contains duplicate vector: ${vector.factId}`);
        }
        vectorIds.add(vector.factId as string);
        if (!factIds.has(vector.factId as string)) {
            throw new Error(`SQLite backup vector references unknown fact: ${vector.factId}`);
        }
        if (typeof vector.hot !== "boolean") throw new Error("SQLite backup vector hot flag is invalid");
        const values = vectorToNumbers(vector.embedding);
        if (vectorDimensions === null) vectorDimensions = values.length;
        if (vectorDimensions !== values.length) throw new Error("SQLite backup vectors have mismatched dimensions");
        if (dimensions !== null && dimensions !== values.length) throw new Error("SQLite backup vector dimensions do not match identity");
    }
    if (snapshot.vectors.facts.length > 0 && dimensions === null) {
        throw new Error("SQLite backup vectors are missing dimensions");
    }
}

function normalizeBackupSnapshot(snapshot: BackupSnapshot): BackupSnapshot {
    validateBackupSnapshot(snapshot);
    return {
        ...snapshot,
        vectors: {
            ...snapshot.vectors,
            facts: snapshot.vectors.facts.map((vector) => ({
                ...vector,
                embedding: vectorToNumbers(vector.embedding),
            })),
        },
    };
}

function backupSnapshot(): BackupExport {
    const read = db.transaction(() => {
        const episodes = db.prepare(`
            SELECT id, content, timestamp, role, consolidated,
                importance_importance, importance_surprise, importance_emotion,
                importance_utility, encoding_context, summary, recall_count,
                last_accessed, strength, status
            FROM episodes ORDER BY id
        `).all() as Array<Record<string, unknown>>;
        const facts = db.prepare(`
            SELECT id, base_id, content, entities, topics, importance, max_emotion,
                strength, status, created_at, updated_at, last_accessed, recall_count,
                valid_from, valid_to, successor_id, supersedes, source_episodes,
                encoding_context, structured_fact
            FROM facts ORDER BY id
        `).all() as Array<Record<string, unknown>>;
        const epochs = db.prepare(`
            SELECT id, name, description, start_time, end_time, source_episode_id
            FROM epochs ORDER BY id
        `).all() as Array<Record<string, unknown>>;
        const skills = db.prepare(`
            SELECT id, name, description, learned_at, usage_count, success_count,
                failure_count, confidence, last_used
            FROM skills ORDER BY name
        `).all() as Array<Record<string, unknown>>;
        const reflections = db.prepare(`
            SELECT id, task, failure, analysis, correction, content, timestamp, importance
            FROM reflections ORDER BY id
        `).all() as Array<Record<string, unknown>>;
        const kgNodes = db.prepare(
            "SELECT name, frequency, last_seen FROM kg_nodes ORDER BY name",
        ).all() as Array<Record<string, unknown>>;
        const kgEdges = db.prepare(
            "SELECT source, target, weight, co_occurrences, last_strengthened FROM kg_edges ORDER BY source, target",
        ).all() as Array<Record<string, unknown>>;
        const associations = db.prepare(`
            SELECT association_key, entity_a, entity_b, weight
            FROM semantic_associations ORDER BY association_key
        `).all() as Array<Record<string, unknown>>;
        const coldVectors = db.prepare(
            "SELECT fact_id, embedding FROM vec_facts ORDER BY fact_id",
        ).all() as Array<{ fact_id: string; embedding: unknown }>;
        const hotIds = new Set(
            (db.prepare("SELECT fact_id FROM vec_facts_hot ORDER BY fact_id").all() as Array<{ fact_id: string }>)
                .map((row) => String(row.fact_id)),
        );
        const vectors = coldVectors.map((row) => ({
            factId: String(row.fact_id),
            embedding: vectorToNumbers(row.embedding),
            hot: hotIds.has(String(row.fact_id)),
        }));
        const dimensionsValue = metadataValue("embedding_dimensions");
        const dimensions = dimensionsValue === undefined
            ? (vectors[0]?.embedding.length ?? null)
            : Number(dimensionsValue);
        const generation = Number(metadataValue("facts_generation") ?? 0);
        const snapshot = {
            schemaVersion: Number(metadataValue("schema_version") ?? SCHEMA_VERSION),
            factsGeneration: Number.isFinite(generation) ? generation : 0,
            episodes,
            facts,
            epochs,
            skills,
            reflections,
            kgNodes,
            kgEdges,
            associations,
            vectors: {
                dimensions: Number.isFinite(dimensions) ? dimensions : null,
                embeddingSpaceId: metadataValue("embedding_space_id"),
                facts: vectors,
            },
        } satisfies BackupSnapshot;
        return { snapshot, target: backupTarget() } satisfies BackupExport;
    });
    return withBusyRetry(() => read());
}

function nullable(value: unknown): unknown {
    return value === undefined ? null : value;
}

function backupFault(payload: any, stage: string): void {
    if (payload?.faultAfter === stage) {
        throw new Error("SQLite backup test fault injection");
    }
}

function replaceBackup(payload: { snapshot: BackupSnapshot; faultAfter?: string; expectedTarget?: BackupTarget }): void {
    const snapshot = normalizeBackupSnapshot(payload.snapshot);
    const replace = db.transaction((p: { snapshot: BackupSnapshot; faultAfter?: string; expectedTarget?: BackupTarget }) => {
        const currentTarget = backupTarget();
        if (p.expectedTarget && !sameBackupTarget(currentTarget, p.expectedTarget)) {
            throw new Error("SQLite backup target changed before commit");
        }
        const currentGeneration = Number(metadataValue("facts_generation") ?? 0);

        // All durable tables and all derived indexes are replaced in this one
        // immediate transaction. A fault at any stage therefore rolls back the
        // complete database, including the RTree, FTS, vectors, and graph.
        db.exec(`
            DELETE FROM episodes;
            DELETE FROM facts;
            DELETE FROM facts_time_idx;
            DELETE FROM facts_fts;
            DELETE FROM facts_fts_hot;
            DELETE FROM id_map;
            DELETE FROM epochs;
            DELETE FROM skills;
            DELETE FROM reflections;
            DELETE FROM kg_nodes;
            DELETE FROM kg_edges;
            DELETE FROM semantic_associations;
            DELETE FROM vec_facts;
            DELETE FROM vec_facts_hot;
        `);
        backupFault(p, "after-clear");

        const insertEpisode = db.prepare(`
            INSERT INTO episodes (
                id, content, timestamp, role, consolidated,
                importance_importance, importance_surprise, importance_emotion,
                importance_utility, encoding_context, summary, recall_count,
                last_accessed, strength, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of snapshot.episodes) {
            insertEpisode.run(
                nullable(row.id), nullable(row.content), nullable(row.timestamp),
                nullable(row.role), nullable(row.consolidated),
                nullable(row.importance_importance), nullable(row.importance_surprise),
                nullable(row.importance_emotion), nullable(row.importance_utility),
                nullable(row.encoding_context), nullable(row.summary),
                nullable(row.recall_count), nullable(row.last_accessed),
                nullable(row.strength), nullable(row.status),
            );
        }

        const insertFact = db.prepare(`
            INSERT INTO facts (
                id, base_id, content, entities, topics, importance, max_emotion,
                strength, status, created_at, updated_at, last_accessed, recall_count,
                valid_from, valid_to, successor_id, supersedes, source_episodes,
                encoding_context, structured_fact
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const sortedFacts = [...snapshot.facts].sort((a, b) => String(a.id).localeCompare(String(b.id)));
        for (const row of sortedFacts) {
            insertFact.run(
                nullable(row.id), nullable(row.base_id), nullable(row.content),
                nullable(row.entities), nullable(row.topics), nullable(row.importance),
                nullable(row.max_emotion), nullable(row.strength), nullable(row.status),
                nullable(row.created_at), nullable(row.updated_at), nullable(row.last_accessed),
                nullable(row.recall_count), nullable(row.valid_from), nullable(row.valid_to),
                nullable(row.successor_id), nullable(row.supersedes), nullable(row.source_episodes),
                nullable(row.encoding_context), nullable(row.structured_fact),
            );
        }
        backupFault(p, "after-facts");

        const insertEpoch = db.prepare(`
            INSERT INTO epochs (id, name, description, start_time, end_time, source_episode_id)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const row of snapshot.epochs) {
            insertEpoch.run(
                nullable(row.id), nullable(row.name), nullable(row.description),
                nullable(row.start_time), nullable(row.end_time), nullable(row.source_episode_id),
            );
        }
        const insertSkill = db.prepare(`
            INSERT INTO skills (
                id, name, description, learned_at, usage_count, success_count,
                failure_count, confidence, last_used
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of snapshot.skills) {
            insertSkill.run(
                nullable(row.id), nullable(row.name), nullable(row.description),
                nullable(row.learned_at), nullable(row.usage_count), nullable(row.success_count),
                nullable(row.failure_count), nullable(row.confidence), nullable(row.last_used),
            );
        }
        const insertReflection = db.prepare(`
            INSERT INTO reflections (
                id, task, failure, analysis, correction, content, timestamp, importance
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of snapshot.reflections) {
            insertReflection.run(
                nullable(row.id), nullable(row.task), nullable(row.failure),
                nullable(row.analysis), nullable(row.correction), nullable(row.content),
                nullable(row.timestamp), nullable(row.importance),
            );
        }
        backupFault(p, "after-procedural");

        const insertNode = db.prepare(
            "INSERT INTO kg_nodes (name, frequency, last_seen) VALUES (?, ?, ?)",
        );
        for (const row of snapshot.kgNodes) {
            insertNode.run(nullable(row.name), nullable(row.frequency), nullable(row.last_seen));
        }
        const insertEdge = db.prepare(
            "INSERT INTO kg_edges (source, target, weight, co_occurrences, last_strengthened) VALUES (?, ?, ?, ?, ?)",
        );
        for (const row of snapshot.kgEdges) {
            insertEdge.run(
                nullable(row.source), nullable(row.target), nullable(row.weight),
                nullable(row.co_occurrences), nullable(row.last_strengthened),
            );
        }
        const insertAssociation = db.prepare(`
            INSERT INTO semantic_associations (association_key, entity_a, entity_b, weight)
            VALUES (?, ?, ?, ?)
        `);
        for (const row of snapshot.associations) {
            insertAssociation.run(
                nullable(row.association_key), nullable(row.entity_a), nullable(row.entity_b),
                nullable(row.weight),
            );
        }
        backupFault(p, "after-graph");

        const insertMap = db.prepare("INSERT INTO id_map (fid, fact_id) VALUES (?, ?)");
        const insertTime = db.prepare(
            "INSERT INTO facts_time_idx (id, min_ts, max_ts) VALUES (?, ?, ?)",
        );
        const insertFts = db.prepare(
            "INSERT INTO facts_fts (rowid, content, entities, topics) VALUES (?, ?, ?, ?)",
        );
        const insertHotFts = db.prepare(
            "INSERT INTO facts_fts_hot (rowid, content, entities, topics) VALUES (?, ?, ?, ?)",
        );
        const mappedFacts = new Map<string, number>();
        const factById = new Map(sortedFacts.map((row) => [String(row.id), row]));
        sortedFacts.forEach((row, index) => {
            const factId = String(row.id);
            const fid = index + 1;
            mappedFacts.set(factId, fid);
            insertMap.run(fid, factId);
            const minTs = Number(row.valid_from ?? row.created_at ?? 0);
            const maxTs = Number(row.valid_to ?? 253402300799000);
            insertTime.run(fid, minTs, maxTs);
            const entities = parseEntityList(row.entities);
            const topics = parseEntityList(row.topics);
            const content = String(row.content ?? "");
            insertFts.run(fid, content, entities.join(" "), topics.join(" "));
            if (String(row.status ?? "active") === "active" && Number(row.strength ?? 0) > 0.6) {
                insertHotFts.run(fid, content, entities.join(" "), topics.join(" "));
            }
        });
        backupFault(p, "after-indexes");

        const insertVector = db.prepare("INSERT INTO vec_facts (fact_id, embedding) VALUES (?, ?)");
        const insertHotVector = db.prepare("INSERT INTO vec_facts_hot (fact_id, embedding) VALUES (?, ?)");
        for (const vector of snapshot.vectors.facts) {
            if (!mappedFacts.has(vector.factId) || !factById.has(vector.factId)) {
                throw new Error(`SQLite backup vector references unknown fact: ${vector.factId}`);
            }
            const blob = Buffer.from(new Float32Array(vector.embedding).buffer);
            insertVector.run(vector.factId, blob);
            const fact = factById.get(vector.factId);
            const hot = String(fact?.status ?? "active") === "active" && Number(fact?.strength ?? 0) > 0.6;
            if (hot) insertHotVector.run(vector.factId, blob);
        }
        backupFault(p, "after-vectors");

        const nextGeneration = Number.isFinite(currentGeneration) ? currentGeneration + 1 : 1;
        db.prepare("INSERT OR REPLACE INTO memory_metadata (key, value) VALUES ('facts_generation', ?)").run(String(nextGeneration));
        if (snapshot.vectors.dimensions !== null) {
            db.prepare("INSERT OR REPLACE INTO memory_metadata (key, value) VALUES ('embedding_dimensions', ?)").run(String(snapshot.vectors.dimensions));
        }
        if (snapshot.vectors.embeddingSpaceId !== undefined) {
            db.prepare("INSERT OR REPLACE INTO memory_metadata (key, value) VALUES ('embedding_space_id', ?)").run(snapshot.vectors.embeddingSpaceId);
        }
        backupFault(p, "after-metadata");
    });
    withBusyRetry(() => replace.immediate({ ...payload, snapshot }));
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
            case "search-exact-vectors": {
                const rowSource = () => db.prepare(payload.sql).iterate(...payload.params) as Iterable<ExactVectorRow>;
                result = exactVectorTopN(rowSource, payload.query, payload.limit);
                break;
            }
            case "prepare-get":
                result = db.prepare(payload.sql).get(...payload.params);
                break;
            case "prepare-run":
                result = db.prepare(payload.sql).run(...payload.params);
                break;
            case "backup-snapshot":
                result = backupSnapshot();
                break;
            case "backup-target":
                result = backupTarget();
                break;
            case "replace-backup":
                replaceBackup(payload);
                result = true;
                break;
            case "transaction":
                // Execute a series of prepared statements in a transaction
                const tx = db.transaction((ops: any[]) => {
                    for (const op of ops) {
                        db.prepare(op.sql).run(...op.params);
                    }
                });
                result = withBusyRetry(() => tx(payload.ops));
                break;
            case "migrate-schema":
                migrateSchema();
                result = true;
                break;
            case "initialize-schema":
                initializeSchema();
                result = true;
                break;
            case "store-episode": {
                const tx = db.transaction((p: any) => {
                    db.prepare(`
                        INSERT INTO episodes (
                            id, content, timestamp, role, consolidated,
                            importance_importance, importance_surprise,
                            importance_emotion, importance_utility,
                            encoding_context, summary, recall_count,
                            last_accessed, strength, status
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(id) DO UPDATE SET
                            content = excluded.content,
                            timestamp = excluded.timestamp,
                            role = excluded.role,
                            consolidated = excluded.consolidated,
                            importance_importance = excluded.importance_importance,
                            importance_surprise = excluded.importance_surprise,
                            importance_emotion = excluded.importance_emotion,
                            importance_utility = excluded.importance_utility,
                            encoding_context = excluded.encoding_context,
                            summary = excluded.summary,
                            recall_count = excluded.recall_count,
                            last_accessed = excluded.last_accessed,
                            strength = excluded.strength,
                            status = excluded.status
                    `).run(
                        p.id,
                        p.content,
                        p.timestamp,
                        p.role,
                        p.consolidated,
                        p.importanceImportance,
                        p.importanceSurprise,
                        p.importanceEmotion,
                        p.importanceUtility,
                        p.encodingContext,
                        p.summary,
                        p.recallCount,
                        p.lastAccessed,
                        p.strength,
                        p.status,
                    );
                });
                result = withBusyRetry(() => tx(payload));
                break;
            }
            case "recall-episodes": {
                const tx = db.transaction((p: any) => {
                    const now = Number(p.now);
                    const select = db.prepare("SELECT * FROM episodes WHERE id = ?");
                    const update = db.prepare(
                        "UPDATE episodes SET recall_count = ?, last_accessed = ?, strength = ? WHERE id = ?",
                    );
                    const updated: any[] = [];
                    for (const id of Array.isArray(p.ids) ? p.ids : []) {
                        const current = select.get(id) as any | undefined;
                        if (!current) continue;
                        const recallCount = Number(current.recall_count ?? 0) + 1;
                        const strength = calculateStrength(
                            Number(current.importance_utility ?? 0),
                            Number(current.timestamp ?? now),
                            recallCount,
                            now,
                            now,
                        );
                        update.run(recallCount, now, strength, id);
                        const row = select.get(id);
                        if (row) updated.push(row);
                    }
                    return updated;
                });
                // Acquire the write lock before the existence read. A
                // deferred transaction would let two workers hold shared
                // locks and then both fail while upgrading to a writer.
                result = withBusyRetry(() => tx.immediate(payload));
                break;
            }
            case "record-outcome": {
                const tx = db.transaction((p: any) => {
                    const name = String(p.name);
                    const now = Number(p.now ?? Date.now());
                    const successIncrement = p.success ? 1 : 0;
                    const failureIncrement = p.success ? 0 : 1;
                    const existing = db.prepare(
                        "SELECT name FROM skills WHERE name = ?",
                    ).get(name);
                    if (existing) {
                        // SQLite evaluates all RHS expressions against the
                        // pre-update row, so the confidence formula includes
                        // this outcome while the entire update remains one
                        // atomic write under concurrent workers.
                        db.prepare(`
                            UPDATE skills
                            SET success_count = COALESCE(success_count, 0) + ?,
                                failure_count = COALESCE(failure_count, 0) + ?,
                                usage_count = COALESCE(usage_count, 0) + 1,
                                last_used = ?,
                                confidence = CAST(COALESCE(success_count, 0) + ? AS REAL)
                                    / (COALESCE(success_count, 0) + COALESCE(failure_count, 0) + 1)
                            WHERE name = ?
                        `).run(
                            successIncrement,
                            failureIncrement,
                            now,
                            successIncrement,
                            name,
                        );
                    } else {
                        db.prepare(`
                            INSERT INTO skills (
                                id, name, description, learned_at, usage_count,
                                success_count, failure_count, confidence, last_used
                            ) VALUES (?, ?, '', ?, 1, ?, ?, ?, ?)
                        `).run(
                            randomUUID(),
                            name,
                            now,
                            successIncrement,
                            failureIncrement,
                            p.success ? 1 : 0,
                            now,
                        );
                    }
                });
                // Acquire the write lock before the existence read. A
                // deferred transaction would let two workers hold shared
                // locks and then both fail while upgrading to a writer.
                result = withBusyRetry(() => tx.immediate(payload));
                break;
            }
            case "insert-reflection": {
                const tx = db.transaction((p: any) => {
                    const analysis = String(p.analysis ?? "");
                    db.prepare(`
                        INSERT INTO reflections (
                            id, task, failure, analysis, correction, content,
                            timestamp, importance
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(
                        randomUUID(),
                        String(p.task ?? ""),
                        String(p.failure ?? ""),
                        analysis,
                        String(p.correction ?? ""),
                        analysis,
                        Number(p.timestamp ?? Date.now()),
                        p.importance ?? null,
                    );
                });
                result = withBusyRetry(() => tx(payload));
                break;
            }
            case "upsert-epoch": {
                // LocalAdapter replaces the first epoch matching either id or
                // name. Keep the lookup and write in one worker transaction so
                // concurrent callers cannot observe a half-updated epoch.
                const tx = db.transaction((p: any) => {
                    const existing = db.prepare(
                        "SELECT id FROM epochs WHERE id = ? OR name = ? ORDER BY rowid LIMIT 1",
                    ).get(p.id, p.name) as { id?: string } | undefined;
                    if (existing?.id) {
                        db.prepare(
                            "UPDATE epochs SET id = ?, name = ?, description = ?, start_time = ?, end_time = ?, source_episode_id = ? WHERE id = ?",
                        ).run(
                            p.id,
                            p.name,
                            p.description,
                            p.start,
                            p.end,
                            p.sourceEpisodeId,
                            existing.id,
                        );
                    } else {
                        db.prepare(
                            "INSERT INTO epochs (id, name, description, start_time, end_time, source_episode_id) VALUES (?, ?, ?, ?, ?, ?)",
                        ).run(p.id, p.name, p.description, p.start, p.end, p.sourceEpisodeId);
                    }
                });
                result = withBusyRetry(() => tx(payload));
                break;
            }
            case "upsert-facts": {
                const tx = db.transaction((facts: any[]) => {
                    const getMappedId = db.prepare("SELECT fid FROM id_map WHERE fact_id = ?");
                    const getExistingFact = db.prepare("SELECT entities FROM facts WHERE id = ?");
                    const getNextId = db.prepare("SELECT COALESCE(MAX(fid), 0) + 1 AS fid FROM id_map");
                    const upsertId = db.prepare("INSERT OR REPLACE INTO id_map (fid, fact_id) VALUES (?, ?)");
                    const upsertTime = db.prepare("INSERT OR REPLACE INTO facts_time_idx (id, min_ts, max_ts) VALUES (?, ?, ?)");
                    const deleteFts = ["facts_fts", "facts_fts_hot"].map((table) => db.prepare(`DELETE FROM ${table} WHERE rowid = ?`));
                    const deleteVectors = ["vec_facts", "vec_facts_hot"].map((table) => db.prepare(`DELETE FROM ${table} WHERE fact_id = ?`));
                    const insertFts = db.prepare("INSERT INTO facts_fts (rowid, content, entities, topics) VALUES (?, ?, ?, ?)");
                    const insertHotFts = db.prepare("INSERT INTO facts_fts_hot (rowid, content, entities, topics) VALUES (?, ?, ?, ?)");
                    const insertVector = db.prepare("INSERT INTO vec_facts (fact_id, embedding) VALUES (?, ?)");
                    const insertHotVector = db.prepare("INSERT INTO vec_facts_hot (fact_id, embedding) VALUES (?, ?)");
                    const now = Date.now();
                    for (const p of facts) {
                        const previous = getMappedId.get(p.factId) as { fid?: number } | undefined;
                        const priorFact = getExistingFact.get(p.factId) as { entities?: string } | undefined;
                        const fid = previous?.fid ?? Number((getNextId.get() as { fid: number }).fid);
                        // Local keeps the union of entities across updates. A
                        // new fact preserves incoming duplicates because those
                        // occurrences contribute to KG frequency/co-occurrence.
                        const incomingEntities = parseEntityList(p.kgEntities);
                        const previousEntities = parseEntityList(priorFact?.entities);
                        const entities = priorFact
                            ? [...new Set([...previousEntities, ...incomingEntities])]
                            : incomingEntities;
                        const factParams = [...p.factParams];
                        factParams[3] = JSON.stringify(entities);
                        db.prepare(p.factSql).run(...factParams);
                        upsertId.run(fid, p.factId);
                        upsertTime.run(fid, p.minTs, p.maxTs);
                        for (const statement of deleteFts) statement.run(fid);
                        for (const statement of deleteVectors) statement.run(p.factId);
                        insertFts.run(fid, p.content, entities.join(" "), p.topics);
                        if (p.hot) insertHotFts.run(fid, p.content, entities.join(" "), p.topics);
                        if (p.vector) {
                            insertVector.run(p.factId, p.vector);
                            if (p.hot) insertHotVector.run(p.factId, p.vector);
                        }

                        // Match Local's entity touch semantics: an update
                        // contributes both its previous and incoming entities,
                        // while the graph normalizes names for persistence.
                        for (const entity of entities) touchKnowledgeNode(normalizeEntity(entity), now);
                        for (let i = 0; i < entities.length; i += 1) {
                            for (let j = i + 1; j < entities.length; j += 1) {
                                strengthenKnowledgeEdge(entities[i], entities[j], 0.05, now);
                            }
                        }
                        bumpFactGeneration();
                    }
                });
                result = withBusyRetry(() => tx(payload.facts));
                break;
            }
            case "associate": {
                const tx = db.transaction((p: any) => {
                    const key = associationKey(p.entityA, p.entityB);
                    const existing = db.prepare(
                        "SELECT weight FROM semantic_associations WHERE association_key = ?",
                    ).get(key) as { weight?: number } | undefined;
                    if (existing) {
                        db.prepare(
                            "UPDATE semantic_associations SET weight = ? WHERE association_key = ?",
                        ).run(Math.min(1, Number(existing.weight ?? 0) + p.weight), key);
                    } else {
                        db.prepare(
                            "INSERT INTO semantic_associations (association_key, entity_a, entity_b, weight) VALUES (?, ?, ?, ?)",
                        ).run(key, String(p.entityA ?? ""), String(p.entityB ?? ""), Math.min(1, Number(p.weight ?? 0)));
                    }
                    strengthenKnowledgeEdge(p.entityA, p.entityB, p.weight, Date.now());
                });
                result = withBusyRetry(() => tx(payload));
                break;
            }
            case "read-kg": {
                const nodes = db.prepare(
                    "SELECT name, frequency, last_seen AS lastSeen FROM kg_nodes ORDER BY name",
                ).all() as Array<{ name: string; frequency: number; lastSeen: number }>;
                const edges = db.prepare(
                    "SELECT source, target, weight, co_occurrences AS coOccurrences FROM kg_edges ORDER BY source, target",
                ).all() as Array<{ source: string; target: string; weight: number; coOccurrences: number }>;
                result = {
                    nodes: Object.fromEntries(nodes.map((node) => [node.name, {
                        name: node.name,
                        frequency: Number(node.frequency ?? 0),
                        lastSeen: Number(node.lastSeen ?? 0),
                    }])),
                    edges: Object.fromEntries(edges.map((edge) => [`${edge.source}::${edge.target}`, {
                        from: edge.source,
                        to: edge.target,
                        weight: Number(edge.weight ?? 0),
                        coOccurrences: Number(edge.coOccurrences ?? 0),
                    }])),
                };
                break;
            }
            case "decay": {
                // Keep the complete lifecycle sweep in one immediate worker
                // transaction. Recomputing strength, changing active rows to
                // archived, refreshing hot indexes, and decaying both graph
                // stores must be observed as one durable state transition.
                const tx = db.transaction((p: { now: number }) => {
                    const now = Number(p.now);
                    const facts = db.prepare(
                        "SELECT id, importance, created_at, recall_count, last_accessed, strength, status FROM facts",
                    ).all() as Array<Record<string, unknown>>;
                    const episodes = db.prepare(
                        "SELECT id, importance_utility, timestamp, recall_count, last_accessed, consolidated, strength, status FROM episodes",
                    ).all() as Array<Record<string, unknown>>;
                    const updateFact = db.prepare(
                        "UPDATE facts SET strength = ?, status = ? WHERE id = ?",
                    );
                    const updateEpisode = db.prepare(
                        "UPDATE episodes SET strength = ?, status = ? WHERE id = ?",
                    );
                    const mappedFact = db.prepare(
                        "SELECT fid FROM id_map WHERE fact_id = ?",
                    );
                    const fullFts = db.prepare(
                        "SELECT content, entities, topics FROM facts_fts WHERE rowid = ?",
                    );
                    const fullVector = db.prepare(
                        "SELECT embedding FROM vec_facts WHERE fact_id = ?",
                    );
                    const deleteHotFts = db.prepare(
                        "DELETE FROM facts_fts_hot WHERE rowid = ?",
                    );
                    const insertHotFts = db.prepare(
                        "INSERT INTO facts_fts_hot (rowid, content, entities, topics) VALUES (?, ?, ?, ?)",
                    );
                    const deleteHotVector = db.prepare(
                        "DELETE FROM vec_facts_hot WHERE fact_id = ?",
                    );
                    const insertHotVector = db.prepare(
                        "INSERT INTO vec_facts_hot (fact_id, embedding) VALUES (?, ?)",
                    );
                    let factsArchived = 0;
                    let episodesArchived = 0;
                    let factsUpdated = 0;
                    let episodesUpdated = 0;

                    for (const fact of facts) {
                        const id = String(fact.id);
                        const strength = calculateStrength(
                            Number(fact.importance ?? 0),
                            Number(fact.created_at ?? now),
                            Number(fact.recall_count ?? 0),
                            Number(fact.last_accessed ?? fact.created_at ?? now),
                            now,
                        );
                        const priorStatus = String(fact.status ?? "active");
                        const status = priorStatus === "active" && shouldArchive(strength)
                            ? "archived"
                            : priorStatus;
                        updateFact.run(strength, status, id);
                        if (priorStatus !== status) factsArchived += 1;
                        if (Number(fact.strength ?? 0) !== strength || priorStatus !== status) {
                            factsUpdated += 1;
                        }

                        // The full indexes preserve every fact. The hot indexes
                        // are an eligibility cache and must follow the same
                        // active/strength predicate after every sweep.
                        const mapped = mappedFact.get(id) as { fid?: number } | undefined;
                        if (mapped?.fid !== undefined) {
                            deleteHotFts.run(mapped.fid);
                            const fts = fullFts.get(mapped.fid) as {
                                content?: string;
                                entities?: string;
                                topics?: string;
                            } | undefined;
                            if (status === "active" && strength > 0.6 && fts) {
                                insertHotFts.run(mapped.fid, fts.content ?? "", fts.entities ?? "", fts.topics ?? "");
                            }
                        }
                        deleteHotVector.run(id);
                        const vector = fullVector.get(id) as { embedding?: Uint8Array | ArrayBuffer } | undefined;
                        if (status === "active" && strength > 0.6 && vector?.embedding) {
                            insertHotVector.run(id, vector.embedding);
                        }
                    }

                    for (const episode of episodes) {
                        const id = String(episode.id);
                        const strength = calculateStrength(
                            Number(episode.importance_utility ?? 0),
                            Number(episode.timestamp ?? now),
                            Number(episode.recall_count ?? 0),
                            Number(episode.last_accessed ?? episode.timestamp ?? now),
                            now,
                        );
                        const priorStatus = String(episode.status ?? "active");
                        const status = priorStatus === "active"
                            && Number(episode.consolidated ?? 0) === 0
                            && shouldArchive(strength)
                            ? "archived"
                            : priorStatus;
                        updateEpisode.run(strength, status, id);
                        if (priorStatus !== status) episodesArchived += 1;
                        if (Number(episode.strength ?? 0) !== strength || priorStatus !== status) {
                            episodesUpdated += 1;
                        }
                    }

                    const associationUpdate = db.prepare(
                        "UPDATE semantic_associations SET weight = weight * 0.95",
                    ).run();
                    const kgUpdate = db.prepare(
                        "UPDATE kg_edges SET weight = weight * 0.95",
                    ).run();
                    if (facts.length > 0) bumpFactGeneration();
                    return {
                        factsUpdated,
                        episodesUpdated,
                        factsArchived,
                        episodesArchived,
                        associationsUpdated: Number(associationUpdate.changes ?? 0),
                        kgEdgesUpdated: Number(kgUpdate.changes ?? 0),
                    };
                });
                // Acquire the write lock before reading lifecycle/index rows;
                // retrying the complete transaction keeps the sweep atomic.
                result = withBusyRetry(() => tx.immediate(payload));
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
                result = withBusyRetry(() => tx(payload.factId));
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
                result = withBusyRetry(() => tx(payload));
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
