# Semantic sensitivity-direction gate adversarial review

Date: 2026-08-24

## Outcome

Competitive semantic inference now fails closed unless the author-equal and
family-equal descriptive effects agree in a non-neutral direction for every
preregistered language and competitor hypothesis. Statistical significance by
the construction-cluster sign tests and Holm correction is no longer sufficient
when a conclusion reverses under family weighting.

This is an integrity-gate improvement, not new competitive-performance evidence.
The public semantic gate remains non-promotable and `claimEligible: false` until
a powered, held-out, same-input campaign covers the frozen competitor roster.

## Adversarial findings

- Direct review reproduced a false-pass boundary: all exact tests could reject
  while author-equal and family-equal effects pointed in opposite directions.
  The implementation calculated that disagreement but did not include it in
  `competitiveThresholdsPassed`.
- The first read-only opencode review found a second false-positive boundary in
  the proposed fix: `Math.sign(0) === Math.sign(0)` treated two neutral effects
  as directional agreement. The reviewer verdict was `FOUND_ISSUES`.
- The corrected implementation requires both effects to exceed the existing
  `1e-12` tie tolerance and have matching signs. Neutral and near-neutral effects
  therefore cannot satisfy the sensitivity gate.
- The strengthened reversal fixture uses ten independent construction clusters
  per language. Its exact tests reject after Holm adjustment, while its
  author-equal and family-equal directions reverse; the final competitive gate
  must remain false. A separate balanced fixture verifies that two zero means
  also fail the direction gate.

Two bounded opencode re-review attempts after the correction reached the files
but ended with retryable Azure model-server errors before a verdict. They are
recorded as `NOT_RUN`, not clean reviews. Formal `review-pass` preflight remains
`NOT_CLEAN` because the preserved unrelated untracked path
`.cache/tools/trec_eval-ba38899/` is inside the repository.

## Verification

- Focused tests: 29 passed across competitive inference, analysis plan, and the
  semantic public-gate CLI.
- TypeScript: `pnpm exec tsc --noEmit` passed.
- Biome: both changed source files passed after formatting.
- Diff whitespace check: passed.

## Remaining publication boundary

Existing lifecycle campaign traces are small generated diagnostics with only a
few repetitions and incomplete competitor coverage. They do not establish
held-out generalization or public superiority over Mem0, Hindsight, Graphiti,
and Letta. The next evidence stage is a signed, same-input comparator roster and
a powered held-out campaign whose selection history prevents post-hoc case or
competitor choice.
