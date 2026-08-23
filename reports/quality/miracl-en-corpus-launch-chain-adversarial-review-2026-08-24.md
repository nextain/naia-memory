# MIRACL English corpus launch-chain adversarial review

Date: 2026-08-24 KST

## Decision

The implementation is suitable for its narrow provenance claim:

> An English benchmark launch designates a canonical corpus identity receipt,
> and completion evidence is rejected unless the source-lock hash captured at
> launch equals the result source-lock hash.

This is not evidence of atomic corpus-byte continuity, retrieval quality,
latency, multilingual superiority, or state of the art.

## Deterministic evidence

- `pnpm exec vitest run` over the corpus-identity, launch-receipt, and
  multilingual completion-evidence suites: 3 files, 19 tests passed.
- `pnpm exec tsc --noEmit`: passed.
- `git diff --check`: passed.
- Negative coverage rejects field mutation, unknown receipt fields, missing
  English bindings, malformed hashes, and launch/result source-lock mismatch.
- Non-English launches retain their existing behavior and reject accidental use
  of the English-only identity-receipt environment variable.

## Adversarial review

- Security/provenance role, DeepSeek V4 Pro: CLEAN.
- Architecture/claim-boundary role, DeepSeek V4 Pro: CLEAN.
- Type/API role, DeepSeek V4 Pro: NOT_RUN (provider rate limit).
- Type/API role, GPT-5.4 Nano retry: NOT_RUN (provider rate limit).
- Test role, OpenCode Big Pickle: NOT_RUN (no output; terminated after 90 s).
- Integration role, Claude plan mode: NOT_RUN (no output; terminated after
  90 s).

An earlier unscoped review included unrelated HNSW worktree artifacts. Its
out-of-scope findings were not counted. Its receipt-extension concern was
independently checked: canonical comparison already rejected unknown fields,
and an explicit regression test now locks that behavior.

## Review limitation

This is a scoped implementation acceptance, not a formal multi-provider
`review-pass`: only two reviewer roles completed, both through the same model
provider, and two consecutive complete clean rounds were not available.
Provider failures are recorded as `NOT_RUN`, never as clean results.

## Remaining public-evidence gate

The source-lock chain removes one provenance ambiguity for the pending English
run. Public competitiveness still requires completed pinned KO/EN/AR runs,
sealed tuning/validation evidence, same-input competitor receipts, statistical
repetitions, and an externally reproducible final report.
