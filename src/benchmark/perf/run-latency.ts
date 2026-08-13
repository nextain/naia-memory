/**
 * Naia Memory — Retrieval Latency & Accuracy Benchmark (perf axis)
 *
 * Improvement over src/__tests__/stress-test-tiered-100k.ts:
 *  - Statistically robust: warmup + N samples → p50/p95/p99/max (not 1 sample).
 *  - Measures BOTH surface (hot) and deep (full-corpus) recall.
 *  - Measures precision@k accuracy, not just "non-zero hits".
 *  - Fast, reproducible injection via DeterministicEmbeddingProvider — isolates
 *    SqliteAdapter+FTS5+sqlite-vec+worker-IPC cost from transformer inference.
 *  - Emits a committed JSON artifact + markdown table (self-rigor).
 *
 * Env knobs: BENCH_COUNT (default 100000), BENCH_SAMPLES (default 300),
 *            BENCH_TOPK (default 10), BENCH_DIMS (default 384).
 *
 * Run: npx tsx src/benchmark/perf/run-latency.ts
 */
import { MemorySystem } from "../../memory/index.js";
import { SqliteAdapter } from "../../memory/adapters/sqlite.js";
import { DeterministicEmbeddingProvider } from "./deterministic-embedder.js";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unlinkSync, existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { benchmarkReceipt } from "../provenance.js";

const COUNT = Number(process.env.BENCH_COUNT ?? 100000);
const HOT = Math.min(10000, Math.floor(COUNT / 10));
const SAMPLES = Number(process.env.BENCH_SAMPLES ?? 300);
const TOPK = Number(process.env.BENCH_TOPK ?? 10);
const DIMS = Number(process.env.BENCH_DIMS ?? 384);
const NOW = Number(process.env.BENCH_NOW ?? 1_720_000_000_000); // fixed clock for determinism

function pct(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
	return sorted[idx];
}

function tokenSet(s: string): Set<string> {
	return new Set(
		s.toLowerCase().replace(/[^\w\s-]/g, " ").split(/\s+/).filter(Boolean),
	);
}

interface Stat {
	label: string;
	samples: number;
	p50: number;
	p95: number;
	p99: number;
	max: number;
	mean: number;
	min: number;
	hitRateAvg: number;
	precisionAtKAvg: number;
}

async function benchRecall(
	memory: MemorySystem,
	queries: string[],
	deepRecall: boolean,
	label: string,
): Promise<Stat> {
	// Warmup — one full cycle of queries (JIT, worker warm, caches).
	for (const q of queries) {
		await memory.recall(q, { topK: TOPK, deepRecall });
	}

	const latencies: number[] = [];
	let hitSum = 0;
	let precSum = 0;
	let precCount = 0;

	for (let s = 0; s < SAMPLES; s++) {
		const q = queries[s % queries.length];
		const t0 = performance.now();
		const res = await memory.recall(q, { topK: TOPK, deepRecall });
		latencies.push(performance.now() - t0);

		hitSum += res.facts.length;
		// precision@k: fraction of returned facts whose content contains the
		// query token exactly (ground truth on synthetic corpus).
		if (res.facts.length > 0) {
			const qtok = q.toLowerCase();
			const correct = res.facts.filter((f) => tokenSet(f.content).has(qtok)).length;
			precSum += correct / res.facts.length;
			precCount++;
		}
	}

	latencies.sort((a, b) => a - b);
	const sum = latencies.reduce((a, b) => a + b, 0);
	return {
		label,
		samples: SAMPLES,
		p50: pct(latencies, 50),
		p95: pct(latencies, 95),
		p99: pct(latencies, 99),
		max: latencies[latencies.length - 1],
		mean: sum / latencies.length,
		min: latencies[0],
		hitRateAvg: hitSum / SAMPLES,
		precisionAtKAvg: precCount > 0 ? precSum / precCount : 0,
	};
}

