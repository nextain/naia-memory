/**
 * Current SQLite recall SQL breakdown against an explicitly selected benchmark DB.
 * Mirrors SqliteAdapter.semantic.search and measures the direct-SQL latency floor.
 *
 * Run: BENCH_DB_PATH=/tmp/naia-memory-perf-123.db npx tsx src/benchmark/perf/breakdown.ts
 */
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { existsSync } from "node:fs";
import { normalize, tokenize } from "../../memory/ko-normalize.js";
import { DeterministicEmbeddingProvider } from "./deterministic-embedder.js";

const dbPath = process.env.BENCH_DB_PATH;
if (!dbPath)
	throw new Error(
		"BENCH_DB_PATH is required; select the exact DB produced by run-latency.ts",
	);
if (!existsSync(dbPath)) throw new Error(`DB not found: ${dbPath}`);

const DIMS = Number(process.env.BENCH_DIMS ?? 384);
const TOPK = Number(process.env.BENCH_TOPK ?? 10);
const ROUNDS = Number(process.env.BENCH_ROUNDS ?? 20);
const limit = TOPK * 10;
const queries = [1, 42, 100, 250, 500, 777, 999, 12, 333, 654]
	.map((n) => `topic-${n}`)
	.concat([0, 3, 5, 7, 9].map((n) => `group-${n}`));

type Stage = "embed" | "fts" | "vector" | "idMap" | "finalSelect" | "total";
type Samples = Record<Stage, number[]>;

function percentile(values: number[], p: number): number {
	const sorted = [...values].sort((a, b) => a - b);
	return (
		sorted[
			Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
		] ?? 0
	);
}

function makeSamples(): Samples {
	return {
		embed: [],
		fts: [],
		vector: [],
		idMap: [],
		finalSelect: [],
		total: [],
	};
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
sqliteVec.load(db);
db.pragma("cache_size = -64000");
const embedder = new DeterministicEmbeddingProvider(DIMS);

async function measurePath(hot: boolean): Promise<Samples> {
	const suffix = hot ? "_hot" : "";
	const ftsTable = `facts_fts${suffix}`;
	const vecTable = `vec_facts${suffix}`;
	const fts = db.prepare(`SELECT ft.rowid, bm25(${ftsTable}) AS score
		FROM ${ftsTable} ft
		JOIN id_map m ON m.fid = ft.rowid
		JOIN facts f ON f.id = m.fact_id
		WHERE ${ftsTable} MATCH ?${hot ? " AND f.status = 'active'" : ""}
		ORDER BY bm25(${ftsTable}) LIMIT ?`);
	const vector = db.prepare(`SELECT v.fact_id, v.distance FROM ${vecTable} v
		WHERE v.embedding MATCH ? AND v.k = ? ORDER BY v.distance`);
	const samples = makeSamples();

	for (let round = -1; round < ROUNDS; round++) {
		for (const query of queries) {
			const t0 = performance.now();
			const queryVec = await embedder.embed(query);
			const t1 = performance.now();
			const match = tokenize(normalize(query))
				.filter(Boolean)
				.map((token) => `"${token.replace(/"/g, '""')}"*`)
				.join(" OR ");
			const ftsRows = fts.all(match, limit) as Array<{ rowid: number }>;
			const t2 = performance.now();
			const vectorRows = vector.all(
				Buffer.from(new Float32Array(queryVec).buffer),
				limit,
			) as Array<{ fact_id: string }>;
			const t3 = performance.now();

			const scores = new Map<string, number>();
			if (ftsRows.length > 0) {
				const resolved = db
					.prepare(
						`SELECT rowid, fact_id FROM id_map WHERE fid IN (${ftsRows.map(() => "?").join(",")})`,
					)
					.all(...ftsRows.map(({ rowid }) => rowid)) as Array<{
					rowid: number;
					fact_id: string;
				}>;
				const ranks = new Map(
					ftsRows.map((row, index) => [Number(row.rowid), index + 1]),
				);
				for (const row of resolved)
					scores.set(row.fact_id, 1 / (60 + (ranks.get(row.rowid) ?? limit)));
			}
			const t4 = performance.now();
			for (const [index, row] of vectorRows.entries()) {
				scores.set(
					row.fact_id,
					(scores.get(row.fact_id) ?? 0) + 1 / (60 + index + 1),
				);
			}
			const ids = [...scores.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, Math.max(50, TOPK))
				.map(([id]) => id);
			if (ids.length > 0) {
				db.prepare(
					`SELECT * FROM facts WHERE 1=1 AND id IN (${ids.map(() => "?").join(",")})`,
				).all(...ids);
			}
			const t5 = performance.now();
			if (round < 0) continue;
			samples.embed.push(t1 - t0);
			samples.fts.push(t2 - t1);
			samples.vector.push(t3 - t2);
			samples.idMap.push(t4 - t3);
			samples.finalSelect.push(t5 - t4);
			samples.total.push(t5 - t0);
		}
	}
	return samples;
}

function printPath(label: string, samples: Samples): void {
	console.log(
		`\n${label} direct-SQL breakdown (${samples.total.length} samples)`,
	);
	console.log("| stage | p50 ms | p95 ms |");
	console.log("|---|---:|---:|");
	for (const stage of Object.keys(samples) as Stage[]) {
		console.log(
			`| ${stage} | ${percentile(samples[stage], 50).toFixed(3)} | ${percentile(samples[stage], 95).toFixed(3)} |`,
		);
	}
}

async function main(): Promise<void> {
	const counts = db
		.prepare(`SELECT
		(SELECT count(*) FROM facts) AS facts,
		(SELECT count(*) FROM facts_fts_hot) AS hotFts,
		(SELECT count(*) FROM vec_facts) AS vectors,
		(SELECT count(*) FROM vec_facts_hot) AS hotVectors`)
		.get() as Record<string, number>;
	console.log(`DB: ${dbPath}`);
	console.log(
		`facts=${counts.facts}, hot_fts=${counts.hotFts}, vectors=${counts.vectors}, hot_vectors=${counts.hotVectors}, dims=${DIMS}`,
	);
	printPath("surface", await measurePath(true));
	printPath("deep", await measurePath(false));
	db.close();
}

main().catch((error) => {
	db.close();
	console.error(error);
	process.exitCode = 1;
});
