/**
 * VectorStore — sqlite-vec 직접 저장 / 검색.
 *
 * 사전 계산된 벡터 (audio fingerprint 등) 를 source_model 별 별 vec0 테이블에
 * 분리 저장. 메타데이터는 공유 테이블. cosine distance 사용.
 *
 * 사용:
 *   const vs = new VectorStore("/path/to/vector.sqlite");
 *   const id = vs.add({ user_id, vector, source_model: "audio-embedding-v1.0", ... });
 *   const results = vs.search({ user_id, query_vector, source_model, limit: 5 });
 */
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export interface VectorAddInput {
	user_id: string;
	vector: number[];
	content?: string;
	source_type: string;
	source_model: string;
	timestamp?: number;
	additional_data?: Record<string, unknown>;
}

export interface VectorSearchInput {
	user_id: string;
	query_vector: number[];
	source_model: string;
	limit?: number;
	filter?: { source_type?: string };
}

export interface VectorSearchResult {
	id: string;
	user_id: string;
	content: string;
	source_type: string;
	source_model: string;
	timestamp: number;
	additional_data: Record<string, unknown>;
	distance: number;
	score: number;
}

export class VectorStore {
	private db: Database.Database;
	private knownTables = new Set<string>();

	constructor(dbPath: string) {
		mkdirSync(dirname(dbPath), { recursive: true });
		this.db = new Database(dbPath);
		sqliteVec.load(this.db);

		this.db.exec(`
			CREATE TABLE IF NOT EXISTS vector_metadata (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL,
				content TEXT,
				source_type TEXT,
				source_model TEXT NOT NULL,
				timestamp INTEGER,
				additional_data TEXT,
				vector_dim INTEGER
			);
			CREATE INDEX IF NOT EXISTS idx_meta_user_model
				ON vector_metadata(user_id, source_model);
		`);
	}

	private tableNameFor(source_model: string): string {
		return "vec_" + source_model.replace(/[^a-zA-Z0-9_]/g, "_");
	}

	private ensureTable(source_model: string, dim: number): string {
		const table = this.tableNameFor(source_model);
		if (this.knownTables.has(table)) return table;
		this.db.exec(`
			CREATE VIRTUAL TABLE IF NOT EXISTS ${table} USING vec0(
				memory_id TEXT PRIMARY KEY,
				embedding float[${dim}] distance_metric=cosine
			);
		`);
		this.knownTables.add(table);
		return table;
	}

	add(input: VectorAddInput): string {
		const id = randomUUID();
		const ts = input.timestamp ?? Date.now();
		const table = this.ensureTable(input.source_model, input.vector.length);
		const vec = new Float32Array(input.vector);

		const insertMeta = this.db.prepare(`
			INSERT INTO vector_metadata
				(id, user_id, content, source_type, source_model,
				 timestamp, additional_data, vector_dim)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`);
		const insertVec = this.db.prepare(
			`INSERT INTO ${table}(memory_id, embedding) VALUES (?, ?)`,
		);

		const txn = this.db.transaction(() => {
			insertMeta.run(
				id,
				input.user_id,
				input.content ?? "",
				input.source_type,
				input.source_model,
				ts,
				JSON.stringify(input.additional_data ?? {}),
				input.vector.length,
			);
			insertVec.run(id, vec);
		});
		txn();
		return id;
	}

	search(input: VectorSearchInput): VectorSearchResult[] {
		const limit = input.limit ?? 5;
		const table = this.tableNameFor(input.source_model);

		if (!this.knownTables.has(table)) {
			const exists = this.db
				.prepare(
					`SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
				)
				.get(table);
			if (!exists) return [];
			this.knownTables.add(table);
		}

		const qvec = new Float32Array(input.query_vector);
		const filterClause = input.filter?.source_type
			? "AND m.source_type = ?"
			: "";
		const sql = `
			SELECT v.memory_id, v.distance, m.user_id, m.content, m.source_type,
				   m.source_model, m.timestamp, m.additional_data
			  FROM ${table} v
			  JOIN vector_metadata m ON m.id = v.memory_id
			 WHERE v.embedding MATCH ?
			   AND k = ?
			   AND m.user_id = ?
			   ${filterClause}
			 ORDER BY v.distance
		`;
		const params: unknown[] = [qvec, limit, input.user_id];
		if (input.filter?.source_type) params.push(input.filter.source_type);

		const rows = this.db.prepare(sql).all(...params) as Array<{
			memory_id: string;
			distance: number;
			user_id: string;
			content: string;
			source_type: string;
			source_model: string;
			timestamp: number;
			additional_data: string;
		}>;
		return rows.map((r) => ({
			id: r.memory_id,
			user_id: r.user_id,
			content: r.content,
			source_type: r.source_type,
			source_model: r.source_model,
			timestamp: r.timestamp,
			additional_data: JSON.parse(r.additional_data || "{}"),
			distance: r.distance,
			score: 1 - r.distance / 2,
		}));
	}

	deleteByUser(user_id: string): number {
		const meta = this.db
			.prepare(`SELECT id, source_model FROM vector_metadata WHERE user_id = ?`)
			.all(user_id) as Array<{ id: string; source_model: string }>;
		if (meta.length === 0) return 0;
		const txn = this.db.transaction(() => {
			for (const row of meta) {
				const table = this.tableNameFor(row.source_model);
				try {
					this.db
						.prepare(`DELETE FROM ${table} WHERE memory_id = ?`)
						.run(row.id);
				} catch {
					// table may not exist
				}
			}
			this.db
				.prepare(`DELETE FROM vector_metadata WHERE user_id = ?`)
				.run(user_id);
		});
		txn();
		return meta.length;
	}

	count(user_id?: string): number {
		if (user_id) {
			const row = this.db
				.prepare(
					`SELECT COUNT(*) as n FROM vector_metadata WHERE user_id = ?`,
				)
				.get(user_id) as { n: number };
			return row.n;
		}
		const row = this.db
			.prepare(`SELECT COUNT(*) as n FROM vector_metadata`)
			.get() as { n: number };
		return row.n;
	}

	close(): void {
		this.db.close();
	}
}
