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

## Post-launch disclosure correction (score still unseen)

This section was added after the run started, in response to adversarial review,
while no effectiveness score was available. It is not preregistered content.
The original frozen document is commit `042d7ff` with SHA-256
`e9adaf9d88617673b5856c91e9d6549eb4765724abc13a9e44aa55cbf0cd3a9e`.
The retrieval policy, source locks, corpus, queries, and metrics were not changed.

- The `multilingual-e5-large` model card reports that MIRACL **training-split**
  examples were included in model training. This run does not use development
  labels for tuning, but it is not a dataset-family-zero-shot evaluation.
- `successAt1`, `successAt5`, and `successAt10` in the result are binary Hit
  Rate@1, Hit Rate@5, and Hit Rate@10: the fraction of queries with at least one
  positive passage in the corresponding prefix. They are not reciprocal rank.
- Reported query latency spans query embedding plus exact Qdrant search. It must
  be labelled end-to-end query latency, not search-only or index latency.
- The active Qdrant service reports version `1.15.5`, commit
  `48203e414e4e7f639a6d394fb6e4df695f808e51`. The final receipt must bind this
  service identity together with the result and evaluator artifacts.
- The result's `policyReceipt` is the machine-readable record of model revision,
  q8 quantization, `query: ` / `passage: ` prefixes, mean pooling,
  normalization, and maximum token length. The result's `cpuOnly` field and the
  launch environment receipt record the runtime device constraint; the final
  evidence receipt must bind both records rather than implying that either one
  contains the complete execution identity.
