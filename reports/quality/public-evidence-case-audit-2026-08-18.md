# Public evidence case audit — 2026-08-18

## Verdict

**NOT PUBLIC-READY.** The v2 gate now verifies complete, auditable, engine-bound case evidence and recomputes aggregates, but it does not yet prove scorer truth or third-party identity.

## Implemented evidence guarantees

- Dataset cases contain the full input, expected answers, language, stable identity, and an input SHA-256 derived from the input bytes.
- Every executed engine must provide one record for every `(case, repetition)` pair; missing, duplicate, unknown, or out-of-range records fail closed.
- Each record retains the engine output. Its SHA-256 is recomputed from a canonical tuple of engine, case, repetition, and output, preventing cross-arm record substitution.
- Failure count, score, and 95% confidence interval are recomputed from case records. Repetitions are averaged within a case before the interval is computed, so repetitions do not artificially inflate the independent sample count.
- Engine implementation artifacts and configurations are confined to the evidence root and verified from their actual bytes. Paths and hashes are bound between manifest and receipt.
- The schema is explicitly versioned as v2 because these requirements are incompatible with the previous aggregate-only v1 evidence.

## Adversarial review

OpenCode identified a real cross-engine output substitution weakness and non-finite direct-call behavior. Both were fixed and covered by regression tests. Its second pass found no file-gate bypass in coverage, ordering, path confinement, or hash recomputation, but exposed the remaining circularity: a submitter can alter per-record scores and the aggregate together because the score is not derived from a sealed scorer judgment.

Claude headless was also invoked for an independent boundary check but timed out without a verdict. This is recorded as unavailable review evidence, not a pass.

## Remaining publication blockers

1. **Score provenance:** each score needs a retained judge/deterministic-scorer trace bound to input, expected answer, output, scorer implementation/model revision, and scoring policy. The gate must independently replay deterministic scoring or verify a signed external judgment.
2. **Authenticity:** hashes prove byte consistency, not who produced the bytes. Engine receipts and adversarial review artifacts need signatures whose public keys come from a trusted policy outside the submitted manifest.
3. **Independent public corpus:** the actual held-out multilingual corpus still needs independent authorship, native review, pre-run sealing, and publishable case contents.
4. **External engine execution:** independent artifacts and receipts for the selected global comparison engines still need to be generated under the same sealed protocol.

## Verification

- `pnpm test`: 31 files, 458 tests passed
- `pnpm typecheck`: passed
- `pnpm build`: passed
- `git diff --check`: passed

The next research stage is a signed score-provenance contract. Until that exists and real independent evidence is collected, this gate must not be cited as proof that Naia outperforms global engines.
