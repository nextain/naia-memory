/**
 * Exact vector ranking used by the SQLite worker.
 *
 * The caller is responsible for making the input iterable the result of the
 * candidate SQL. Keeping ranking here lets the worker discard embeddings
 * before they cross the worker boundary while retaining the adapter's
 * Float32 storage and JavaScript-number distance semantics.
 */

export interface ExactVectorRow {
    fact_id: string;
    embedding: Uint8Array | ArrayBuffer;
}

export interface ExactVectorMatch {
    fact_id: string;
    distance: number;
}

export type ExactVectorRowSource = () => Iterable<ExactVectorRow>;

interface RankedVectorMatch extends ExactVectorMatch {
    sequence: number;
}

function compareRank(a: RankedVectorMatch, b: RankedVectorMatch): number {
    const distanceOrder = a.distance - b.distance;
    return distanceOrder === 0 ? a.sequence - b.sequence : distanceOrder;
}

function isWorse(a: RankedVectorMatch, b: RankedVectorMatch): boolean {
    return compareRank(a, b) > 0;
}

function siftUp(heap: RankedVectorMatch[], index: number): void {
    while (index > 0) {
        const parent = (index - 1) >> 1;
        if (!isWorse(heap[index], heap[parent])) break;
        [heap[index], heap[parent]] = [heap[parent], heap[index]];
        index = parent;
    }
}

function siftDown(heap: RankedVectorMatch[], index: number): void {
    while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let worst = index;
        if (left < heap.length && isWorse(heap[left], heap[worst])) worst = left;
        if (right < heap.length && isWorse(heap[right], heap[worst])) worst = right;
        if (worst === index) break;
        [heap[index], heap[worst]] = [heap[worst], heap[index]];
        index = worst;
    }
}

function asBuffer(embedding: Uint8Array | ArrayBuffer): Buffer {
    if (embedding instanceof ArrayBuffer) return Buffer.from(embedding);
    // better-sqlite3 returns Buffer instances. Keep their byte offset and
    // length so a driver-provided view cannot score bytes outside the BLOB.
    return Buffer.from(embedding.buffer as ArrayBuffer, embedding.byteOffset, embedding.byteLength);
}

function exactDistance(embedding: Uint8Array | ArrayBuffer, query: readonly number[]): number {
    const bytes = asBuffer(embedding);
    const vector = new Float32Array(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
    );
    let squared = 0;
    for (let index = 0; index < vector.length; index += 1) {
        const delta = vector[index] - query[index];
        squared += delta ** 2;
    }
    return Math.sqrt(squared);
}

function rankRow(row: ExactVectorRow, query: readonly number[], sequence: number): RankedVectorMatch {
    return {
        fact_id: row.fact_id,
        distance: exactDistance(row.embedding, query),
        sequence,
    };
}

function publicMatches(ranked: RankedVectorMatch[]): ExactVectorMatch[] {
    return ranked.map(({ fact_id, distance }) => ({ fact_id, distance }));
}

function legacyFullSort(
    rowSource: ExactVectorRowSource,
    query: readonly number[],
    limit: number,
): ExactVectorMatch[] {
    const ranked: RankedVectorMatch[] = [];
    let sequence = 0;
    for (const row of rowSource()) {
        ranked.push(rankRow(row, query, sequence));
        sequence += 1;
    }

    // Preserve the pre-heap comparator exactly. In particular, JavaScript
    // treats a NaN comparator result as zero; adding a tie-breaker here would
    // change the legacy stable-sort behavior for malformed persisted vectors.
    ranked.sort((a, b) => a.distance - b.distance);
    return publicMatches(ranked.slice(0, limit));
}

/**
 * Return the exact best `limit` rows in candidate scan order.
 *
 * A bounded max-heap retains the worst current result at its root. Sequence
 * numbers make equal distances deterministic and preserve the first row in
 * the same way as the old stable full sort.
 */
export function exactVectorTopN(
    rowSource: ExactVectorRowSource,
    query: readonly number[],
    limit: number,
): ExactVectorMatch[] {
    // The old path always materialized and sorted every row before applying
    // Array#slice. Keep that behavior for out-of-contract limits, including
    // NaN, infinities, zero, negatives, and fractions.
    if (!Number.isFinite(limit) || limit <= 0 || limit !== Math.floor(limit)) {
        return legacyFullSort(rowSource, query, limit);
    }
    const target = Math.floor(limit);

    const heap: RankedVectorMatch[] = [];
    let sequence = 0;
    for (const row of rowSource()) {
        const candidate = rankRow(row, query, sequence);
        sequence += 1;

        // A non-finite distance cannot be safely ordered by the bounded heap:
        // the old comparator returns NaN for pairs involving NaN, and persisted
        // Float32 overflow can produce Infinity. Replay the SQL iterator so
        // the legacy full-sort result sees the complete candidate scan in its
        // original order. Normal finite vectors never retain this array.
        if (!Number.isFinite(candidate.distance)) {
            return legacyFullSort(rowSource, query, limit);
        }

        if (heap.length < target) {
            heap.push(candidate);
            siftUp(heap, heap.length - 1);
        } else if (compareRank(candidate, heap[0]) < 0) {
            heap[0] = candidate;
            siftDown(heap, 0);
        }
    }

    heap.sort(compareRank);
    return publicMatches(heap);
}
