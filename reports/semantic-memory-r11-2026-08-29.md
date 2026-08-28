# Naia Memory multilingual correction and deletion report (r11)

Date: 2026-08-29 (Asia/Seoul)

## Conclusion

Naia Memory is competitive on the bounded multilingual correction and deletion
workload measured here. Under the stronger blind adjudicator,
`gemini-2.5-flash`, Naia returned every current fact and exposed neither stale
nor deleted facts in English, Japanese, and Korean.

This is not a claim of general superiority. Hindsight reached the same Naia
score, the language/engine clusters are small, and the stronger adjudication was
run after an inconsistency was discovered in the preregistered lighter judge.
The stronger-judge result is therefore diagnostic evidence, not a replacement
confirmatory run.

## Naia results

| Language | Current fact | Stale fact exposed | Deleted fact leaked |
|---|---:|---:|---:|
| English | 24/24 | 0/12 | 0/12 |
| Japanese | 24/24 | 0/12 | 0/12 |
| Korean | 24/24 | 0/12 | 0/12 |

The earlier r5 Korean current-fact result was 20/24. The r11 diagnostic result
is 24/24 after making negation preservation explicit in fact extraction.

## Reliability finding

The preregistered `gemini-2.5-flash-lite` adjudication assigned contradictory
labels to identical negative facts, including treating “User is not allergic
to peanuts.” as both current and deleted. The frozen blind packet was rerated
with `gemini-2.5-flash`, which removed those contradictions. The benchmark CLI
now defaults to that stronger judge so a known-unreliable default is not reused.

## Product and harness changes

- Preserve explicit negation during fact extraction in English, Korean, and
  Japanese examples.
- Retry embedding requests only for HTTP 429 and 5xx responses with bounded
  1s, 2s, and 4s delays; fail immediately on non-retryable responses.
- Bind embedding-route and Mem0 bridge evidence labels to the actual provider
  route and preserve the binding in signed evidence.
- Record the raw semantic route needed to audit provider execution.
- Cover negation, retry bounds, non-retryable failures, evidence labels, and
  the stronger adjudicator default with regression tests.

## Verification

- `pnpm test`: 175 files passed; 1,464 tests passed; 1 skipped.
- `pnpm typecheck`: passed.
- `pnpm build`: passed.
- `git diff --check`: passed.

## Claim boundary and next evidence

The defensible statement is: “Naia Memory now demonstrates competitive,
multilingual correction and deletion behavior on this bounded workload.” A new
preregistered run with the stronger judge is required before promoting this to
confirmatory evidence. Overall SOTA, universal memory superiority, and
cross-workload superiority remain unestablished.
