# Native retrieval publication contract (pre-registration)

Status: **pre-registered; public competitiveness claim remains NO-GO**

This contract was written after the 2026-08-22 adversarial planning review and
before any native-corpus validation result was inspected. The frozen HNSW
candidate is `m=128`, `ef_construct=800`, `hnsw_ef=2048`; sealed validation must
evaluate that single candidate and must not select a value on validation data.

## Claims kept separate

1. **ANN preservation** asks whether Qdrant HNSW preserves an independently
   verified brute-force ranking on the same vectors. It does not establish that
   the embedding model retrieves useful memories.
2. **Retrieval effectiveness** uses dataset judgments and labels any reduced
   candidate pool explicitly. A label-conditioned pool is a diagnostic and must
   not be called an official MIRACL score.
3. **Memory-engine competitiveness** requires the same memory events, update and
   delete operations, queries, model, and judge inputs across Naia Memory and
   external engines. Retrieval-only evidence cannot establish this claim.

No result may be promoted across these claim boundaries.

## Native-language evidence

- Korean, English, and Arabic: MIRACL, pinned to immutable dataset revisions and
  hashes. The official MIRACL table includes Korean (868 train and 213 dev
  queries); an adversarial-review claim that MIRACL lacked Korean was rejected
  after checking the primary dataset source.
- Translated English/Korean pairs do not qualify as independent multilingual
  evidence.
- Languages are reported independently. Equal absolute subset sizes do not
  authorize cross-language comparisons because their source-corpus sampling
  densities differ.

## Candidate-pool validity

A `positive + hash-random filler` pool is forbidden as publication evidence: it
removes the near-miss neighbors that make ANN difficult. A reduced pool must
either include independently generated dense and lexical hard negatives from
the full corpus, or be labeled `random-subset diagnostic` with no MIRACL or
language-comparison claim. The receipt records source corpus size, retained
fraction, positives, hard negatives, random fillers, duplicates, and excluded
queries. A hard-negative diagnostic additionally requires a pre-registered
per-query depth and minimum unique-hard-negative ratio; shared hub documents
must not let a near-random pool pass. The receipt binds the corpus, labels,
full-corpus retrieval run, retrieval source and seed by SHA-256 or immutable
identifier.

## Metrics and gates

- Any-hit rates are named `success@1`, `success@5`, and `success@10`.
- Multi-positive `recall@10` is set recall, not any-hit success.
- Effectiveness reports `nDCG@10`, `recall@100`, MRR, query count, and bootstrap
  confidence intervals where the candidate pool supports those depths.
- ANN preservation reports exact-ID top-1 agreement, top-10 overlap, absolute
  metric deltas, and per-build raw values.
- Effectiveness regressions are reported with confidence intervals. No fixed
  delta is accepted or rejected without a query-count-aware uncertainty bound.
- Publication validation must independently check exact search against CPU brute-force cosine on a
  pre-registered query sample.

Provisional ANN thresholds remain top-10 overlap at least 0.98 and exact-ID
top-1 agreement at least 0.99 in every build. A build is invalid only for a
pre-result infrastructure failure (service crash, receipt write failure, or
resource-limit termination); invalidation reason and partial output remain in
the evidence ledger. These thresholds are not a competitiveness threshold and
may not be relaxed after validation.

## Independence and receipts

- Five builds use receipt-bound insertion-order permutations. Identical build
  outputs are treated as evidence of determinism, not five independent samples.
  The runner fails closed unless all five insertion-order digests are distinct.
- The embedding receipt pins model revision, dtype, dimensions, query/passage
  prefixes, title concatenation, pooling, normalization, tokenizer limit, and
  truncation. Its complete digest is part of the vector-cache key.
- Publication runs start from a cold vector cache; cache manifests include the
  resolved key and vector-binary SHA-256.
- Every sealed attempt, including failed attempts, is appended to the evidence
  ledger and retained. Re-running a different candidate under the sealed label
  is forbidden.
- `exact: true` explicitly bypasses HNSW; candidate `hnsw_ef` is supplied as a
  per-query search parameter. `full_scan_threshold` is not treated as proof of
  either path. Exact and approximate calls use equal warm-up counts, but the
  current exact-first latency values remain diagnostic because call order is not
  randomized. Publication latency requires an interleaved/randomized order.
  QPS is reported only from a defined concurrency load test. Peak memory comes
  from a fresh Qdrant process/container cgroup and index size after flush/settling.
- Receipts include source revisions and hashes, code commit, command and
  parameters, Qdrant image digest/version, CPU and memory limits, storage,
  transport, timestamps, failure accounting, and all exclusions.

## Stop conditions

The run fails closed on multiple sealed ef candidates, missing immutable source
revisions, stale/ambiguous vector caches, absent brute-force oracle checks,
label-conditioned results presented as official effectiveness, incomplete
resource receipts, or post-validation threshold/parameter changes. Failed runs
remain in the evidence ledger and are never silently replaced.

## Remaining publication gate

Public competitiveness remains **NO-GO** until native Korean plus independently
authored non-Korean evidence passes, same-input external memory engines have
reproducible receipts, update/delete behavior is measured separately from ANN,
and a fresh adversarial review finds no critical claim-validity issue.

## 2026-08-22 adversarial review disposition

OpenCode returned `FOUND_ISSUES`. Its two claimed Qdrant path failures were
rejected: `exact: true` is the explicit exact-search switch, while `hnsw_ef` is
intentionally a query parameter rather than a collection field. The useful
findings were accepted: the runner now verifies five distinct insertion-order
digests, and exact-first latency is explicitly non-publication diagnostic.
Claude's parallel review was interrupted before a verdict, so it is recorded as
`NOT_RUN`, not a pass. Recovery mode prevents a formal review-pass `CLEAN` claim.
