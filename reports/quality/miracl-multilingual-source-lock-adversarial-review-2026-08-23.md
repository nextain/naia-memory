# MIRACL multilingual source-lock adversarial review

Date: 2026-08-23

This is a scoped OpenCode headless adversarial review, not a formal
`review-pass` CLEAN result.

## Review sequence

The first review returned `FINDINGS`: a language subset could be qualified
without making omitted preregistered languages visible. The implementation was
changed to require explicit `--partial` acknowledgement and emit
`requestedLanguages`, `omittedPreregistered`, and `partial`.

The second review confirmed the behavior but returned `FINDINGS` because the
anti-selection gate itself was not regression tested. Argument resolution was
then extracted as `resolveMiraclLanguageSelection`, with tests for full default
scope, unacknowledged subset rejection, visible partial scope, empty partial
scope, and duplicate languages.

The final high-effort OpenCode `opencode/big-pickle` review returned
`VERDICT: PASS`.

## Independent checks performed by the reviewer

- Reproduced all six topic/qrels hashes, sizes, and query counts from the pinned
  Hugging Face revision.
- Reproduced KO/EN/AR corpus manifest digests through the production parser.
- Exercised the two-page English provider manifest.
- Confirmed topic/qrels set equality for all three languages.
- Ran the focused tests and both TypeScript checks.
- Confirmed P05 requires KO/EN/AR and remains honestly pending.

## Remaining limits

- Corpus bytes are not downloaded or locally hashed by this source-lock stage.
- The language-specific namespace helper is not yet wired into the full-corpus
  execution runner.
- This reduces Korean-only overfit risk but proves no transfer quality until
  EN/AR runs exist.
- Formal review-pass preflight is blocked by unrelated pre-existing cache state,
  so the result must not be described as CLEAN or release eligible.

The final review found only low-priority positive/shape test hardening
opportunities and no actionable medium-or-higher defect. Both test-hardening
opportunities were subsequently implemented; the focused suite passes 16/16.
