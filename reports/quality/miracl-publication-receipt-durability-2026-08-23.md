# MIRACL publication receipt durability — 2026-08-23

## Outcome

Full-corpus bundle publication receipts and RFC 3161 evidence now use one
exclusive exact-byte publication primitive. Both paths synchronize file
contents before atomically linking the final name, refuse to replace an
existing regular file or symbolic link, and synchronize the parent directory
after publication.

This closes a durability mismatch: RFC 3161 evidence already synchronized the
parent directory, while `publish-collect` receipts previously stopped after
file synchronization and atomic linking.

## Contract

- output bytes are prepared completely before publication;
- a 96-bit random sibling temporary file is opened with
  `O_CREAT | O_EXCL | O_NOFOLLOW` and mode `0600`;
- the temporary file is written and synchronized before publication;
- a hard link publishes the final name without overwriting an existing entry;
- the parent directory is synchronized after the final link;
- the temporary name is removed on success or failure;
- both publication CLIs share the same implementation.

## Evidence

- Focused regression: 3 files, 13 tests passed.
- Full regression: 129 files, 1,056 tests passed.
- Type checks: `tsconfig.typecheck.json` and `tsconfig.benchmark.json` passed.
- Biome and `git diff --check` passed.
- The helper test proves exact output bytes and observes one parent-directory
  synchronization request for the final path.
- The `publish-collect` CLI test proves canonical exact bytes and the reported
  SHA-256, and proves refusal preserves existing regular-file and symbolic-link
  destinations.
- OpenCode DeepSeek post-review returned `VERDICT: PASS` for the extraction,
  atomic publication, overwrite protection, and qualified portability claim.
- A second Claude headless review read the two new tests explicitly and returned
  `VERDICT: PASS`.

## Honest limitations

- Crash-durability is qualified to Linux/POSIX filesystems that implement
  directory `fsync`; other platforms and filesystems may provide weaker
  persistence guarantees.
- If parent-directory synchronization fails after the hard link succeeds, the
  CLI returns failure although the final file may already be visible. A retry
  then reports that the output exists; operators must inspect and recover that
  state. The file is complete, not partially written.
- A crash between final-link synchronization and temporary-name cleanup may
  leave a harmless sibling temporary file.
- This strengthens benchmark evidence custody. It does not improve retrieval
  quality and is not evidence of global rank.
- At this checkpoint the CPU-only Korean MIRACL full-corpus evaluation had
  produced 2,089 receipts, covering 1,069,568 of 1,486,752 documents (71.9%).
  Final quality and competitor claims remain gated on completion and independent
  execution/publication evidence.
- Formal `review-pass` CLEAN evidence remains unavailable because deterministic
  preflight encounters unrelated user-owned untracked tool state under
  `.cache/tools/`; the verdicts above are ordinary read-only adversarial reviews.

## Follow-up: directory-sync failure recovery

The shared writer now distinguishes a parent-directory synchronization failure
that occurs after successful final-name publication from an ordinary write
failure. Both CLIs report that the output was written but crash-durability could
not be confirmed, and direct the operator to inspect the existing output before
retrying. The typed error preserves the final path and original cause.

The regression proves that the exact final bytes exist after injected directory
sync failure, a retry receives `EEXIST`, and the retry cannot replace those
bytes. CLI-level tests cover the recovery wording for both full-corpus
publication receipts and RFC 3161 evidence.

- Focused follow-up regression: 3 files, 16 tests passed.
- Full follow-up regression: 129 files, 1,059 tests passed.
- Both TypeScript configurations, Biome, and `git diff --check` passed.
- Claude headless pre-review corrected the proposed wording and returned
  `VERDICT: PASS`; post-implementation review returned `VERDICT: PASS`.
- At the later checkpoint, 2,149 vector receipts covered 1,100,288 of 1,486,752
  Korean MIRACL documents (74.0%), still CPU-only.
