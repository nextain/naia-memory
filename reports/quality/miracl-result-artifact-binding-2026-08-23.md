# MIRACL result artifact binding hardening

Date: 2026-08-23
Scope: `miracl-ko-full-corpus-naia-vector-exact-v1` evidence generation

## Outcome

The evidence builder now accepts the result artifact text, verifies its SHA-256,
and parses the benchmark result from those verified bytes. It no longer trusts a
separately supplied `FullCorpusResult` object.

This closes a consistent-substitution gap where a direct caller could previously
pair an arbitrary parsed result object with an unrelated result artifact hash.
The verified hash remains cross-bound to the runtime monitor receipt and the
result artifact entry emitted by the evidence receipt.

## Adversarial review

OpenCode headless reviewed the exact implementation, CLI, tests, and diff. It
returned `VERDICT: PASS` and found no material bypass within the declared
`self-observed-local` trust boundary. The review specifically considered
consistent forgery, JSON parsing ambiguity, stale callers, and assurance claims.

## Verification

- Focused test: 1 file, 9 tests passed.
- Full suite: 125 files, 1,027 tests passed.
- TypeScript typecheck: passed.
- Scoped Biome check: passed.
- `git diff --check`: passed.

## Claim boundary

This is evidence-integrity hardening, not a retrieval-performance improvement.
It does not make a same-operator local run independently trustworthy. The
receipt therefore remains `LOCAL_PASS`, `self-observed-local`, and
`publicClaimEligible: false`; public eligibility still requires independently
signed execution attestation outside the benchmark operator trust boundary.
