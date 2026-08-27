# Qdrant HNSW exact-search quality gate — 2026-08-22

## Decision

**Advance `hnsw_ef=64` to a 100k-fact validation; do not integrate or publish a scale claim yet.**

After fixing a benchmark bug that silently excluded multi-gold queries, `hnsw_ef=64` passed all six independent builds. Its worst top-1 agreement was 99.03%, worst top-10 overlap was 99.47%, and worst Recall@10 loss was 0.0049, within the predeclared floors. The final gate uses three independently rebuilt indexes per language and accepts every declared answer for multi-gold queries.

This is useful evidence that HNSW can replace deep linear search without materially changing ranked results at this scale. It is not evidence of global competitiveness or production-scale latency.

## Measured setup

- Engine: Qdrant 1.18.2, local REST service, CPU only
- Embeddings: pinned `multilingual-e5-large` q8, 1,024 dimensions, query/passage prefixes
- Per language: 310 labeled v2 rows plus 1,000 namespaced legacy facts used only as background distractors; 1,310 indexed vectors total
- Source queries per language: 241; 206 answer-bearing queries are ranked and 35 explicit `fact_ref: NONE` negative/general-knowledge queries are accounted for but excluded from a positive-retrieval metric
- Exact baseline: Qdrant `exact=true`
- Candidate: actual completed HNSW index (`indexed_vectors_count=1,310`), `m=16`, `ef_construct=100`, `full_scan_threshold=10`
- Candidate sweep: `hnsw_ef` 16, 32, 64, 128, 256, 512; three independent index builds per language and three repetitions per query
- Repeat gate: every approximate top-10 ranking must remain identical across all three repetitions

| Language | ef | worst exact top-1 agreement | worst top-10 overlap | worst Recall@10 loss | worst MRR loss | 3-build gate |
|---|---:|---:|---:|---:|---:|---|
| Korean | 64 | 99.03% | 99.66% | 0.0049 | 0.0049 | pass |
| Translated English | 64 | 100.00% | 99.47% | 0.0049 | 0.0005 | pass |

`ef=64` is a quality-preserving candidate at 1,310 vectors, not a production default: the 100k gate must still show whether its quality and latency remain useful at the required scale.
Loss is defined as exact minus approximate; a negative value means the approximate ranking scored slightly higher, generally because of near-tie ordering rather than a claimed quality gain.

## Adversarial findings

Two invalid intermediate results were rejected rather than reported as wins:

1. The 1,000-row legacy corpus used `F48` while v2 queries used `F048`, initially producing zero labeled recall.
2. Normalizing IDs exposed a deeper semantic mismatch between the legacy corpus and v2 queries: exact Recall@10 remained about 1%, so that run could not validate semantic preservation.
3. The first multi-build run treated array-valued `fact_ref` as a scalar and evaluated only 172 queries. The corrected run evaluates all 206 answer-bearing queries and records all 35 explicit negative queries separately.

The final run uses the semantically matched v2 corpus for labels and namespaces legacy rows only as distractors. The relatively modest exact baseline (Korean Recall@10 56.31%, translated English 38.83%) also shows that HNSW does not solve the embedding/ranking ceiling; it only preserves it efficiently. Exact Recall@10 was stable across builds, while exact MRR varied slightly (Korean 0.3072–0.3080; translated English 0.2388–0.2396), consistent with nondeterministic ordering among near-tied results. The 100k gate should retain scores and add tie-aware agreement rather than overinterpreting this ordering noise.

The current `@qdrant/js-client-rest` 1.13 client failed under Node 26 because of an `undici` compatibility error. This benchmark therefore used Qdrant's REST API directly. Product integration must first update or replace that client path and test `QdrantAdapter` end to end.

## Limits and next gate

- English is translated from Korean, not independently authored multilingual evidence.
- The 1,000 background facts are reused legacy data, not an independent scale corpus.
- 1,310 vectors are below the project's 100k minimum for any scale or latency claim.
- Local REST timing is noisy and is not used as a product performance claim.
- Lifecycle update/delete correctness and competing engines are outside this experiment.

Next: build a deterministic 100k distractor expansion with contamination checks, rerun the multi-build exact-vs-HNSW gate, and test the product `QdrantAdapter` on a supported Node/client combination. Public status remains **NO-GO**.

Machine-readable receipt: [`hnsw-exact-gate-2026-08-22.json`](./hnsw-exact-gate-2026-08-22.json)
