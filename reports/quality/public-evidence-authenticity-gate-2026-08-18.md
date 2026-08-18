# Public evidence authenticity gate — 2026-08-18

## Verdict

**GATE IMPLEMENTATION PASS; BENCHMARK STILL NOT PUBLIC-READY.** The v3 evidence gate closes the known self-authentication and score-editing paths, but no new global-engine performance claim is created by this work.

## What changed

- A verifier-owned trust policy now pins publisher, engine, and reviewer Ed25519 public keys outside submitted evidence.
- The signed publisher manifest binds the dataset, frozen protocol, scorer artifact, engine receipts, and adversarial-review artifact.
- Every engine receipt is independently signed by its trusted engine identity.
- Every adversarial review is signed by its trusted reviewer identity and bound to the complete evidence scope.
- The verifier pins each approved scoring-policy identity to the exact scorer artifact SHA-256 and verifies its on-disk bytes.
- Every case score retains a judgment and a judgment hash bound to engine, case, repetition, output hash, score, failure state, and scoring-policy identity.
- The shape-only API is explicitly named `validatePublicEvidenceManifest`; only `evaluatePublicEvidenceFiles` can issue a complete promotion decision.

## Adversarial review

An initial OpenCode review blocked self-selected trust roots and an unpinned scoring policy. The implementation was changed so trust roots are mandatory verifier input and approved scoring policies map to exact artifact hashes. Canonical JSON is used consistently for signed and hashed scopes.

A fresh review under the explicit threat model—honest fixed trust policy and uncompromised private keys—returned **PASS** and found no concrete path for modified evidence, inflated scores, wrong identities, or an unapproved scorer to receive a promotable decision. It identified API misuse as a residual risk; the structural validator was consequently renamed and documented.

## What this proves—and does not prove

The gate now proves artifact integrity, trusted signer identity, protocol binding, complete case coverage, and aggregate recomputation under the declared scorer. It does **not** prove that the declared scorer is semantically correct merely because its hash is approved, nor that the current Naia scores exceed global engines. Those require a frozen independently reviewed scorer/corpus and actual same-input external runs.

## Remaining publication blockers

1. Independently authored and native-reviewed Korean/English/Japanese held-out cases, sealed before execution.
2. A frozen deterministic scorer that the gate can replay, or signed independent judge judgments with a predeclared model revision.
3. Real receipts from at least two independent global engines under the exact same dataset and protocol.
4. A final independent review over the resulting complete evidence bundle, not only the gate implementation.

## Verification

- Targeted gate tests: 22 passed.
- Full suite: 31 files, 462 tests passed.
- `pnpm typecheck`: passed.
- `pnpm build`: passed.
- `git diff --check`: passed.

The next meaningful stage is evidence production: freeze the multilingual corpus and scorer, then execute Naia and the selected external engines. Until those artifacts exist, public superiority language remains blocked.
