# Real RFC 3161 integration gate — 2026-08-23

## Result

The publication-evidence verifier now has an end-to-end test that invokes the production OpenSSL command runner against a freshly generated RFC 3161 response. The test proves that the local verification path accepts the exact timestamped SHA-256 digest and rejects both a substituted digest and an unauthorized policy OID.

This is an evidence-integrity improvement, not a retrieval-quality result and not evidence that benchmark computation was honest.

## Tested path

- Generate an ephemeral RSA timestamp signer with the critical `timeStamping` EKU.
- Generate an RFC 3161 request for an exact artifact SHA-256 digest.
- Issue a response from a test-local TSA configuration and serial file.
- Verify the response through `validateRfc3161DigestTimestampBinding` without an injected command runner.
- Reject a digest substitution even when the evidence envelope is changed to match the substituted digest.
- Reject a valid token when its policy OID is not authorized.
- Remove all ephemeral keys, certificates, requests, and responses in `finally` cleanup.

## Validation

- Focused Vitest: 10/10 passed.
- TypeScript typecheck: passed.
- Full regression: 125 files, 1,035 tests passed.
- Biome on the changed test: passed after formatting.
- `git diff --check`: passed.

## Adversarial review status

- Formal `review-pass`: `NOT_CLEAN` at preflight because the unrelated user-owned untracked path `.cache/tools/trec_eval-ba38899/` is considered unsafe. It was preserved and not modified.
- OpenCode headless attempt: `NOT_RUN`; the model inspected files but emitted no final review payload.
- Claude headless fallback: `NOT_RUN`; the local client reported `Not logged in`.
- Deterministic adversarial checks therefore remain the accepted evidence for this stage. No external-model clean verdict is claimed.

## Limits and next gate

The test uses an ephemeral self-signed test TSA, not an independently operated public TSA or production CA chain. It demonstrates implementation correctness for the local trust policy but does not establish third-party custody, honest execution, preregistration, or benchmark competitiveness. The next publication gate is externally anchored timestamp evidence from an independent TSA, followed by verification on a clean external runner.

## Long-run checkpoint

The MIRACL Korean full-corpus vectorization remained active and undisturbed during this change. At the checkpoint, 1,777 receipt chunks existed and the evaluator process was using CPU; no GPU was used.
