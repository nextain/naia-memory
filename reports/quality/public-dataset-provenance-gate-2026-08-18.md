# Public dataset provenance gate — 2026-08-18

## Outcome

Public evidence manifest v5 no longer accepts publisher-asserted dataset independence by itself. It requires a separately hashed provenance artifact containing trusted Ed25519 attestations from every declared dataset author and every declared native reviewer.

Native-reviewer trust is language-scoped. A valid Korean reviewer's signature over an English attestation is rejected unless that identity is independently trusted for English. Author and reviewer lists must exactly match the manifest, and each signature binds the dataset SHA-256.

## Evidence

- Full suite: 36 files, 494 tests passed.
- Strict application and benchmark typecheck passed.
- Production build and `git diff --check` passed.
- Regression attacks cover forged author signatures, language-replay mutation, a cryptographically valid signature from a reviewer not trusted for the asserted language, and a language-scoped reviewer key reused across trust roles.

## Adversarial review

Two consecutive OpenCode/DeepSeek reviews inspected the unchanged tree and returned `VERDICT: CLEAN`. The second round explicitly attacked signature replay, reviewer-language confusion, undeclared-language handling, role-key reuse, and fail-open behavior. It found no actionable bypass. A suspected fixture-key mismatch was rejected after confirming that the TypeScript cast does not alter the runtime reviewer identity and that file-level happy-path verification passes in the 494-test suite.

Claude headless failed to complete and an additional Azure-hosted GPT review was rate-limited, so this is a two-round single-model review, not a multi-model consensus claim.

## Claim boundary

This is an evidence-integrity improvement, not a retrieval-performance improvement. The only currently supportable public claim remains: artifacts are tamper-evident under the frozen public evidence protocol.

Performance, multilingual quality, generalization, organizational independence, and comparison with global engines remain blocked until an externally owned held-out Korean/English/Japanese corpus (at least 100 cases and 30 per language), real Naia receipts, and same-input receipts from at least two external engines are collected under verifier-issued challenges.
