import { describe, expect, it } from "vitest";
import {
	PROVISIONAL_GEOMETRY_LIMITS,
	qualifyCorpusGeometry,
} from "./hnsw-corpus-geometry.js";

function vectors(rows: number[][]) {
	return Float32Array.from(rows.flat());
}

describe("HNSW corpus geometry qualification", () => {
	it("is deterministic and accepts comparable distributions", () => {
		const matrix = vectors([
			[1, 0],
			[0, 1],
			[-1, 0],
			[1, 0],
			[0, 1],
			[-1, 0],
		]);
		const first = qualifyCorpusGeometry({
			vectors: matrix,
			dims: 2,
			baseSize: 3,
			pairCount: 100,
		});
		expect(first).toEqual(
			qualifyCorpusGeometry({
				vectors: matrix,
				dims: 2,
				baseSize: 3,
				pairCount: 100,
			}),
		);
		expect(first.passed).toBe(true);
	});

	it("rejects a generated cluster that is denser than the base", () => {
		const result = qualifyCorpusGeometry({
			vectors: vectors([
				[1, 0],
				[0, 1],
				[-1, 0],
				[1, 0],
				[0.999, 0.045],
				[0.998, 0.063],
			]),
			dims: 2,
			baseSize: 3,
			pairCount: 100,
		});
		expect(result.passed).toBe(false);
		expect(result.delta.p50).toBeGreaterThan(
			PROVISIONAL_GEOMETRY_LIMITS.p50,
		);
	});

	it("rejects malformed matrices and a zero seed", () => {
		expect(() =>
			qualifyCorpusGeometry({
				vectors: Float32Array.from([1, 0, 1]),
				dims: 2,
				baseSize: 1,
			}),
		).toThrow("invalid vector matrix");
		expect(() =>
			qualifyCorpusGeometry({
				vectors: vectors([[1, 0], [0, 1], [1, 0], [0, 1]]),
				dims: 2,
				baseSize: 2,
				seed: 0,
			}),
		).toThrow("geometry seed must be non-zero");
	});
});
