# MIRACL RFC 3161 publication gate — 2026-08-23

## Decision

Naia Memory now distinguishes a signature-only independent-runner verdict from a timestamp-qualified publication verdict. Signature-only verification remains useful evidence, but is explicitly marked `publicationGateEligible: false`. Only a challenge and attestation whose complete signed objects are independently bound and chronologically validated by trusted RFC 3161 tokens can return `publicationGateEligible: true`.

This hardens the evidence path; it does not create a new performance result. The benchmark remains **not ready for an external competitiveness claim** until the full MIRACL Korean run completes and a genuinely independent runner plus real timestamp authority produce a passing packet.

## Implemented gate

- Added strict runtime guards for RFC 3161 digest evidence and verifier-supplied timestamp trust policies.
- Added `verify-timestamped` CLI intake with eight bounded files: receipt, signed challenge, signed attestation, runner trust policy, two timestamp tokens/evidence records, and two timestamp trust policies.
- Verifies the token against the SHA-256 identity of each complete signed object, preventing unsigned-field and signature substitution after timestamping.
- Requires the challenge timestamp to be no earlier than signed issuance and at least one second before execution start.
- Requires the attestation timestamp to be no earlier than signed execution completion and no earlier than the challenge timestamp.
- Hashes the portable trust-policy identity (`trustedCaFileSha256` and policy OID), excluding machine-local CA paths from the public identity.
- Fails closed on malformed JSON shapes, token/hash substitution, OpenSSL verification errors, trust-policy mismatch, or chronology violations.

## Assurance boundary

| Property | Signature only | RFC 3161 qualified |
| --- | --- | --- |
| Trusted issuer endorsed challenge bytes | Yes | Yes |
| Trusted runner endorsed receipt binding | Yes | Yes |
| Challenge existed before the claimed run | Not independently established | Established under trusted TSA and chronology checks |
| Attestation existed after claimed completion | Not independently established | Established under trusted TSA and chronology checks |
| Runner honestly executed the workload | **Not proven** | **Not proven** |
| Eligible for Naia publication gate | No | Yes, only when all checks pass |

A malicious or colluding trusted runner can still fabricate a self-consistent receipt and obtain timestamps. RFC 3161 proves byte existence and ordering under the selected TSA; it does not observe computation. Historical certificate validity, revocation archival, and token-time chain semantics are currently delegated to OpenSSL and the verifier's CA material rather than a long-term validation profile. These are explicit residual risks.

## Adversarial review record

The deterministic `review-pass` preflight did not run to a clean verdict because unrelated pre-existing `.cache/tools/trec_eval-ba38899/` state is classified as an unsafe untracked review path. It was preserved and not modified. Therefore this stage does **not** claim a formal `review-pass` CLEAN result.

Three read-only OpenCode attempts also did not yield a valid final review artifact:

- the default provider failed with retryable Azure server errors (request IDs beginning `c177` and `22267`);
- the `opencode/big-pickle` fallback read the target files but ended with an unknown zero-token final step, and its exported JSON was truncated before a review conclusion.

These are recorded as `NOT_RUN`, not as approval. Independent code inspection identified and fixed the principal downgrade path: the legacy `verify` result could otherwise be mistaken for publication-grade evidence. Tests now assert that signature-only success remains below the publication gate.

## Verification evidence

- Focused RFC 3161 and full-corpus evidence tests: 2 files, 24 tests passed.
- Full regression suite: 125 files, 1,034 tests passed.
- TypeScript application and benchmark typechecks passed.
- Biome check passed for all four changed implementation/test files.
- `git diff --check` passed.
- Negative coverage includes complete-object substitution, malformed timestamp evidence, malformed trust policy, stale challenge/receipt replay, trust-domain collision, key substitution, and base-receipt underbinding.

## Running benchmark status

The CPU-only MIRACL Korean full-corpus run remains healthy and was not interrupted. At this checkpoint it had produced vector chunk `000896000` of 1,486,752 documents (about 60.3%) after roughly 12 hours 58 minutes, with the evaluator using about 2,305% CPU. This is execution progress only, not a result.

## Next public-evidence gate

1. Complete the full-corpus run and freeze result, runtime, implementation, model, dataset, and protocol hashes.
2. Exercise `verify-timestamped` with real RFC 3161 tokens and verifier-owned CA files, not the injected test runner.
3. Obtain a fresh challenge and rerun from a trust domain independent of Nextain.
4. Add durable long-term validation or transparency-log evidence for certificate-expiry and revocation ambiguity.
5. Compare the independently attested result against preregistered global baselines before making a ranking claim.

The defensible statement today is: **Naia Memory has a stricter, downgrade-resistant path toward independently timed benchmark evidence, but neither honest computation nor global superiority is proven yet.**
