import { describe, expect, it } from "vitest";
import { exactVectorTopN, type ExactVectorRow } from "../adapters/sqlite-vector-search.js";

interface FixtureRow extends ExactVectorRow {
    scope: string;
    lifecycle: "active" | "archived";
}

function encode(values: number[]): Buffer {
    return Buffer.from(new Float32Array(values).buffer);
}

function search(rows: ExactVectorRow[], query: number[], limit: number) {
    return exactVectorTopN(() => rows, query, limit);
}

function oracle(rows: ExactVectorRow[], query: number[], limit: number) {
    return rows.map((row, sequence) => {
        const source = row.embedding instanceof ArrayBuffer
            ? row.embedding
            : row.embedding.buffer as ArrayBuffer;
        const byteOffset = row.embedding instanceof ArrayBuffer ? 0 : row.embedding.byteOffset;
        const vector = Array.from(new Float32Array(source, byteOffset, row.embedding.byteLength / 4));
        const squared = vector.reduce((sum, value, index) => sum + (value - query[index]) ** 2, 0);
        return { fact_id: row.fact_id, distance: Math.sqrt(squared), sequence };
    }).sort((a, b) => a.distance - b.distance).slice(0, limit)
        .map(({ fact_id, distance }) => ({ fact_id, distance }));
}

describe("exact SQLite vector top-N ranking", () => {
    it("matches the full-sort oracle for reverse distances and equal sqrt distances", () => {
        const rows: ExactVectorRow[] = [
            { fact_id: "far", embedding: encode([5, 0]) },
            { fact_id: "sqrt-tie-a", embedding: encode([3, 4]) },
            { fact_id: "sqrt-tie-b", embedding: encode([0, 5]) },
            { fact_id: "near", embedding: encode([1, 0]) },
            { fact_id: "middle", embedding: encode([2, 0]) },
        ];

        expect(search(rows, [0, 0], 3)).toEqual(oracle(rows, [0, 0], 3));
        expect(search(rows, [0, 0], 10)).toEqual(oracle(rows, [0, 0], 10));
    });

    it("uses the rounded sqrt result when distinct squared distances become a tie", () => {
        const rows: ExactVectorRow[] = [
            { fact_id: "sqrt-rounded-tie", embedding: encode([1, 2 ** -26]) },
            { fact_id: "exact-one", embedding: encode([1, 0]) },
        ];

        // 1 + (2**-26)**2 is one representable step above 1, but both
        // square roots round to 1. The first scan row therefore wins the tie.
        expect(Math.sqrt(1 + 2 ** -52)).toBe(1);
        expect(search(rows, [0, 0], 1)).toEqual([
            { fact_id: "sqrt-rounded-tie", distance: 1 },
        ]);
    });

    it("keeps the first row at a boundary with many equal distances", () => {
        const rows: ExactVectorRow[] = Array.from({ length: 12 }, (_, index) => ({
            fact_id: `tie-${index}`,
            embedding: encode([index % 2 === 0 ? 1 : -1, 0]),
        }));

        expect(search(rows, [0, 0], 5)).toEqual(oracle(rows, [0, 0], 5));
        expect(search(rows, [0, 0], 5).map(({ fact_id }) => fact_id))
            .toEqual(["tie-0", "tie-1", "tie-2", "tie-3", "tie-4"]);
    });

    it("handles empty input, zero limit, and fewer rows than the limit", () => {
        const rows: ExactVectorRow[] = [{ fact_id: "only", embedding: encode([2]) }];

        expect(search([], [0], 5)).toEqual([]);
        expect(search(rows, [0], 0)).toEqual([]);
        expect(search(rows, [0], 5)).toEqual(oracle(rows, [0], 5));
    });

    it("keeps query components as JavaScript numbers instead of Float32-rounding them", () => {
        const rows: ExactVectorRow[] = [
            { fact_id: "left", embedding: encode([0]) },
            { fact_id: "right", embedding: encode([1]) },
        ];

        expect(search(rows, [0.50000001], 1).map(({ fact_id }) => fact_id)).toEqual(["right"]);
    });

    it("ranks only scope and lifecycle eligible rows before applying the limit", () => {
        const allRows: FixtureRow[] = [
            { fact_id: "foreign-close", scope: "other", lifecycle: "active", embedding: encode([0.01, 0]) },
            { fact_id: "archived-close", scope: "project-a", lifecycle: "archived", embedding: encode([0.02, 0]) },
            { fact_id: "project-a", scope: "project-a", lifecycle: "active", embedding: encode([2, 0]) },
            { fact_id: "project-a-2", scope: "project-a", lifecycle: "active", embedding: encode([3, 0]) },
        ];
        const eligible = allRows.filter((row) => row.scope === "project-a" && row.lifecycle === "active");

        expect(search(eligible, [0, 0], 1)).toEqual(oracle(eligible, [0, 0], 1));
        expect(search(eligible, [0, 0], 1).map(({ fact_id }) => fact_id)).toEqual(["project-a"]);
        expect(search(allRows, [0, 0], 1).map(({ fact_id }) => fact_id)).toEqual(["foreign-close"]);
    });

    it("preserves legacy full-sort slice behavior for special limits", () => {
        const rows: ExactVectorRow[] = [
            { fact_id: "far", embedding: encode([4]) },
            { fact_id: "near", embedding: encode([1]) },
            { fact_id: "middle", embedding: encode([2]) },
        ];

        for (const limit of [-1, 0, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
            expect(search(rows, [0], limit)).toEqual(oracle(rows, [0], limit));
        }
    });

    it("replays all candidates with the legacy comparator for non-finite distances", () => {
        const cases: ExactVectorRow[][] = [
            [
                { fact_id: "far", embedding: encode([4]) },
                { fact_id: "overflow", embedding: encode([Number.MAX_VALUE]) },
                { fact_id: "near", embedding: encode([0.25]) },
            ],
            [
                { fact_id: "nan", embedding: encode([Number.NaN]) },
                { fact_id: "near", embedding: encode([0.25]) },
                { fact_id: "far", embedding: encode([4]) },
            ],
        ];

        for (const rows of cases) {
            let passes = 0;
            const result = exactVectorTopN(() => {
                passes += 1;
                return rows;
            }, [0], 1);
            expect(result).toEqual(oracle(rows, [0], 1));
            expect(passes).toBe(2);
        }
    });
});
