# MIRACL multilingual transfer gate adversarial review

Date: 2026-08-24

## Outcome

The new transfer gate requires independently reproducible Korean, English, and
Arabic completion/comparison pairs before it emits a complete multilingual
campaign receipt. It deliberately emits no pooled score and keeps
`publicClaimEligible: false`.

Before observing the running Arabic score, the gate also freezes a conservative
strong-transfer interpretation: every KO/EN/AR result must exceed both reported
BM25 + mDPR metrics outside the published-row rounding tolerance. Any other
combination is `STRONG_TRANSFER_NOT_ESTABLISHED`; the threshold cannot be
changed post hoc by this receipt.

This corrects the executable evidence boundary behind an older report that
named English and Japanese as the next transfer gate. The frozen source contract
and implemented campaign are Korean anchor plus English and Arabic transfer;
the historical report is not rewritten.

## Adversarial findings

- Direct review found a blocking CLI defect: the documented invocation has
  eight arguments while the initial implementation accepted seven. The normal
  path could never run. The check now requires eight, and an end-to-end CLI test
  covers successful creation, overwrite refusal, and missing-input refusal.
- A second direct boundary review found that the existing `ABOVE_BOTH` label
  could allow one metric to remain inside the 0.0005 published-row rounding
  tolerance when the other metric improved materially. The strong-transfer
  gate now compares both metrics numerically against baseline + 0.0005, and a
  one-metric-inside-tolerance mutation test fails closed.
- Omitted and duplicate languages fail closed.
- Input order cannot alter the canonical KO/EN/AR output order.
- Each supplied comparison is regenerated from its paired completion evidence;
  a modified metric or detached comparison is rejected.
- Completion is explicitly not interpreted as SOTA, memory-engine superiority,
  or a pooled multilingual quality claim.

Two bounded headless adversarial-review attempts (`opencode/hy3-free` and
`opencode/mimo-v2.5-free`) returned no result within 120 seconds; an
`opencode/x-preview-f-free` attempt exited without a review. All are recorded as
`NOT_RUN`, not as clean reviews. Formal `review-pass` preflight is also
`NOT_CLEAN` because the preserved unrelated untracked path
`.cache/tools/trec_eval-ba38899/` is inside the repository.

## Verification

- Focused tests: 20 passed across the transfer gate and language comparison.
- TypeScript: `pnpm exec tsc --noEmit` passed.
- Biome: changed code and package manifest passed after formatting.
- Diff whitespace check: passed.

## Remaining publication boundary

The gate cannot be produced until the running Arabic evaluation and the required
English evaluation finish and their evidence bundles reproduce. It addresses
language-selection and score-pooling overfit, but it does not address
MIRACL-family model-training overlap or prove Naia-specific memory lifecycle
value. Same-input lifecycle competitors and powered repeated inference remain
separate public-report requirements.
