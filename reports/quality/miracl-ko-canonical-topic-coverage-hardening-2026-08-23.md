# MIRACL KO canonical topic coverage hardening — 2026-08-23

## Outcome

The final full-corpus evidence validator now requires the TREC run to contain
exactly the 213 query IDs from the pinned MIRACL Korean development topics,
with exactly 100 results for each ID. A run can no longer substitute an
arbitrary query ID while preserving query count, depth, and internally
consistent artifact hashes.

This is evidence-integrity hardening, not a retrieval-quality improvement.
It does not change embeddings, ranking, corpus ingestion, or the active
full-corpus run.

## Closed bypass

The previous validator called `validateTrecRunCoverage` with `run.keys()` as
its own expected set. Consequently, replacing one canonical query ID with an
unknown ID still passed whenever the run retained 213 queries and depth 100.

The validator now compares against the pinned canonical MIRACL KO development
topic-ID set. It also fails module initialization if that set does not contain
exactly 213 unique IDs. The regression test substitutes topic `1582` with
`999999`, rehashes the run and result consistently, and verifies rejection.

## Validation

- Focused: 2 test files, 13 tests passed.
- TypeScript: `pnpm exec tsc --noEmit` passed.
- Biome and diff checks are required again after the report is added.
- Full-suite result is recorded in issue #39 after execution.

## Adversarial review

OpenCode `opencode/big-pickle` inspected the exact source diff and complete
evidence validator, tests, and shared MIRACL parser. The run ended without a
final verdict after reading the relevant files, so this is recorded as
PARTIAL / NOT PASS. No independent-review pass is claimed.

The remaining trust boundary is explicit: the topic-ID set is pinned in the
validator and the topic artifact SHA-256 is pinned in the source lock, but the
ID list is maintained source code rather than independently signed external
attestation. Public eligibility remains false until an outside runner provides
signed execution evidence.

## Active run

The CPU-only MIRACL Korean full-corpus process remained alive during this
change. The latest observed persisted receipt was
`chunk-000782336.receipt.json`, representing 782,848 of 1,486,752 documents
(approximately 52.7%). GPU1 was not used.
