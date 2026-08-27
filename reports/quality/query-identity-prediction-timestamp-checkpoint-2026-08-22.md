# Query-identity prediction timestamp checkpoint

Date: 2026-08-22 (KST)

## Outcome

The query-identity evidence scorer now verifies an RFC 3161 token over the
exact prediction artifact. The token must bind the scored prediction SHA-256,
and its trusted time must be after the committed launch. A prediction whose
self-reported creation time is later than the trusted token is rejected.

This establishes that the exact scored prediction artifact existed no later
than the trusted timestamp and after launch. It does not establish that the
oracle remained hidden until then.

## Assurance boundary

The new level is
`runner-signed-result-with-rfc3161-prediction-timestamp`.

- `predictionArtifactTrustedTimestampVerified`: true
- `predictionChronologyVerified`: true, limited to launch/token ordering
- `predictionPrecommitTimestampVerified`: false
- `oracleWithheldUntilPredictionCommitVerified`: false
- `hiddenPacketDeliveryVerified`: false
- `organizationalIndependenceVerified`: false

Calling this a precommit would be an overclaim until an independently enforced
oracle escrow/reveal event is linked to the prediction timestamp.

## Adversarial review

The initial OpenCode 1.18.18 / `deepseek-v4-pro` review returned FINDINGS. Its
only proposed implementation change was exposing the optional test command
runner through the production CLI. That was rejected: the seam exists for
deterministic tests, while production intentionally invokes the default
OpenSSL verifier using the token and CA paths committed by evidence and policy.

Independent adjudication found a more important semantic issue: the first
draft set `predictionPrecommitTimestampVerified` true despite having no oracle
release evidence. The implementation was corrected to report only trusted
prediction-artifact timestamping and to keep precommit/withholding false.

The post-fix adversarial re-review returned `VERDICT: CLEAN` with no actionable
hash-binding, replay/substitution, chronology, or assurance-overclaim finding.
This remains a scoped OpenCode result, not a formal recovery-mode
`review-pass` convergence claim.

## Verification

- Focused tests: 2 files, 7 tests passed.
- Full suite: 106 files, 919 tests passed.
- TypeScript typecheck: passed.
- Biome check: passed.
- `git diff --check`: passed.

## Public-readiness decision

**NOT READY.** This removes ambiguity around when the exact prediction existed,
but the decisive next protocol step is independently enforced oracle
escrow/reveal: scoring must require a reveal receipt whose trusted time is
strictly after the prediction timestamp. Real native-reviewed Korean, English,
and Japanese hidden oracles and same-contract global-engine runs are still
required.

The CPU-only Korean MIRACL full-corpus run remains active at
194,560/1,486,752 indexed documents (213 queries, exact top-100). GPU 1 remains
untouched because it belongs to another session.
