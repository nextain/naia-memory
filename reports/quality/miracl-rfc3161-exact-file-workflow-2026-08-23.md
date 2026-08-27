# MIRACL RFC 3161 exact-file workflow — 2026-08-23

## Outcome

The publication workflow can now request and seal an RFC 3161 timestamp directly from the exact bytes of a publication receipt or other bounded artifact. Operators no longer need to copy a digest between commands, removing a manual substitution point while retaining the existing trusted timestamp verifier.

This is publication-integrity progress, not a retrieval-quality improvement. The Korean MIRACL full-corpus evaluation remains in progress.

## Commands

```text
request-file <artifact> <query.tsq>
seal-file <artifact> <response.tsr>
```

`request-file` hashes the artifact's raw bytes and creates a nonce-bearing SHA-256 timestamp query. `seal-file` re-hashes the artifact, reads the TSA response, and emits the existing `naia-memory-rfc3161-digest-timestamp-evidence-v1` contract with `artifactSha256`.

## Security and reproducibility properties

- artifact intake is capped at 16 MiB;
- final symbolic links and non-regular files are rejected by the shared bounded-file reader;
- the query output uses exclusive `wx` creation and cannot overwrite an existing path;
- no JSON parsing or canonical re-serialization occurs before hashing;
- the existing verifier checks the response byte digest, trusted certificate chain, required policy OID, and RFC 3161 message imprint against `artifactSha256`;
- changing the artifact between request and seal produces evidence that fails trusted verification rather than a false acceptance.

## Evidence

- Focused regression: 1 file, 8 tests passed.
- Full regression: 127 files, 1,051 tests passed.
- Type checks: `tsconfig.typecheck.json` and `tsconfig.benchmark.json` passed.
- Biome and `git diff --check` passed.
- A real ephemeral OpenSSL TSA test proves artifact bytes → TSQ → TSA response → sealed evidence → trusted verification.
- Explicit tests cover 16 MiB + 1 refusal, final-symbolic-link refusal in request and seal modes, and request-file no-overwrite behavior.
- OpenCode DeepSeek adversarial post-review: no blocking findings, `VERDICT: PASS`. Its two non-blocking coverage suggestions were converted into explicit regression tests.

## Honest limitations

- This workflow has been exercised against a local ephemeral OpenSSL TSA; production publication still needs a separately controlled external TSA and retained trust policy.
- The CLI emits timestamp evidence to stdout. The operator must preserve those exact evidence bytes in the final publication package.
- The long-running Korean MIRACL full-corpus result is incomplete, so this step supports auditability only and makes no global retrieval-rank claim.
- Formal `review-pass` CLEAN evidence remains unavailable because deterministic preflight encounters unrelated user-owned untracked tool state under `.cache/tools/`; this is ordinary adversarial-review evidence, not a formal CLEAN attestation.
