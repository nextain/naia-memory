# Korean vector-head / RRF-tail diagnostic preregistration

Date: 2026-08-22
Status: frozen before implementation and result inspection

## Post-run protocol clarification

The frozen rule below incorrectly grouped untruncated MRR with metrics wholly
determined by ranks 1 through 10. MRR can improve when a query's first relevant
document moves within ranks 11 through 100. This was discovered after the run;
the original decision rule is retained below for auditability. The corrected
interpretation requires exact equality only for nDCG@10, success@1/5/10, and
Recall@10. MRR is reported as an observed secondary metric and is not used to
accept the intervention.

## Motivation and claim boundary

On the locked 20,015-document, label-conditioned MIRACL Korean candidate pool,
vector-only beat equal-weight RRF at the head while RRF recovered more relevant
documents by depth 100. This experiment tests whether those two observed
properties can be composed without tuning a fusion weight.

This remains a reduced-pool diagnostic. It is not a full-corpus MIRACL result,
a leaderboard comparison, or evidence of global competitiveness. Candidate
selection used labels and independent system outputs, so all absolute scores
are optimistic.

## Frozen intervention

- Add one explicit experimental search mode, `vector-head-rrf-tail`.
- On the frozen benchmark facts (empty entities/topics, neutral emotion, no
  structured metadata), returned ranks 1 through 10 must be exactly the
  vector-only ranking, in the same order. This is not asserted for richer
  production metadata whose vector-only path deliberately applies bonuses.
- Returned ranks 11 through 100 are filled, without duplicates, from the
  existing equal-weight RRF ranking. If that stream is exhausted, remaining
  vector-ranked documents are appended.
- The protected head depth is 10 because nDCG@10 is the already-declared
  primary head metric. It is not selected by a sweep.
- Vector scoring, Korean BM25 tokenization, `RRF_K=60`, embedding model and
  revision, candidate list, corpus text, all 213 queries, CPU-only execution,
  disabled KG/reranker/MMR, and shared frozen document-vector cache remain
  identical to the completed ablations.
- The harness must call `deepRecall=true`, `mode=latest`, `minConfidence=0`, and omit
  `queryIntent`; therefore strength/recency, confidence filtering, and intent
  penalties cannot reorder the composed list. The experimental mode must fail
  closed if invoked with a reranker, enabled MMR, nonzero confidence threshold,
  a query intent, a non-latest lifecycle mode, or `deepRecall=false`.
- The production default remains unchanged. This mode is experimental until a
  full-corpus multilingual gate passes.

## Hypothesis and decision rule

Compared with the already frozen vector-only result on the identical pool:

1. nDCG@10, MRR, and success@1/5/10 must be exactly equal. This is an
   implementation invariant, not an empirical quality claim; any difference
   is a failure because all those metrics are determined by ranks 1 through 10.
2. Recall@100 must be strictly greater. Equality or regression rejects the
   intervention.
3. Every query must return 100 unique candidate IDs. Input, vector-cache,
   result, and TREC hashes must be recorded.

Recall@10 is also expected to be exactly equal and will be reported. Latency is
diagnostic only: the current implementation rebuilds and scores BM25 per query,
so it is not a hardware or production-performance claim.

The empirical question is limited to whether the fixed RRF tail adds relevant
depth versus vector-only. Equal-weight RRF and vector-only are the already-run
comparators. No fusion-weight sweep is allowed on this label-conditioned pool:
choosing a weight from these same 213 judged queries would be post-hoc
overfitting. Weighted fusion may be tuned only on a separate training split and
then evaluated on locked held-out or full-corpus queries.

Passing this diagnostic only licenses the next experiment: locked full-corpus
Korean replication, followed by English and Arabic. It does not license a
production-default change or a public competitive claim. Final publication
also requires a non-degraded independent adversarial review.
