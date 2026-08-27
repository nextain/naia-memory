# MIRACL full-corpus external publication anchor

Date: 2026-08-23 KST
Branch: `feat/memory-bench-harness-and-fixes`

## Outcome

The portable full-corpus attestation bundle now has an independently anchored publication path. `verify-published-bundle` will not evaluate the inner benchmark evidence until it has authenticated the exact bundle manifest bytes against an external Ed25519 signer policy and an external RFC 3161 TSA trust root.

The authenticated chain is:

1. SHA-256 of the exact bundle manifest bytes.
2. Full-corpus-domain-separated Ed25519 signature over that digest, signer identity, and signer-key fingerprint.
3. SHA-256 of the exact publication receipt bytes.
4. RFC 3161 timestamp verification using verifier-supplied policy and CA bytes.
5. Publication signer key-validity check at the trusted TSA time.
6. Existing hash-confined bundle loading and timestamp-qualified inner attestation verification.

Signer policy, TSA policy, and TSA CA are command-line verifier inputs outside the bundle. A bundle cannot authorize its own publisher or TSA.

## Security properties tested

- Exact manifest-byte substitution is rejected.
- A signer key not present in the external policy is rejected.
- Semantic-public-gate signatures cannot be replayed as full-corpus bundle signatures because the domains differ.
- A publication signer outside its validity interval at TSA time is rejected.
- Non-canonical base64 and unexpected schema fields are rejected.
- Publication token and CA bytes remain hash-bound even when producer paths do not exist.
- `verify-published-bundle` authenticates the outer publication before entering the existing inner verifier.
- Existing semantic publication behavior remains unchanged.

## Verification evidence

- Focused suites: 5 files, 23 tests passed.
- Publication and CLI suites: 2 files, 11 tests passed.
- Full regression: 127 files, 1,046 tests passed.
- Type checks: `tsconfig.typecheck.json` and `tsconfig.benchmark.json` passed.
- Biome and `git diff --check` passed for owned changes.
- OpenCode adversarial implementation review using `azure-foundry/deepseek-v4-pro`: `VERDICT: PASS` after primary-code validation and withdrawal of non-exploitable UTF-8, bounded-read, and TOCTOU hypotheses.

Formal `review-pass` status remains `NOT_CLEAN/REVIEW_ONLY`: repository-wide deterministic preflight is blocked by unrelated, user-owned untracked `.cache/tools/trec_eval-ba38899/` state and the session lacks immutable preservation inputs. This limitation does not change the focused test results or the ordinary adversarial PASS, but it must not be represented as a formal clean review-pass verdict.

## Remaining publication gap

This closes the trust-bootstrap gap for a generated full-corpus bundle; it does not itself produce a completed MIRACL Korean full-corpus result. The long-running CPU evaluation must finish, after which its final bundle must be published through this path and compared with the declared competitor set before any public competitiveness claim.
