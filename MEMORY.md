# Scalability & Technical Debt Ledger

## 1. Vector Retrieval: Linear Ceiling
- **Status**: Brute-force linear scan via `vec0`.
- **Constraint**: O(N) complexity. Latency is ~80ms at 100k facts and will scale to >700ms at 1M facts.
- **Requirement**: Transition to ANN (HNSW/IVF) for O(log N) retrieval.

## 2. Knowledge Graph: Memory Bound
- **Status**: Full graph serialized to JSON and held in RAM.
- **Constraint**: Graph operations (spreading activation) will trigger OOM at million-node scale.
- **Requirement**: Implement incremental subgraph loading from SQLite nodes/edges tables.

## 3. Worker Communication: Message Overhead
- **Status**: Command/Response via Node.js Worker Thread.
- **Constraint**: Serialization/Deserialization adds ~2ms jitter per query.
- **Requirement**: Optimize with SharedArrayBuffer or Rust-native background persistence.

## 4. Maintenance: Long-running Decay
- **Status**: Full table scan during Ebbinghaus decay cycles.
- **Constraint**: I/O spike during background decay may impact concurrent read performance.
- **Requirement**: Batch-limited decay processing with adaptive sleep intervals.

## Verification Log
- **2026-05-15**: v6.0 SqliteAdapter async engine dev run — Surface ~9.7ms / Deep ~80ms at 100k. NOTE(Self-Rigor): dev-machine figures, not a committed reproducible artifact — treat as targets until a benchmark report is checked in.
