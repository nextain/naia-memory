# Portable MIRACL attestation bundle — 2026-08-23

## Result

The MIRACL full-corpus verifier can now consume one self-contained, hash-bound bundle on a different machine without reopening JSON artifacts or depending on the producer's RFC 3161 token and CA paths. The bundle commits exactly 12 artifacts: the receipt, signed challenge, signed execution attestation, operator trust policy, two timestamp evidence documents, two timestamp trust policies, two timestamp tokens, and two trusted CA files.

This closes a publication-evidence portability gap. It is not a retrieval-quality improvement and does not by itself prove that the benchmark execution was honest.

## Security and portability properties

- Exact schema and exact 12-artifact inventory; missing, extra, and unknown fields fail closed.
- Relative lexical confinement plus real-path confinement.
- Artifact reads use `O_NOFOLLOW`, regular-file and 16 MiB checks, and opened-inode versus current-path identity checks before consuming the already-open descriptor.
- Every retained byte buffer is checked against its manifest SHA-256 and is subsequently reused by the verifier; verified JSON is not reopened.
- RFC 3161 token and trusted-CA bytes come from the verified bundle. Embedded producer paths can be absent on the verifier host.
- The successful verdict exposes the manifest SHA-256 and all 12 artifact SHA-256 values.
- Standalone timestamp verification now also rejects final symlinks and non-regular or larger-than-16-MiB token/CA inputs.

## Direct evidence

The successful CLI test constructs real Ed25519-signed challenge and attestation objects, points both timestamp JSON documents at deliberately nonexistent token/CA paths, and supplies the token and CA only through the bundle. It asserts a timestamp-qualified public-attestation PASS, checks the manifest digest and all 12 artifact digests, and checks that the timestamp command runner receives the exact bundled binary bytes.

Path substitution, lexical escape, unknown fields, and symbolic-link escape are rejection-tested.

## Validation

- Focused Vitest: 3 files, 30 tests passed.
- TypeScript typecheck: both project configurations passed.
- Full regression: 126 files, 1,040 tests passed.
- Biome on all six changed source/test files: passed.
- `git diff --check`: passed.

## Adversarial review

OpenCode headless (`deepseek-v4-pro`) returned `PASS`: no exploitable blocker found. It specifically accepted the `O_NOFOLLOW` plus inode-binding read sequence, in-memory token/CA plumbing, exact artifact inventory, and successful cross-machine-path test. Its two low findings were addressed or classified:

- Standalone token/CA unbounded reads: addressed with bounded regular-file reads and final-symlink rejection.
- Relative receipt path in verdict: retained as a non-authoritative display label; receipt SHA-256 is the content identity.

Formal `review-pass` remains `NOT_CLEAN` at deterministic preflight because unrelated user-owned `.cache/tools/trec_eval-ba38899/` is untracked. It was preserved. No formal Clean claim is made.

## Remaining publication boundary

The bundle is portable and internally tamper-evident, but a recipient still needs an external authentic reference for the expected manifest SHA-256. Publishing that digest through an independently controlled channel or transparency log prevents an attacker from replacing the entire bundle with another internally valid bundle. Independent TSA custody and a clean external rerun are still required before presenting the benchmark as third-party-verified.

## Long-run checkpoint

The Korean MIRACL full-corpus evaluator remained active and undisturbed, CPU-only, for more than 13 hours. At this checkpoint 1,870 vector receipt chunks existed; GPU1 was not used.
