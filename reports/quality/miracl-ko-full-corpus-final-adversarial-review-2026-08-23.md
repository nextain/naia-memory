# MIRACL-ko full-corpus adversarial review

Date: 2026-08-23

## Review scope

An OpenCode `big-pickle` high-effort, read-only review attempted to falsify the
post-run metric-precision amendment, source/checkpoint/Qdrant/runtime binding,
metric transcription, historical-row transcription, training overlap, benchmark
overfit, and claim scope. It inspected the benchmark implementation, tests,
contract, result, TREC run, evidence receipt, comparison projection, source lock,
checkpoint chain, and Qdrant membership audit.

This is a scoped adversarial review, not a formal `review-pass` CLEAN result.
Formal preservation inputs were unavailable and unrelated files already existed
under `.cache/tools/trec_eval-ba38899/`.

## Verdict

`PASS` with no blocking findings.

The reviewer independently reproduced the artifact hashes, 213-query by
100-result run shape, topic identity, four-decimal `trec_eval` values, comparison
deltas, and the six Korean rows from MIRACL Table 5. It found no path by which
the post-run amendment could selectively rescue this score: the amendment
matches the fixed evaluator precision and does not alter rankings or run bytes.

## Follow-up applied

- The implementation now enforces the receipt's `5e-5` representational bound
  in addition to exact equality after four-decimal formatting.
- The contract defines `MATCHES_OR_EXCEEDS_BOTH` as both metrics meeting the
  frozen resolution with at least one exceeding it. A statement that both
  exceed still requires both deltas to exceed `0.001`.
- The reported ingestion duration is not treated as comparative performance.
  Its semantics are not defined tightly enough to reconcile its 70,518-second
  value with the shorter launch-to-observation wall-clock interval.

## Remaining non-blocking limits

- Qdrant membership is audited at publication time rather than query time.
- JavaScript and C formatting could differ on a measure-zero exact rounding tie.
- The evaluator output precision should be preregistered before future runs.
- The model used MIRACL training data, so this is not dataset-family zero-shot.
- The local operator trust boundary is not independent-lab evidence.

These limits preserve `publicClaimEligible: false`.
