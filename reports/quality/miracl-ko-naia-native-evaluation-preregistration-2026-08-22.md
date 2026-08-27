# Naia native Korean candidate diagnostic preregistration

Date: 2026-08-22
Status: frozen before candidate document text extraction, embedding, or Naia effectiveness inspection

## Claim boundary

This is a label-conditioned, 20,015-document MIRACL Korean diagnostic. It is
not a full-corpus MIRACL run, not a leaderboard score, and not evidence that
Naia beats a global engine. Candidate selection used relevance labels and two
independent full-corpus runs, so absolute effectiveness is optimistic.

## Frozen system under test

- Product retrieval function: `searchLocalSemanticMemory`, unchanged.
- Search mode: default RRF, combining Naia's Korean-normalized BM25 rank and
  cosine-vector rank with `RRF_K=60`.
- Embedding: `Xenova/multilingual-e5-large` revision
  `00fc3aeb3dbb95842de2ac1961d33c6319acf57b`, q8, CPU only, normalized mean
  pooling, `query: ` / `passage: ` prefixes, 512-token truncation.
- Candidate pool: v2 document list SHA-256
  `e758692d71d0ab640927f3d9aaad741b88952b22e25707130adfe8e6d903ef08`.
- Passage text: `title + "\n" + text`; no entities or topics are derived.
- Every document is an active neutral fact with identical importance, emotion,
  timestamps, recall count, and project scope. KG spreading and reranking are
  disabled. `deepRecall=true` removes strength from final scoring; MMR is off.
- Queries: all 213 locked MIRACL Korean development topics, unchanged.
- Returned depth: 100.

These controls prevent memory lifecycle, emotion, entity extraction, or an LLM
from injecting benchmark-specific relevance. They also mean the diagnostic
tests retrieval, not Naia's update/supersession value.

## Frozen outputs and metrics

The run must emit a top-100 TREC ranking, per-query comparisons, timing, model
policy receipt, immutable input/output hashes, and aggregate binary-relevance
nDCG@10, recall@10, recall@100, MRR, and success@1/5/10. Duplicate document IDs,
missing queries, fewer than 100 results, missing candidates, invalid vectors,
or any GPU-visible execution invalidate the run.

The primary diagnostic is Naia RRF. Vector-only and Naia-BM25-only are ablations,
not separately tuned competitors. The official full-corpus BM25 and mContriever
scores remain source qualifications only and must not be presented as same-pool
head-to-head baselines.

## Decision rule

No public competitiveness claim follows from this diagnostic alone. A useful
result must survive adversarial review and then be replicated on locked
full-corpus Korean plus English and Arabic. Regression or weak ablation evidence
is recorded rather than tuned away after inspection.

## Post-run clerical erratum

The original Markdown revision ended in `57b2`; the executable preregistration
committed at `f35c9d1` pinned `OFFLINE_MODEL_REVISIONS["multilingual-e5-large"]`
ending in `57b`. The run receipt confirms the executable value. This correction
changes no code, candidate, model artifact, query, ranking, or metric.
