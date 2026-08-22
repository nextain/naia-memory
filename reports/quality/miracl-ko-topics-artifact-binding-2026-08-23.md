# MIRACL KO topics artifact binding — 2026-08-23

## Outcome

The final full-corpus evidence receipt now includes the canonical MIRACL
Korean development topics artifact path and SHA-256. Receipt creation requires
the evaluation result's topics hash, the independently reread topics file
hash, and the pinned source-lock hash to be identical. The artifact path must
end with the canonical source-lock path.

This hardens evidence provenance only. It does not change retrieval behavior,
latency, or quality metrics.

## Adversarial review

OpenCode `opencode/big-pickle` reviewed the exact diff and complete evidence
CLI, validator, tests, shared MIRACL parser, and evaluation result producer. It
returned PASS for the hash binding and identified two non-blocking gaps:

1. the receipt accepted an arbitrary topics path paired with the canonical
   hash;
2. tests did not cover a result and input that consistently claimed the same
   non-canonical topics hash.

Both findings were fixed. The path now has to match the canonical source-lock
suffix, and regressions cover both consistent non-canonical hashes and path
substitution.

A follow-up OpenCode run read the revised diff, complete validator, CLI,
evaluation producer, tests, and shared source lock, but ended without a final
verdict. It is recorded as PARTIAL / NOT PASS; the initial PASS applies only to
the pre-fix review whose findings were then implemented.

## Verification

- Full suite: 125 files, 1,026 tests passed.
- Focused post-format rerun: 1 file, 8 tests passed.
- TypeScript `--noEmit`: passed.
- Scoped Biome and `git diff --check`: passed.
- An intermediate full-suite command found six fixture failures after path
  validation was introduced. The fixture used `/inputs/topics.tsv`; it was
  corrected to the pinned MIRACL relative path before the successful rerun.

## Claim boundary

The receipt remains `self-observed-local` and `publicClaimEligible: false`.
Direct artifact binding makes local evidence harder to mislabel, but does not
replace independently operated and signed execution evidence.
