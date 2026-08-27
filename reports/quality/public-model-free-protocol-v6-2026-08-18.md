# Public evidence protocol v6: model-free scoring clarity

## Outcome

The public evidence manifest now describes the scorer that is actually run. Schema v6 removes the unused `answerModel` and `judgeModel` fields, pins the accepted schema version during both shape and semantic validation, and requires the protocol object to contain exactly the eight supported fields.

This is an evidence-integrity improvement, not a retrieval-performance improvement. It does not establish that Naia Memory is better than another engine.

## Why the change was necessary

`exact-current-hit-at-k-v1` deterministically replays opaque retrieved IDs and rejects forbidden or stale IDs in the frozen top-k window. It does not invoke an answer model or a judge model. Keeping those identities in the manifest could make a model-free comparison look model-mediated and invite invalid fairness conclusions.

## Adversarial review

The first review proposed binding the two model fields to every engine. A challenge review rejected that recommendation because it conflated internal engine dependencies with nonexistent scorer dependencies. The corrected decision was to remove the dead fields and version the contract.

A fixed-tree review then found two concrete weaknesses: the shape guard did not independently pin the schema version, and the tests lacked positive-v6 and mislabeled-v5 controls. Both were corrected. The final fixed-tree OpenCode review returned `VERDICT: CLEAN`.

## Verification

- Biome passed on all four changed source and test files.
- Full test suite passed: 37 files, 502 tests.
- Strict main and benchmark type checks passed.
- Production build passed.
- The tests reject legacy v5 manifests, v5 labels carrying a v6 shape, and v6 protocol objects carrying removed model fields.

## Remaining publication gate

Public comparative claims remain blocked. The next evidence must come from an independently governed Korean/English/Japanese corpus and verifier-challenged, same-input receipts from Naia Memory and at least two credible global memory engines. Until those artifacts exist, this work supports only protocol clarity and tamper-evident intake—not global quality, multilingual generalization, or superiority.
