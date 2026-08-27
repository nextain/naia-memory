# MIRACL independent-runner handoff — 2026-08-23

## Decision

The MIRACL Korean full-corpus benchmark now has a bounded command-line handoff for an external challenge issuer and independent runner. This is an evidence-infrastructure improvement, not a new performance result. No public competitiveness claim is unlocked by this change alone.

Current public verdict remains **not eligible** until an independent trust domain signs a challenge-bound execution and the resulting receipt passes verification. A malicious or colluding trusted runner also remains outside the guarantee unless execution time is anchored by an independent timestamp authority or append-only transparency log.

## What changed

- Added `benchmark:miracl-full-corpus-attestation challenge` to derive a dataset-, protocol-, engine-, and base-receipt-bound Ed25519 signing packet.
- Added `benchmark:miracl-full-corpus-attestation verify` to consume a receipt, signed challenge, signed runner attestation, and verifier-owned trust policy through bounded 16 MiB file inputs.
- Bound receipt launch and completion timestamps to the signed challenge window and to runner-attested start/finish values.
- Added runtime guards for malformed challenge, attestation, and trust-policy JSON instead of relying on TypeScript assertions.
- Kept historical verification durable: verification does not require the current wall clock to remain inside an already completed challenge window.

## Adversarial review

OpenCode (`deepseek-v4-pro`) reviewed the uncommitted implementation read-only.

Accepted finding:

- Untrusted challenge and attestation JSON reached the singular verifier through unchecked type assertions. Runtime shape guards were exported and applied before verification.

Replay finding and resolution:

- An old receipt cannot be attached unchanged to a newer challenge: the receipt's bound launch/completion must fall inside the issuer-signed challenge window, and the runner's signed timestamps must exactly match the receipt.
- Requiring `Date.now()` at verification was rejected because it would make valid completed evidence unverifiable after challenge expiry.
- A malicious trusted runner can still rewrite or fabricate a self-consistent receipt and timestamps. Signatures prove which trusted identity endorsed the bytes, not that the identity was honest or that an external clock observed the run. This is an explicit remaining gate, not a passed property.

Non-blocking interface note:

- This focused handoff uses `challengeIssuerKeys` and `runnerKeys`, matching the execution-attestation API. The broader public-evidence bundle uses `challengeIssuerPublicKeys` and `runnerPublicKeys`; the handoff schema must remain documented as a separate minimal policy or be unified before wider SDK exposure.

## Verification evidence

- Focused: 2 files, 23 tests passed.
- Full suite: 125 files, 1,033 tests passed.
- TypeScript: application and benchmark typechecks passed.
- Biome: changed implementation and test files passed after formatting.
- Negative coverage includes stale receipt/new challenge replay, malformed attestation, malformed trust policy, byte substitution, key substitution, operator/runner trust-domain collision, and base receipt underbinding.

## Public-release gate

The next meaningful evidence step is not another local score optimization. It is:

1. complete the currently running MIRACL Korean full-corpus evaluation;
2. freeze the exact result, runtime observation, implementation artifact, and configuration hashes;
3. issue a fresh externally signed challenge before an independent rerun;
4. collect a runner signature from a trust domain independent of the benchmark operator;
5. anchor the challenge/run interval with RFC 3161 or a public append-only log;
6. verify the packet and only then promote the result to `PUBLIC_ATTESTATION_PASS`.

Until those steps complete, the defensible statement is: **Naia Memory has a reproducible, cryptographically bound independent-runner handoff, while its current MIRACL result remains local evidence rather than an independently attested global ranking.**
