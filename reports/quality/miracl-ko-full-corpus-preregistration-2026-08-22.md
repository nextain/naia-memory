# MIRACL Korean full-corpus vector retrieval preregistration

Date: 2026-08-22 (Asia/Seoul)

Status: frozen before the first full-corpus Naia run

## Question and claim boundary

This stage asks whether Naia Memory's currently shipped Korean-capable embedding
policy retrieves judged passages from all 1,486,752 MIRACL Korean documents. It
is a full-corpus embedding-retrieval measurement, not a complete memory-engine
comparison. It does not measure memory creation, update, contradiction handling,
temporal validity, consolidation, lexical fusion, reranking, or approximate-index
quality. The result may be compared with full-corpus MIRACL Korean retrieval
runs only when dataset split, metric definition, and passage/query encoding are
compatible.

## Frozen inputs and policy

- Dataset: MIRACL v1.0 Korean development topics and qrels, 213 queries
- Corpus: MIRACL Korean v1.0, all 1,486,752 documents
- Dataset revision: `5be20db9509754dadad47689368639fcec739c00`
- Corpus revision: `d921ec7e349ce0d28daf30b2da9da5ee698bef0d`
- Source files: the five size- and SHA-256-locked files in `MIRACL_KO_LOCK`
- Embedding policy: Naia `multilingual-e5-large` offline provider at its locked
  model revision, CPU device
- Passage composition: title, one newline, then passage text
- Vector distance: cosine
- Retrieval: exact Qdrant search, depth 100
- Metrics: MRR, Recall, Hit Rate, nDCG from the repository metric contract, plus
  mean per-query Recall@100

No Korean relevance labels are used for model selection, corpus reduction,
negative selection, parameter tuning, or index construction.

## Execution and integrity gates

- `CUDA_VISIBLE_DEVICES` must be exactly empty; GPU1 is not used.
- Every source file must pass its locked byte-size and SHA-256 checks before
  execution.
- Corpus order, source lock, model policy, passage composition, vector shape,
  vector bytes, document IDs, and the previous chunk receipt are hash-bound.
- A completed chunk is immutable. An interrupted uncommitted chunk may remove
  only its exact `.f32` and `.docids` partial outputs before recomputation.
- Qdrant point IDs are deterministic corpus ordinals, so replayed upserts are
  idempotent. The final point count must equal 1,486,752.
- Every query must return exactly 100 unique document IDs.
- Temporary result files use exclusive creation and atomic rename. The JSON
  result is the final commit marker and includes the TREC SHA-256; a lone TREC
  file after interruption is not valid evidence and may be atomically replaced.

Any gate failure is a failed run, not a score. Any policy change requires a new
versioned preregistration and fresh collection/cache identity.

## Interpretation before seeing the result

The score can establish the quality of Naia's base multilingual vector retriever
on an independent Korean full corpus. It cannot by itself establish that Naia is
the best global memory engine or that Naia's lifecycle/update semantics are
better. A public competitive report additionally requires protocol-matched
external baselines and independent adversarial review of metric compatibility.
