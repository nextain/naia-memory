# MIRACL Korean evidence-contract amendment

Date: 2026-08-23 (Asia/Seoul)

Status: post-run mechanical repair; public eligibility remains closed

## Defect

The frozen comparison contract required NIST `trec_eval` output to agree with
the runner's full-precision metrics within `1e-6`. The pinned evaluator's
aggregate stdout is emitted at four decimal places. Consequently, the original
gate could reject a mathematically matching result whenever its discarded
digits produced a delta greater than `1e-6`.

This was discovered only after the full-corpus run completed, when the pinned
evaluator reported `0.6526` and `0.9233` for runner values
`0.6526027330050439` and `0.9232560345236401`.

## Outcome-independent repair

The verifier now requires exact equality between each evaluator value and the
corresponding runner value rounded to four decimal places. It records the raw
delta and declares `5e-5` as the maximum representational delta. A neighboring
four-decimal value is rejected even if future floating-point behavior made a
generic tolerance comparison ambiguous.

The repair applies symmetrically to every possible score and does not change
the TREC run, qrels, ranking, evaluator binary, evaluator invocation, or either
metric implementation. Tests cover acceptance of the exact rounded value and
rejection of the neighboring value.

## Claim boundary

This amendment can establish local metric reproduction only. It does not make
the run independently executed, does not attribute base-model retrieval quality
to Naia's lifecycle logic, and does not open the public competitiveness gate.
