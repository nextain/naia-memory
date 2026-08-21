import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

export interface RankedMetrics {
	recall1: number;
	recall5: number;
	recall10: number;
	mrr: number;
}

export interface QueryComparison {
	goldId: string;
	baseline: string[];
	candidate: string[];
}

export function squaredL2(a: number[], b: number[]): number {
	let sum = 0;
	for (let index = 0; index < a.length; index++) {
		const delta = a[index] - b[index];
		sum += delta * delta;
	}
	return sum;
}

export function exactTopK(
	ids: string[],
	vectors: number[][],
	query: number[],
	topK: number,
): string[] {
	return ids
		.map((id, index) => ({ id, distance: squaredL2(vectors[index], query) }))
		.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
		.slice(0, topK)
		.map(({ id }) => id);
}

export function summarizeRanked(
	comparisons: QueryComparison[],
	key: "baseline" | "candidate",
): RankedMetrics {
	let recall1 = 0;
	let recall5 = 0;
	let recall10 = 0;
	let reciprocalRank = 0;
	for (const comparison of comparisons) {
		const rank = comparison[key].indexOf(comparison.goldId);
		if (rank === 0) recall1++;
		if (rank >= 0 && rank < 5) recall5++;
		if (rank >= 0 && rank < 10) recall10++;
		if (rank >= 0) reciprocalRank += 1 / (rank + 1);
	}
	const count = comparisons.length;
	return {
		recall1: recall1 / count,
		recall5: recall5 / count,
		recall10: recall10 / count,
		mrr: reciprocalRank / count,
	};
}

export function meanTopKOverlap(comparisons: QueryComparison[]): number {
	let sum = 0;
	for (const { baseline, candidate } of comparisons) {
		const expected = new Set(baseline);
		sum += candidate.filter((id) => expected.has(id)).length / baseline.length;
	}
	return sum / comparisons.length;
}

export class BinaryCandidateIndex {
	private readonly db: Database.Database;
	private readonly search: Database.Statement;

	constructor(
		ids: string[],
		vectors: number[][],
		readonly dims: number,
	) {
		this.db = new Database(":memory:");
		sqliteVec.load(this.db);
		this.db.exec(
			`CREATE VIRTUAL TABLE vectors USING vec0(fact_id TEXT PRIMARY KEY, embedding bit[${dims}])`,
		);
		const insert = this.db.prepare(
			"INSERT INTO vectors(fact_id, embedding) VALUES (?, vec_quantize_binary(?))",
		);
		const insertAll = this.db.transaction(() => {
			for (let index = 0; index < ids.length; index++) {
				insert.run(
					ids[index],
					Buffer.from(new Float32Array(vectors[index]).buffer),
				);
			}
		});
		insertAll();
		this.search = this.db.prepare(
			"SELECT fact_id FROM vectors WHERE embedding MATCH vec_quantize_binary(?) AND k = ?",
		);
	}

	candidates(query: number[], count: number): string[] {
		const buffer = Buffer.from(new Float32Array(query).buffer);
		return (this.search.all(buffer, count) as Array<{ fact_id: string }>).map(
			({ fact_id }) => fact_id,
		);
	}

	close(): void {
		this.db.close();
	}
}

export function rerankCandidates(
	candidateIds: string[],
	vectorsById: Map<string, number[]>,
	query: number[],
	topK: number,
): string[] {
	return candidateIds
		.map((id) => {
			const vector = vectorsById.get(id);
			if (!vector) throw new Error(`Missing vector for candidate ${id}`);
			return { id, distance: squaredL2(vector, query) };
		})
		.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
		.slice(0, topK)
		.map(({ id }) => id);
}
