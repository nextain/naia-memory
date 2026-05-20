# Naia Memory: Technical Specification (v6.0)

## Core Philosophy: Self-Rigor
- **No Magic Numbers**: All retrieval weights must be empirically derived.
- **Scale Verification**: Minimum 100k fact corpus required for performance claims.
- **Honest Latency**: Report both Surface (Tier 1) and Deep (Full scan) metrics separately.

## Implementation Details
### 1. Hybrid Storage Engine
- **Relational**: SQLite 3 (better-sqlite3) for metadata and episodic storage.
- **Keyword**: FTS5 with BM25 ranking for exact-match recall.
- **Vector**: `sqlite-vec` (vec0) for semantic similarity (Brute-force linear scan).
- **Temporal**: R-Tree index for O(log N) point-in-time and interval queries.

### 2. Async Architecture (v6.0)
- **Worker Isolation**: All DB I/O moved to a dedicated Node.js Worker Thread.
- **Non-blocking**: Prevents Main Thread (UI) freeze during heavy recall or decay cycles.
- **Message Protocol**: Command-based communication with monotonic ID tracking.

### 3. Tiered Recall Strategy
- **Tier 1 (Surface)**: Top 10,000 facts by strength/importance (Target: < 25ms).
- **Tier 2 (Deep)**: Full corpus scan (O(N) linear scan bottleneck).

## Measured Benchmarks (100,000 Facts)
| Metric | Dataset | Result |
| :--- | :--- | :--- |
| Surface Recall Latency | 10k Hot / 100k Total | **9.74ms** |
| Deep Recall Latency | 100k Exhaustive | **~80ms** |
| Backup Throughput | 10k Records | 4.3MB (Encrypted) |
| Data Integrity | Bi-temporal Range | 100% Precision |

## Resolved Blockers (Adversarial Fixes)
- **P0-1 (Claude)**: Full scan sort on 100k rows in RRF. Fixed via Materialized CTEs.
- **P0-2 (Gemini/Codex)**: Bi-temporal context pollution. Fixed via gated relevance filters.
- **P1-1 (Gemini/Codex)**: Backup OOM risk. Fixed via chunked serialization.

## Current Technical Debt (v6.0)
1. **Linear Scan**: Deep recall degrades linearly; ANN (HNSW) required for 1M+ facts.
2. **Memory KG**: Full KnowledgeGraph load in RAM; incremental/streaming load required.
3. **JS Overhead**: Worker message-passing adds ~2ms overhead; Rust-layer FFI optimization potential.
