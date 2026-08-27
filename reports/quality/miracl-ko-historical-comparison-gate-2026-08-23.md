# MIRACL-ko Historical Comparison Gate — 2026-08-23

## Outcome

Added a machine-enforced comparison gate for the completed
`miracl-ko-full-corpus-naia-vector-exact-v1` evidence receipt. The gate compares
only independently reproduced `trec_eval` metrics against all six frozen
historical rows in the comparison contract and emits one of three outcomes:
`MATCHES_OR_EXCEEDS_BOTH`, `MIXED`, or `BELOW_BOTH` relative to the historical
BM25+mDPR hybrid row.

The artifact is deliberately local evidence, not a public superiority claim.
It always emits `publicClaimEligible: false` and explicitly does not establish
current SOTA, memory-engine superiority, Naia-specific innovation, multilingual
quality, or authenticity outside the local operator trust boundary.

## Anti-cherry-picking controls

- All six historical rows and both metrics are emitted; rows cannot be selected
  at invocation time.
- The benchmark identity, schema, `LOCAL_PASS` verdict, and local-only claim
  status are fixed.
- Metrics must come from the pinned NIST `trec_eval` stdout and match its hash,
  parser output, pinned version/commit/binary hash, in-process metrics, recorded
  deltas, and the fixed tolerance.
- All five attestation-binding manifest hashes are recomputed.
- Inputs are bounded and symlink-safe; outputs are exclusive and durably synced
  without overwrite.
- Beating BM25 or mDPR alone is not treated as differentiation. Matching or
  exceeding the historical hybrid on both metrics is classified only as strong
  base retrieval, not as Naia-specific innovation.

## Adversarial review

The design review first rejected a binary tier because mixed metric outcomes
could be misrepresented. A first implementation review then rejected accepting
finite but out-of-range metrics. A second review rejected shallow receipt checks
that allowed hand-edited reproduced values. Each blocker was implemented and
tested. The follow-up Claude Sonnet headless review returned **PASS** with no
blockers, while preserving the explicit limitation that internal consistency is
not independent external attestation.

This was an ordinary read-only adversarial review, not a formal `review-pass`
CLEAN claim.

## Validation

- Focused comparison tests: 13 passed.
- Full Vitest regression: 130 files, 1,076 tests passed.
- `tsconfig.json` and `tsconfig.benchmark.json`: passed with `--noEmit`.
- Biome on changed TypeScript files: passed.

## Completion use

After the full-corpus evidence receipt exists, run:

```text
pnpm benchmark:miracl-global-comparison <evidence.json> <comparison.json>
```

The generated comparison remains non-public until an execution attestation from
outside the benchmark operator trust boundary is collected and verified.
