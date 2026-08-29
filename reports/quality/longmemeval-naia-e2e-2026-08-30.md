# LongMemEval Naia encode/retrieve E2E — 2026-08-30

Status: **H2 supported; protocol conformance only, no quality claim**

## Result

The official cleaned LongMemEval S corpus was processed twice from empty local
stores through the production `MemorySystem.encode()` and
`MemorySystem.recall()` path backed by `LocalAdapter`.

| Observation | Run 1 | Run 2 |
|---|---:|---:|
| accepted cases | 500 / 500 | 500 / 500 |
| input / stored turns | 246,750 / 246,750 | 246,750 / 246,750 |
| semantic-field round trips | 500 / 500 | 500 / 500 |
| retrieval records | 5,000 | 5,000 |
| validation errors | 0 | 0 |
| store growth | 400,557,384 bytes | 400,557,384 bytes |
| encode stage total | 3,748.97 ms | 3,372.06 ms |
| recall stage total | 14,215.24 ms | 13,127.38 ms |
| process elapsed | 27,466.06 ms | 25,682.07 ms |
| process RSS observation | 1,254,023,168 bytes | 1,248,329,728 bytes |
| `/usr/bin/time` max RSS | 2,330,520 KiB | 2,323,920 KiB |

The normalized retrieval SHA-256 was identical in both runs:

`f8042da61e83cca279def12241db4ebe860c215292fda32b93932521f8e2c5f8`

Every case also matched its input and persisted projection hashes across both
runs. The projection covers episode ID, content, speaker role, timestamp,
project scope, and disambiguated session identity.

## Fixed contract

- Source revision: `98d7416c24c778c2fee6e6f3006e7a073259d48f`
- Source SHA-256:
  `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`
- Protocol SHA-256:
  `34246761e78ebaeb1cb84db2619f5cf2d8e3a9402e2d1b101b048a7bdcea4b67`
- Engine: `MemorySystem.encode+recall/LocalAdapter`
- Embedder: `none:keyword-fallback`
- Retrieval: top-k 10, deep recall, strict project scope, no cross-project
  retrieval
- Consolidation, answer generation, and judging: disabled

The expected answer, answer-session IDs, and per-turn `has_answer` labels were
not read by the retrieval runner. This prevents answer-label tuning or leakage.

## Latency distribution

| Stage | Run 1 p50 / p95 / max per case | Run 2 p50 / p95 / max per case |
|---|---:|---:|
| encode | 6.63 / 12.71 / 64.42 ms | 6.51 / 8.09 / 15.68 ms |
| recall | 26.30 / 40.06 / 146.09 ms | 25.44 / 32.83 / 59.04 ms |

These timings measure a keyword-fallback protocol lane on this machine. They
are not transformer-embedding latency and must not be presented as production
semantic-quality performance.

## Interpretation

H2's gate is satisfied: the complete official 500-question input is accepted,
required stored semantic fields round-trip without loss, two clean executions
produce the same normalized retrieval artifact, and provenance, stage timing,
memory, disk, retrieval, and error evidence are present.

This result does **not** measure answer accuracy, abstention accuracy, or
competitive superiority. The next experiment must preregister a
protocol-matched answerer, judge, comparator revisions, prompts, and top-k
cutoffs before inspecting scores.

## Verification

- Contract and E2E tests: 4 passed.
- Benchmark TypeScript project: passed.
- Biome formatting and `git diff --check`: passed.
- Raw dataset, stores, and two detailed receipts remain untracked work
  artifacts because they total more than one gigabyte.
