# MIRACL KO qrels provenance binding

Date: 2026-08-23

## Outcome

The full-corpus evidence builder now requires the qrels artifact path to end in
the exact qrels path declared by the pinned MIRACL KO source lock. This brings
qrels provenance handling in line with the existing topics artifact binding.
The canonical qrels SHA-256 remains mandatory and is unchanged.

The evidence receipt test now asserts the emitted qrels path and hash, and a
mutation regression confirms that an arbitrary qrels path is rejected.

## Adversarial review

OpenCode headless returned `VERDICT: PASS`. It found no material substitution or
path-traversal bypass within the declared self-observed-local provenance scope.
It noted that suffix matching is not filesystem authorization: another root may
contain the same canonical suffix, but the bytes must still match the pinned
SHA-256. The error was renamed from `hash mismatch` to `provenance mismatch` so
the diagnostic does not overstate what failed.

## Verification

- Focused test: 1 file, 9 tests passed.
- Full suite: 125 files, 1,027 tests passed.
- TypeScript typecheck: passed.
- Scoped Biome check: passed before the diagnostic-only rename.
- `git diff --check`: passed before the diagnostic-only rename.

## Claim boundary

This improves artifact provenance and reproducibility; it does not improve
retrieval scores and does not establish independent execution. The full-corpus
receipt remains ineligible for public claims until independently signed runner
attestation is available.