async function main() {
	console.log(`=== Naia Memory Perf Bench (count=${COUNT}, hot=${HOT}, samples=${SAMPLES}, topK=${TOPK}, dims=${DIMS}) ===`);
	const dbPath = process.env.BENCH_DB_PATH ?? join(tmpdir(), `naia-memory-perf-${process.pid}.db`);
	if (existsSync(dbPath)) unlinkSync(dbPath);

	const embedder = new DeterministicEmbeddingProvider(DIMS);
	const adapter = new SqliteAdapter({ dbPath, embeddingProvider: embedder });
	const memory = new MemorySystem({ adapter });
	await memory.init();

	// ---- Injection ----
	const BATCH = 1000;
	const injStart = performance.now();
	for (let i = 0; i < COUNT / BATCH; i++) {
		const promises = [];
		for (let j = 0; j < BATCH; j++) {
			const id = i * BATCH + j;
			const strength = id < HOT ? 0.9 : 0.1;
			promises.push(
				adapter.semantic.upsert({
					id: `fact-${id}`,
					content: `Synthetic fact ${id} topic-${id % 1000} group-${id % 10}.`,
					entities: [`topic-${id % 1000}`, `group-${id % 10}`],
					topics: [`topic-${id % 1000}`],
					importance: 0.1,
					maxEmotion: 0.1,
					strength,
					status: "active" as const,
					createdAt: NOW - id * 1000,
					updatedAt: NOW - id * 1000,
					lastAccessed: NOW - id * 1000,
					recallCount: 0,
					validFrom: NOW - id * 1000,
					validTo: null,
					sourceEpisodes: [randomUUID()],
					encodingContext: { project: "perf-bench" },
				}),
			);
		}
		await Promise.all(promises);
	}
	const injMs = performance.now() - injStart;
	console.log(`Injection: ${COUNT} facts in ${(injMs / 1000).toFixed(2)}s (${Math.round(COUNT / (injMs / 1000))} facts/s)`);

	// ---- Query sets ----
	const topicQueries = [1, 42, 100, 250, 500, 777, 999, 12, 333, 654].map((n) => `topic-${n}`);
	const groupQueries = [0, 3, 5, 7, 9].map((n) => `group-${n}`);
	const queries = [...topicQueries, ...groupQueries];

	const surface = await benchRecall(memory, queries, false, "surface (hot)");
	const deep = await benchRecall(memory, queries, true, "deep (full corpus)");

	// ---- Footprint ----
	const rssMB = process.memoryUsage().rss / (1024 * 1024);
	const dbMB = statSync(dbPath).size / (1024 * 1024);

	await memory.close();

	const report = {
		benchmark: "retrieval-latency-accuracy",
		receipt: benchmarkReceipt([], { count: COUNT, hot: HOT, samples: SAMPLES, topK: TOPK, dims: DIMS, benchmarkClock: new Date(NOW).toISOString() }),
		config: { count: COUNT, hot: HOT, samples: SAMPLES, topK: TOPK, dims: DIMS },
		embedder: embedder.name,
		methodologyNote:
			"Latency isolates retrieval (SqliteAdapter+FTS5+sqlite-vec+worker-IPC) from embedding-model cost via a deterministic bag-of-tokens embedder. sqlite-vec brute-force scan latency depends on (dims, corpus-size), not vector values, so latency is representative of the real embedder at the same dims. precision@k is a relative signal on the synthetic (shared-token) corpus, NOT a semantic-quality claim.",
		injectionMs: injMs,
		injectionThroughputPerSec: Math.round(COUNT / (injMs / 1000)),
		footprint: { rssMB: Number(rssMB.toFixed(1)), dbFileMB: Number(dbMB.toFixed(1)) },
		results: { surface, deep },
	};

	const outDir = join(process.cwd(), "reports", "perf");
	mkdirSync(outDir, { recursive: true });
	const outPath = join(outDir, `latency-accuracy-count${COUNT}.json`);
	writeFileSync(outPath, JSON.stringify(report, null, 2));

	// ---- Print markdown ----
	const fmt = (s: Stat) =>
		`| ${s.label} | ${s.p50.toFixed(2)} | ${s.p95.toFixed(2)} | ${s.p99.toFixed(2)} | ${s.max.toFixed(2)} | ${s.mean.toFixed(2)} | ${s.hitRateAvg.toFixed(1)} | ${(s.precisionAtKAvg * 100).toFixed(1)}% |`;
	console.log(`\n--- Results (${SAMPLES} samples, topK=${TOPK}, ${COUNT} facts) ---`);
	console.log("| Path | p50 ms | p95 ms | p99 ms | max ms | mean ms | avg hits | precision@k |");
	console.log("|---|---|---|---|---|---|---|---|");
	console.log(fmt(surface));
	console.log(fmt(deep));
	console.log(`\nFootprint: RSS ${rssMB.toFixed(1)}MB, DB file ${dbMB.toFixed(1)}MB`);
	console.log(`Artifact: ${outPath}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
