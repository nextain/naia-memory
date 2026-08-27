# Query-identity runner-signed evidence checkpoint

Date: 2026-08-22 (KST)

## Outcome

The hidden-oracle benchmark protocol now supports cryptographically attributable
runner claims. A launch commits a random 128-bit nonce and an optional SHA-256
digest of an Ed25519 runner trust policy. The trusted runner signs both an
acknowledgement and a result seal. Those signatures bind the runner identity,
launch nonce, blind packet, prior oracle receipt, trust policy, engine/model,
and exact prediction artifact.

This closes practical policy-substitution, launch-replay, prediction-substitution,
and signature-tampering paths within the stated threat model. It does **not**
yet make the benchmark suitable for an external competitive claim.

## What the evidence establishes

- The oracle artifact existed before launch when its RFC 3161 receipt verifies.
- The launch receipt committed the nonce, blind packet, oracle digest, and
  runner-policy digest.
- A key allowed by that committed policy signed the acknowledgement.
- The same trusted runner signed a seal over the exact prediction artifact.
- The runner's signed statements put acknowledgement before result creation.

The emitted assurance level is deliberately limited to
`runner-signed-delivery-and-result-claims`.

## What it does not establish

- A trusted wall clock independently witnessed delivery or prediction creation.
- The packet was physically delivered merely because the runner signed that it
  was received.
- The runner policy itself was externally precommitted before the run.
- The prediction artifact was externally timestamped before oracle release.
- The oracle was technically withheld until the prediction commitment existed.
- The benchmark operator and runner were organizationally independent.

These limits are represented as explicit false assurance fields rather than
left implicit.

## Adversarial review

The first OpenCode review identified three actionable overclaim risks:

1. Assurance booleans could be true by construction instead of derived from
   successful validation.
2. A substituted runner policy needed an early, explicit failure.
3. Missing external policy precommit, prediction precommit, and oracle-withhold
   guarantees needed machine-readable representation.

All three were corrected. Requests to reinterpret the oracle's RFC 3161 receipt
as a nonce or prediction timestamp were rejected because that receipt proves
only prior oracle existence. A generic SHA-256 collision scenario was also not
treated as an actionable protocol defect.

A post-fix OpenCode 1.18.18 review using `deepseek-v4-pro` returned:

> VERDICT: CLEAN — No actionable correctness, security, or overclaim findings
> within assurance scope.

This is a scoped adversarial-review result, not a formal multi-reviewer
`review-pass` CLEAN claim. The deterministic review preflight could not start
model review because the unrelated user-owned untracked path
`.cache/tools/trec_eval-ba38899/` is considered unsafe by that harness. The
cache was not modified or removed.

## Verification

- Focused tests: 2 files, 7 tests passed.
- Full suite: 106 files, 919 tests passed.
- TypeScript typecheck: passed.
- Biome check for the five implementation/test files: passed.
- `git diff --check`: passed.

The tests cover policy substitution, nonce replay, prediction substitution,
signature modification, and claimed chronology.

## Public-readiness decision

**NOT READY — internal evidence checkpoint.** The protocol is materially more
tamper-evident, but it still relies on the runner's signed assertion for event
ordering. A public competitive report requires, at minimum:

1. an externally precommitted runner trust policy;
2. an RFC 3161 timestamp for the exact prediction commitment before oracle
   release, or an equivalent independently operated escrow/reveal mechanism;
3. real native-reviewed Korean, English, and Japanese hidden-oracle sets;
4. independently executed runs against multiple global memory engines under
   the same contract; and
5. completion of the full-corpus Korean MIRACL retrieval gate.

## Long-running retrieval gate

The CPU-only Korean MIRACL full-corpus run remains active with 1,486,752
documents, 213 queries, and exact top-100 evaluation. It is intentionally not
restarted or moved to GPU because GPU 1 is assigned to another session.
