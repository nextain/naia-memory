export interface CosineDistribution {
	min: number;
	p05: number;
	p50: number;
	p95: number;
	p99: number;
	max: number;
}

export interface CorpusGeometryReceipt {
	policy: "density-inflation-guard";
	normalization: "cosine-with-measured-l2-norms";
	normRange: { min: number; max: number };
	seed: number;
	pairCount: number;
	base: CosineDistribution;
	generated: CosineDistribution;
	delta: { p50: number; p95: number; p99: number };
	maxAllowedDelta: { p50: number; p95: number; p99: number };
	passed: boolean;
}

export const PROVISIONAL_GEOMETRY_LIMITS = {
	p50: 0.03,
	p95: 0.03,
	p99: 0.03,
} as const;
export const GEOMETRY_PAIR_COUNT = 10_000;
export const GEOMETRY_SEED = 0x9e3779b9;

function percentile(sorted: number[], quantile: number): number {
	return sorted[Math.floor((sorted.length - 1) * quantile)];
}

function summarize(values: number[]): CosineDistribution {
	const sorted = [...values].sort((a, b) => a - b);
	return {
		min: sorted[0],
		p05: percentile(sorted, 0.05),
		p50: percentile(sorted, 0.5),
		p95: percentile(sorted, 0.95),
		p99: percentile(sorted, 0.99),
		max: sorted[sorted.length - 1],
	};
}

function cosine(
	vectors: Float32Array,
	dims: number,
	left: number,
	right: number,
) {
	let score = 0;
	let leftNorm = 0;
	let rightNorm = 0;
	const leftOffset = left * dims;
	const rightOffset = right * dims;
	for (let dimension = 0; dimension < dims; dimension++) {
		const leftValue = vectors[leftOffset + dimension];
		const rightValue = vectors[rightOffset + dimension];
		score += leftValue * rightValue;
		leftNorm += leftValue * leftValue;
		rightNorm += rightValue * rightValue;
	}
	return score / Math.sqrt(leftNorm * rightNorm);
}

function xorshift32(seed: number) {
	let state = seed >>> 0;
	return () => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return state >>> 0;
	};
}

function samplePairs(options: {
	vectors: Float32Array;
	dims: number;
	start: number;
	count: number;
	pairCount: number;
	seed: number;
}) {
	const { vectors, dims, start, count, pairCount, seed } = options;
	if (count < 2) throw new Error("geometry sample requires at least two vectors");
	const random = xorshift32(seed);
	const values: number[] = [];
	for (let pair = 0; pair < pairCount; pair++) {
		const left = start + (random() % count);
		let right = start + (random() % count);
		if (left === right) right = start + ((right - start + 1) % count);
		values.push(cosine(vectors, dims, left, right));
	}
	return summarize(values);
}

export function qualifyCorpusGeometry(options: {
	vectors: Float32Array;
	dims: number;
	baseSize: number;
	pairCount?: number;
	seed?: number;
	maxAllowedDelta?: { p50: number; p95: number; p99: number };
}): CorpusGeometryReceipt {
	const {
		vectors,
		dims,
		baseSize,
		pairCount = GEOMETRY_PAIR_COUNT,
		seed = GEOMETRY_SEED,
		maxAllowedDelta = PROVISIONAL_GEOMETRY_LIMITS,
	} = options;
	if (vectors.length % dims !== 0) throw new Error("invalid vector matrix");
	if (seed === 0) throw new Error("geometry seed must be non-zero");
	const vectorCount = vectors.length / dims;
	const generatedSize = vectorCount - baseSize;
	if (baseSize < 2 || generatedSize < 2)
		throw new Error("geometry qualification requires base and generated vectors");
	let minNorm = Number.POSITIVE_INFINITY;
	let maxNorm = 0;
	for (let row = 0; row < vectorCount; row++) {
		let squaredNorm = 0;
		for (let dimension = 0; dimension < dims; dimension++) {
			const value = vectors[row * dims + dimension];
			squaredNorm += value * value;
		}
		const norm = Math.sqrt(squaredNorm);
		if (!Number.isFinite(norm) || norm === 0)
			throw new Error(`invalid vector norm at row ${row}`);
		minNorm = Math.min(minNorm, norm);
		maxNorm = Math.max(maxNorm, norm);
	}
	const base = samplePairs({
		vectors,
		dims,
		start: 0,
		count: baseSize,
		pairCount,
		seed,
	});
	const generated = samplePairs({
		vectors,
		dims,
		start: baseSize,
		count: generatedSize,
		pairCount,
		seed,
	});
	const delta = {
		p50: generated.p50 - base.p50,
		p95: generated.p95 - base.p95,
		p99: generated.p99 - base.p99,
	};
	return {
		policy: "density-inflation-guard",
		normalization: "cosine-with-measured-l2-norms",
		normRange: { min: minNorm, max: maxNorm },
		seed,
		pairCount,
		base,
		generated,
		delta,
		maxAllowedDelta,
		passed:
			delta.p50 <= maxAllowedDelta.p50 &&
			delta.p95 <= maxAllowedDelta.p95 &&
			delta.p99 <= maxAllowedDelta.p99,
	};
}
