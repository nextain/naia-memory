/**
 * LiteMemoryProvider — 8G tier 경량 MemoryProvider 변형.
 *
 * naia-agent 8G 커뮤니케이션 tier 용. heavy MemorySystem(mem0/sqlite-vec/
 * worker/decay/KG)을 얹지 않고 `MemoryProvider` 계약만 최소 구현:
 *   SQLite(better-sqlite3) fact 저장 + 주입 EmbeddingProvider + brute-force
 *   cosine recall. 벡터DB·worker·LLM 판단 없음.
 *
 * Anchor 정합 (CLAUDE.md):
 *  - #1 MemoryProvider 충실 구현(provider-types.ts) — 재정의 X
 *  - #6 보존 우선 — delete/prune/splice 없음(append-only). recall=ranking,
 *       latency 수용. embed 실패 시 graceful no-memory degrade
 *  - #7 naia-memory=검색 로직만 — 자연어 의도/요약 판단은 naia-agent.
 *       what-to-store 판단도 agent 측. provider 는 주어진 것만 persist
 *  - #8 외부 cloud LLM 호출 X — embed 는 주입(EmbeddingProvider, local)
 *
 * cross-review(step-1, Claude sub-agent) 반영:
 *  - F1 project 스코핑: project 컬럼 + opts.project 필터(멀티프로젝트 누수 차단)
 *  - F2 차원 무결성: dims 저장, 쿼리 vec 차원 불일치 시 loud throw(임베더 교체)
 *  - F3 recall embed 실패 → [] graceful(anchor#6); encode 실패는 전파
 *  - F4 topK 정제 / F5 append-only INSERT / F6 :memory: 시 WAL skip
 *  - writes off by default(B-write): 쓰기 게이트 본책임=naia-agent(독립 validator)
 */

import Database from "better-sqlite3";
import type { EmbeddingProvider } from "./embeddings.js";
import type {
	MemoryProvider,
	MemoryProviderInput,
	MemoryHit,
	RecallOptions,
	ConsolidationSummary,
} from "./provider-types.js";

export interface LiteMemoryProviderOptions {
	/** SQLite file. ":memory:" for ephemeral (tests). */
	dbPath: string;
	/** Local embedder (anchor #8 — no external cloud LLM). Injected. */
	embedder: EmbeddingProvider;
	/** Writes off by default (cross-review B-write). Enable only with an
	 *  agent-side independent validator upstream. */
	writesEnabled?: boolean;
	/** Default recall topK when opts.topK absent/invalid. */
	defaultTopK?: number;
}

interface FactRow {
	id: string;
	content: string;
	vec: string;
	dims: number;
	project: string | null;
	created_at: number;
}

/** cosine → [0,1], 1=strongest (provider-types: score normalized). */
function cosineScore(a: readonly number[], b: readonly number[]): number {
	if (a.length === 0 || a.length !== b.length) return 0;
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		na += a[i] * a[i];
		nb += b[i] * b[i];
	}
	if (na === 0 || nb === 0) return 0;
	const c = dot / (Math.sqrt(na) * Math.sqrt(nb));
	return c <= 0 ? 0 : c >= 1 ? 1 : c; // clamp; negatives = not a match
}

export class LiteMemoryProvider implements MemoryProvider {
	readonly #db: Database.Database;
	readonly #embedder: EmbeddingProvider;
	readonly #writesEnabled: boolean;
	readonly #defaultTopK: number;

	constructor(opts: LiteMemoryProviderOptions) {
		this.#embedder = opts.embedder;
		this.#writesEnabled = opts.writesEnabled ?? false;
		this.#defaultTopK = opts.defaultTopK ?? 5;
		this.#db = new Database(opts.dbPath);
		// F6: WAL is silently ignored on :memory: — skip for honesty.
		if (opts.dbPath !== ":memory:") this.#db.pragma("journal_mode = WAL");
		this.#db.exec(
			`CREATE TABLE IF NOT EXISTS lite_facts (
				id TEXT PRIMARY KEY,
				content TEXT NOT NULL,
				vec TEXT NOT NULL,
				dims INTEGER NOT NULL,
				project TEXT,
				created_at INTEGER NOT NULL
			)`,
		);
	}

	async encode(
		input: MemoryProviderInput,
		opts?: { project?: string },
	): Promise<void> {
		// Writes off by default — the what-to-store judgment + independent
		// validation is naia-agent's responsibility (anchor #7, B-write).
		if (!this.#writesEnabled) return;
		const content = input.content.trim();
		if (content.length === 0) return;
		// encode embed failure propagates (enabling writes is deliberate).
		const vec = await this.#embedder.embed(content);
		const id = `lf_${Date.now().toString(36)}_${Math.random()
			.toString(36)
			.slice(2, 8)}`;
		// F5: append-only (anchor #6) — plain INSERT, never overwrite.
		this.#db
			.prepare(
				"INSERT INTO lite_facts (id, content, vec, dims, project, created_at) VALUES (?, ?, ?, ?, ?, ?)",
			)
			.run(
				id,
				content,
				JSON.stringify(vec),
				vec.length,
				opts?.project ?? null,
				input.timestamp ?? Date.now(),
			);
	}

	async recall(query: string, opts?: RecallOptions): Promise<MemoryHit[]> {
		const q = query.trim();
		if (q.length === 0) return [];
		// F4: sanitize topK (NaN/negative/float → default).
		const topK =
			opts?.topK !== undefined &&
			Number.isFinite(opts.topK) &&
			opts.topK > 0
				? Math.floor(opts.topK)
				: this.#defaultTopK;
		// F3: embed failure → graceful no-memory (anchor #6 degrade).
		let qvec: number[];
		try {
			qvec = await this.#embedder.embed(q);
		} catch {
			return [];
		}
		// F1: project scoping — caller-supplied project isolates strictly.
		const rows = (
			opts?.project !== undefined
				? this.#db
						.prepare(
							"SELECT id, content, vec, dims, project, created_at FROM lite_facts WHERE project IS ?",
						)
						.all(opts.project)
				: this.#db
						.prepare(
							"SELECT id, content, vec, dims, project, created_at FROM lite_facts",
						)
						.all()
		) as FactRow[];
		const scored: MemoryHit[] = [];
		for (const r of rows) {
			// F2: embedder dim changed since write → recall unsafe. Loud
			// fail (preservation-first keeps rows; never serve zero-noise).
			if (r.dims !== qvec.length) {
				throw new Error(
					`LiteMemoryProvider: embedder dimension changed (stored=${r.dims} query=${qvec.length}) — recall unsafe; re-encode required`,
				);
			}
			let v: number[];
			try {
				v = JSON.parse(r.vec) as number[];
			} catch {
				continue; // corrupt row — preservation-first: skip, don't delete
			}
			scored.push({
				id: r.id,
				content: r.content,
				score: cosineScore(qvec, v),
				createdAt: r.created_at,
			});
		}
		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, topK);
	}

	async consolidate(): Promise<ConsolidationSummary> {
		// Preservation-first (anchor #6): no decay/prune/merge. No-op.
		return {
			factsCreated: 0,
			factsUpdated: 0,
			episodesProcessed: 0,
			durationMs: 0,
		};
	}

	async close(): Promise<void> {
		this.#db.close();
	}
}
