# MIRACL English corpus identity artifact bundle review (2026-08-24)

## Outcome

The English completion-evidence path now embeds the canonical corpus identity
receipt instead of referring only to its launch-time digest. A verifier can
therefore recompute the receipt digest from the evidence bundle and check the
same source-lock value against both launch and result evidence.

This closes an evidence-portability gap. It does **not** prove atomic corpus
bytes, retrieval quality, multilingual superiority, or state of the art.

## Bound chain

The completion producer fails closed unless all of the following agree:

1. raw receipt bytes equal the canonical serialization;
2. the canonical receipt digest equals the launch receipt's identity digest;
3. the receipt source lock equals the launch source lock;
4. the same source lock equals the result source lock; and
5. the post-read digest equals the canonical receipt digest.

Non-English completion rejects an identity artifact input, and non-English
launch-chain verification rejects non-null English-only identity fields.

## Deterministic verification

- Focused Vitest suites: 3 files, 20 tests passed.
- TypeScript: `pnpm exec tsc --noEmit` passed.
- Patch hygiene: `git diff --check` passed.
- Mutation coverage includes missing path/text, non-canonical bytes, launch
  digest drift, launch/result source-lock drift, missing or changed post-read
  digest, non-English artifact inputs, and non-English launch-field smuggling.

## Adversarial review ledger

- DeepSeek V4 Pro first review found no fail-open or false binding. Its useful
  test-coverage notes (missing post-read digest, returned receipt assertion,
  and individual non-English inputs) were independently checked and added.
- DeepSeek V4 Pro fresh review found no actionable correctness defect. Its
  remaining notes were redundant canonical defense, the existing fail-closed
  two-read pattern, and assertion-message precision.
- GPT-5.4 Nano was `NOT_RUN` because the provider rate limit was exceeded.
- Big Pickle was `NOT_RUN` after producing no review within the bounded wait.
- The repository-wide review preflight was `NOT_CLEAN` before model voting
  because an unrelated untracked cache path,
  `.cache/tools/trec_eval-ba38899/`, is outside its safe review-path policy.
  The cache was preserved rather than deleted.

Accordingly, this is a scoped adversarial review backed by deterministic tests,
not a formal multi-reviewer `review-pass CLEAN` claim.

## Live Arabic run status at review time

The pinned Arabic exact-vector run remained active on CPU. Qdrant collection
`naia_miracl_ar_6f67a375_777d3b92` was green with optimizer status `ok`,
1,213,440 of 2,061,414 expected points (58.86%), and zero indexed vectors.
This is progress evidence only, not a completed quality result.
