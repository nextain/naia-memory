# HNSW 100k Scale Investigation — 2026-08-22

## Verdict

The two 100,000-vector runs do **not** establish a Naia Memory or Qdrant HNSW
scale ceiling. Both runs are rejected evidence. The deterministic synthetic
distractors occupy a substantially denser embedding region than the 1,310
source facts, so the corpus is not qualified as a representative scale test.

No public competitiveness or production-integration claim is authorized by
this investigation.

## What was tested

- Model: `Xenova/multilingual-e5-large`, pinned revision, 1,024 dimensions,
  CPU, mean-normalized query/passage embeddings.
- Corpus: 1,310 existing facts plus deterministic generated distractors to
  exactly 100,000 vectors per language.
- Queries: 206 positive and 35 explicit-negative source queries per language;
  negatives are accounted for but excluded from ranked-retrieval metrics.
- Languages: Korean and a deterministic English translation.
- Comparison: Qdrant approximate HNSW search against exact search in the same
  collection, three index builds and three repeated searches per query.
- Candidate `hnsw_ef`: 16, 32, 64, 128, 256, and 512.

The first run built while ingesting and produced 7–8 segments. A controlled
rerun uploaded with HNSW disabled, enabled indexing after ingestion, and waited
for five stable polls at no more than two segments. Both used the same
SHA-256-verified vector cache.

## Results

Neither 100k run selected an `hnsw_ef`. In the staged rerun, even `ef=512`
showed large build-to-build variation:

| Language/build | overlap@10 | top-1 agreement | recall@10 loss | MRR loss | HNSW p95 ms |
|---|---:|---:|---:|---:|---:|
| ko / 1 | 0.5874 | 0.5874 | 0.1893 | 0.1135 | 2.02 |
| ko / 2 | 0.7621 | 0.7573 | 0.1408 | 0.0698 | 2.24 |
| ko / 3 | 0.7087 | 0.7039 | 0.1699 | 0.0916 | 2.39 |
| en / 1 | 0.5903 | 0.5825 | 0.1408 | 0.0939 | 2.74 |
| en / 2 | 0.7218 | 0.7136 | 0.0971 | 0.0667 | 2.54 |
| en / 3 | 0.3092 | 0.3058 | 0.2913 | 0.1795 | 2.89 |

Staged indexing falsified the initial hypothesis that segment/build races were
the primary cause: segment count stabilized and latency improved, but quality
did not recover.

## Corpus geometry diagnosis

We sampled 10,000 deterministic, non-self vector pairs separately from the
1,310 base vectors and generated distractors. Values are cosine similarity.

| Language/set | p05 | p50 | p95 | p99 |
|---|---:|---:|---:|---:|
| ko base | 0.8005 | 0.8377 | 0.8751 | 0.8941 |
| ko generated | 0.8654 | 0.8896 | 0.9301 | 0.9464 |
| en base | 0.7359 | 0.7921 | 0.8449 | 0.8687 |
| en generated | 0.8492 | 0.8776 | 0.9189 | 0.9375 |

The generated corpus exceeds the base p50/p95/p99 by 0.052–0.055 in Korean
and 0.069–0.086 in English. The one-template generator created an unusually
dense semantic cluster. This is strong evidence of corpus pathology, but
pairwise similarity alone does not prove causality or characterize real query
neighborhoods.

## Safeguard added

The harness now computes a deterministic true-cosine geometry receipt before
Qdrant evaluation and rejects generated corpora whose p50, p95, or p99 density
exceeds the source-fact distribution by more than 0.03. The receipt includes
the measured vector-norm range. This one-sided threshold was selected after
observing these failures and is frozen only for future runs; it is a
provisional density-inflation guardrail, not a tuned performance target and not
evidence that a corpus within the threshold is representative. A future
revision must derive a two-sided policy from base-only resampling noise.

The current 100k caches fail the guardrail in both languages. That prevents
more `hnsw_ef` tuning on a known-invalid benchmark.

## Adversarial review status

A Claude Sonnet headless read-only review was requested to challenge the
corpus-pathology interpretation and proposed gate. The session read the inputs
but returned no substantive verdict. An OpenCode native-model headless review
then returned FAIL with three blockers: true-cosine enforcement, complete gate
provenance, and a machine-readable rejection artifact. All three were fixed
before commit. This is evidence of adversarial review, not independent approval.
The strongest unresolved objection is retained: marginal pairwise cosine
distributions do not measure query-to-gold versus query-to-distractor margins.

This workspace is in recovery mode, so no formal `review-pass CLEAN` claim is
made.

## Required next experiment

1. Replace the single-template distractors with a versioned, multi-domain,
   multi-form generator. Keep IDs, statements, source overlap checks, corpus
   hash, and vector-cache receipts deterministic.
2. Qualify at 10,000 vectors before another 100k embedding run. Report both
   base-vs-generated pairwise distributions and query-to-gold versus nearest
   generated-distractor margins.
3. Freeze the qualified corpus hash and geometry policy before measuring HNSW.
   Do not adjust corpus or thresholds after observing approximate-search labels.
4. Obtain a substantive independent adversarial review. Only then rerun the
   pre-registered 100k protocol.
5. Keep this scale-preservation result separate from cross-engine memory
   quality. External engines require independent adapters, equivalent state
   semantics, and a separately sealed multilingual campaign.

## Artifacts

- `hnsw-exact-scale-gate-2026-08-22.json`: concurrent-indexing run, rejected.
- `hnsw-exact-scale-gate-staged-indexing-2026-08-22.json`: staged-indexing
  controlled rerun, rejected.
- `src/benchmark/quality/hnsw-corpus-geometry.ts`: deterministic fail-fast gate.
