# MIRACL offline publication workflow — 2026-08-23

## Outcome

The full-corpus attestation bundle now has an operational, offline-signing publication path. The benchmark host can derive a hash-bound signing packet from the bundle, an external holder can sign it without exposing a private key, and the host can collect the detached signature into an exclusively written publication receipt.

This closes the gap between the existing publication verifier and a reproducible operator workflow. It does not turn the current MIRACL run into a completed result; the full-corpus evaluator is still running.

## Commands

```text
publish-packet <bundle.json> <external-signer-policy.json> <signer-id>
publish-collect <packet.json> <detached-signature.json> <external-signer-policy.json> <publication-receipt.json>
```

`publish-packet` hashes the exact loaded manifest bytes. `publish-collect` accepts no private-key input, checks the packet/signature/policy binding, writes canonical receipt bytes without overwriting an existing path, and reports the SHA-256 of the exact bytes written.

## Security and reproducibility properties

- signing JSON inputs are capped at 64 KiB and final-component symbolic links are rejected;
- the packet is domain-separated and binds manifest digest, signer identity, policy digest, and signing time;
- detached Ed25519 signatures are checked against the external trust policy;
- output uses an exclusive temporary file and hard-link publication, so an existing file or symbolic link is not replaced;
- publication verification semantics remain unchanged.

## Evidence

- Focused regression: 2 files, 14 tests passed.
- Full regression: 127 files, 1,049 tests passed.
- Type checks: `tsconfig.typecheck.json` and `tsconfig.benchmark.json` passed.
- Biome and `git diff --check` passed.
- New tests prove exact bundle digest derivation, exact receipt-byte digest reporting, duplicate-output refusal, final symbolic-link preservation, and 64 KiB + 1 input refusal.
- OpenCode adversarial pre-review: PASS.
- OpenCode adversarial post-review after resolving one real test gap and correcting one output-path misread: `BLOCKING_FINDINGS NONE`, `NONBLOCKING_GAPS NONE`, `VERDICT PASS`.

## Honest limitations

- The long-running Korean MIRACL full-corpus result is not complete, so no new retrieval-quality or global-rank claim follows from this workflow change.
- Formal `review-pass` CLEAN evidence is unavailable because deterministic preflight encounters unrelated user-owned untracked tool state under `.cache/tools/`; this work therefore remains ordinary adversarial-review evidence, not a formal CLEAN attestation.
- A publication receipt still needs an independently controlled signer and trusted timestamp evidence before external publication can claim independent temporal custody.
