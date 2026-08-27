# MIRACL RFC 3161 durable evidence output — 2026-08-23

## Outcome

RFC 3161 evidence can now be persisted by the CLI without shell redirection:

```text
seal-file-output <artifact> <response.tsr> <evidence.json>
```

The command retains the exact-file hashing and existing digest-evidence schema, writes deterministic evidence bytes, and reports the SHA-256 of the exact file bytes. Existing `seal-file` stdout behavior remains unchanged.

## Durability and preservation contract

- evidence bytes are `canonicalEvidenceJson(evidence)` plus one newline;
- a 96-bit random sibling temporary file is created with `O_CREAT | O_EXCL | O_NOFOLLOW` and mode `0600`;
- file contents are synchronized before publication;
- a hard link atomically publishes the final name and refuses an existing regular file or symbolic link;
- the parent directory is synchronized after publication;
- the temporary name is removed on success or failure;
- stdout reports only `evidenceSha256`, computed from the same buffer written to disk.

## Evidence

- Focused regression: 1 file, 9 tests passed repeatedly.
- Full regression: 127 files, 1,052 tests passed.
- Type checks: `tsconfig.typecheck.json` and `tsconfig.benchmark.json` passed.
- Biome and `git diff --check` passed.
- The real ephemeral OpenSSL TSA test reads the persisted evidence and completes trusted chain, policy OID, token digest, and message-imprint verification.
- Existing regular-file and symbolic-link outputs are proven unchanged after refusal.
- OpenCode DeepSeek pre-review: `VERDICT: BLOCK` because the proposed reuse of the old writer did not synchronize the parent directory.
- The implementation added parent-directory synchronization; post-review found no blocking issue and returned `VERDICT: PASS`.

## Honest limitations

- This is Linux/POSIX-oriented durability: it depends on `O_NOFOLLOW`, hard links, and directory `fsync` behavior.
- If directory synchronization fails after the hard link succeeds, the command returns failure even though the final name may already be visible. It never reports a successful evidence digest in that state; operator recovery is required.
- The output path is operator-selected, matching the existing request-file CLI contract. This command is not a path sandbox.
- External temporal custody still requires a separately controlled TSA and retained trust material.
- This improves publication integrity, not retrieval quality, and does not support a global benchmark-rank claim while the Korean MIRACL full-corpus run remains incomplete.
- Formal `review-pass` CLEAN evidence remains unavailable because deterministic preflight encounters unrelated user-owned untracked tool state under `.cache/tools/`; the review verdicts above are ordinary read-only adversarial reviews.
