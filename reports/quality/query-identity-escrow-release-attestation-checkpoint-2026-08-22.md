# Query-identity escrow release attestation checkpoint (2026-08-22)

## Outcome

The query-identity evidence path now supports a launch-bound, prior-timestamped escrow release attestation. This closes a concrete policy-selection replay gap in the previous draft: the launch receipt now commits to the exact escrow trust policy, and the signed reveal receipt commits to every timestamp trust policy needed to interpret the evidence.

This is a protocol-strengthening result, not a benchmark-quality result and not a public competitiveness claim. Public readiness remains **NOT READY**.

## What is verified

- An RFC 3161 token verifies the exact escrow trust-policy artifact and predates the receipt's declared launch time.
- The launch receipt binds the exact escrow trust-policy SHA-256.
- A policy-authorized Ed25519 escrow signs a receipt binding the oracle, predictions, prediction timestamp token, launch receipt, escrow policy, and the prediction/escrow-policy/reveal timestamp trust policies.
- The exact reveal receipt receives a valid RFC 3161 timestamp after the prediction timestamp.
- Substitution of the launch-selected escrow policy, prediction timestamp token, or timestamp trust policies is rejected.

The assurance name is deliberately `launch-bound-prior-timestamped-escrow-release-attestation`, not `externally-precommitted`: the launch time itself is declared in the launch receipt and is not independently witnessed by an external clock.

## What is not verified

- The oracle was technically inaccessible to the benchmark operator before prediction commitment.
- The escrow is organizationally independent or non-colluding.
- The escrow's self-reported reveal time was independently observed.
- A score JSON is trustworthy without independent artifact revalidation.
- Any multilingual, global-engine, or memory-update performance advantage.

The emitted evidence therefore keeps `technicalOracleWithholdingVerified`, `oracleWithheldUntilPredictionCommitVerified`, and `organizationalIndependenceVerified` false.

## Adversarial review

The first OpenCode/DeepSeek V4 Pro review found:

1. **Critical — accepted and fixed:** a pre-timestamped escrow policy was not selected by the launch receipt, allowing post-launch choice among old policies.
2. **High — accepted and fixed:** the prediction timestamp token was bound, but its trust policy was not.
3. **Medium — accepted and fixed:** escrow-policy and reveal timestamp trust policies were also unbound.
4. **Medium — adjudicated:** verifier-controlled command injection remains a test seam. Production CLI verification does not inject it and invokes real `openssl ts -verify`; published outputs still require artifact revalidation.
5. **Medium — accepted as an explicit limit:** `launchedAt` is not externally witnessed. Assurance wording was downgraded so it does not claim otherwise.

After the fixes, the same scoped adversarial review returned **CLEAN — no exploitable defects found under the honest verifier model**. Recovery mode prevents claiming a formal `review-pass` CLEAN; this is recorded only as a scoped OpenCode adversarial review.

## Deterministic verification

- Biome check: pass for the four changed source/test files.
- TypeScript `tsc --noEmit`: pass.
- Vitest: **106 files, 919 tests passed**.
- `git diff --check`: pass.

## Long-running public-scale evidence

The CPU-only MIRACL Korean full-corpus run remains alive and untouched: 1,486,752 documents, 213 queries, exact top-100, Qdrant collection `naia_miracl_ko_74295271_777d3b92`. It is not yet a result and must not be cited as performance evidence until completion and artifact validation.

## Next gate

The next meaningful gate is stronger than another self-authored receipt: use encrypted oracle escrow or threshold release with an independently witnessed release event, then run preregistered native-reviewed Korean/English/Japanese suites and global-engine comparisons under the same protocol. Until those results exist, Naia Memory may claim stronger evidence plumbing, but not a globally differentiated memory advantage.
