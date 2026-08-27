# Public evidence intake CLI

## Outcome

The public-evidence verifier now has a file-based intake candidate:

```text
pnpm benchmark:public-evidence <manifest.json> <verifier-trust-policy.json>
```

It evaluates the manifest's directory as the submitted evidence root and requires the canonical verifier trust-policy path to resolve outside that root. This prevents a submitted file, including one reached through an external symlink, from selecting its own trust roots. Malformed or unreadable inputs return a non-promotable JSON decision; usage errors exit 2, rejected evidence exits 1, and promotable evidence exits 0.

## Evidence

- Intake and attack tests cover valid bundle intake, malformed trust shape and Ed25519 keys, unreadable/oversized input, dot-prefixed containment, symlinked self-trust, external evidence symlink escape, and untrusted publisher keys.
- Full suite: 37 files, 501 tests passed.
- Strict main/benchmark typecheck and production build passed.

## Review status and claim boundary

The first valid OpenCode adversarial review returned `ACTIONABLE DEFECTS`: segment-insensitive parent detection, unbounded reads, and raw error disclosure. The implementation now uses segment-aware containment, bounded no-follow file reads, normalized errors, and Ed25519 trust-key validation. A fixed-tree OpenCode re-review inspected the intake, crypto, gate, and attack tests and returned `VERDICT: CLEAN`. Rate-limited or non-terminating model attempts were not counted as passes.

This work enables deterministic intake; it does not supply an independently owned multilingual corpus, execute Naia or external engines, or demonstrate a performance advantage. Publisher statements that a dataset was sealed and a protocol frozen before execution are not cryptographic time-order proofs, and reviewer independence depends on an externally governed trust policy. Public comparison remains blocked on external ko/en/ja authorship/review, an out-of-band verifier trust root, and verifier-challenged same-input receipts from Naia plus at least two global engines.
