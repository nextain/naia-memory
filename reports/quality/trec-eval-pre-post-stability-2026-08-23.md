# trec_eval pre/post stability evidence — 2026-08-23

## Outcome

The MIRACL full-corpus evidence CLI now hashes the TREC run, qrels, and
`trec_eval` binary before and after evaluator execution, and resolves the
evaluator source commit before and after execution. Receipt creation requires
all pre/post values to equal the already pinned artifact hashes and commit, and
records the stability values in the evaluator receipt.

This detects persistent input, binary, or source-revision drift across metric
evaluation. It does not improve retrieval quality or benchmark scores.

## Adversarial boundary

OpenCode `opencode/big-pickle` read the exact diff and all affected source and
test files but ended without a final verdict. The review is PARTIAL / NOT PASS.

Pre/post equality is not a complete defense against a hostile same-user local
process that transiently substitutes an artifact during evaluator execution
and restores the pinned bytes before the post-read. The receipt remains
`self-observed-local`, not an independent signed execution attestation. A
stronger future boundary would execute from immutable, externally attested
artifacts or inherited open descriptors under an independent runner.

## Verification

- Focused evidence tests: 1 file, 8 tests passed.
- TypeScript `--noEmit`: passed.
- Full-suite, Biome, and diff checks are recorded in issue #39 after final
  execution.
