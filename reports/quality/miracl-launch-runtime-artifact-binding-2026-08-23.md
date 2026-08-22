# MIRACL launch/runtime artifact binding hardening

Date: 2026-08-23

## Outcome

The full-corpus MIRACL evidence builder now derives launch-receipt and runtime-observation hashes from the exact UTF-8 artifact text that it parses. The emitted schema-v3 receipt records both artifact paths and hashes and verifies that the runtime observation names and hashes the same launch receipt.

This closes the local evidence-composition gap in which a parsed launch object and a separately supplied hash could be paired without proving that they came from the same artifact. It does not make the run independently attested: assurance remains `self-observed-local`, and `publicClaimEligible` remains `false`.

## Threat model and change

- Launch receipt: consume raw text, parse internally, and derive SHA-256 internally.
- Runtime observation: consume raw text, parse internally, and derive SHA-256 internally.
- Cross-artifact binding: require the runtime observation's launch path and hash to equal the consumed launch artifact path and derived hash.
- Output binding: emit path/SHA-256 entries for both artifacts in the evidence receipt.
- Contract evolution: bump the evidence receipt from schema version 2 to 3.

Regression coverage rejects both a substituted launch artifact paired with the old runtime observation and a runtime observation that names a different launch artifact.

## Verification

- TypeScript typecheck: PASS
- Biome check on all three changed source/test files: PASS
- Full Vitest suite: PASS, 125 files and 1,029 tests
- OpenCode adversarial review round 1: PASS; noted only fail-closed robustness observations outside this diff
- OpenCode adversarial convergence review round 2: PASS; no material finding
- Formal `review-pass`: NOT RUN because its tool cache overlaps user-owned untracked state; no formal cross-validation claim is made

## Claim boundary

This hardening increases the integrity and auditability of a locally operated benchmark. It is evidence that the recorded local result, launch receipt, and runtime observation form a consistent hash-bound set. It is not evidence that an independent party executed the benchmark, controlled the environment, or signed the result. A public comparative performance claim still requires an independently controlled, signed runner outside the benchmark operator trust boundary.

## Follow-up

The first adversarial review identified two non-bypass, fail-closed robustness improvements. The launch receipt producer now parses `/proc/<pid>/stat` with the existing command-safe parser. Canonicalizing artifact paths at production and consumption boundaries remains follow-up work before packaging the independent-runner protocol; it does not invalidate this result.
