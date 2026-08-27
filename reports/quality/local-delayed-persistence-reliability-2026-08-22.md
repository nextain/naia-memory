# Local delayed-persistence reliability — 2026-08-22

## Outcome

The JSON-backed `LocalAdapter` no longer turns a recoverable failure in its
debounced timer write into an uncaught exception. The failed store remains
dirty, the timer is cleared, and a later mutation or an explicit `flush()` can
retry. Background failures are observable through `onPersistenceError`; when
no observer is configured, Node emits a
`NAIA_MEMORY_DELAYED_SAVE_FAILED` warning. An observer that throws is contained
inside the timer callback.

Explicit durability boundaries are unchanged: `flush()` and `close()` still
reject when persistence or directory sync fails. This avoids reporting durable
success when only rename, but not parent-directory fsync, completed.

## Adversarial-review finding

The first OpenCode review returned `MODIFY` because the initial catch had no
operator-visible signal. After adding callback/default-warning coverage, a
second adversarial pass found a separate high-severity consistency defect:
`reindexEmbeddings()` rolled back in-memory vectors after an
`AtomicReplaceCommittedError`, although the replacement file had already been
renamed. That could diverge memory from disk and allow a later save to overwrite
the committed reindex with stale vectors. The reindex path now follows the
existing import rule and does not roll back after a committed replacement.

The final OpenCode gate returned `PASS` with no high- or medium-severity
findings. A formal `review-pass` CLEAN claim is not made: recovery mode is
active and preflight rejected the existing untracked independent `trec_eval`
working tree. That evaluator was left untouched because it belongs to the
active MIRACL evidence run.

## Verification

- Full test suite: 102 files, 891 tests passed.
- Build: passed (`tsc`).
- Typecheck: passed for product and benchmark configurations.
- Focused coverage proves transient retry, persistent explicit-flush failure,
  later-mutation retry, observer containment, default warning, and committed
  reindex memory/disk alignment.
- `git diff --check`: passed.

## Claim boundary

This is a deployment-reliability improvement, not evidence of retrieval-score
gain. It strengthens Naia Memory's local durable lifecycle path, but it does not
change the current public benchmark verdict. Global retrieval claims remain
blocked on the preregistered full-corpus MIRACL result and independent
multilingual lifecycle evidence.

## Follow-on preservation audit

The next adversarial pass identified a separate high-severity load hazard. A
read error, malformed JSON, unsupported version, or invalid top-level store
shape was previously treated as an empty store. The next mutation could then
atomically replace the unreadable original with fresh data, destroying the only
copy without warning.

`LocalAdapter` now starts fresh only for `ENOENT`. Every other load failure is
wrapped in `LocalStoreLoadError` and fails construction before any write can be
scheduled. Existing version-1 status migration remains intact. Tests cover a
missing store, malformed JSON, unsupported version, invalid shape, a read error,
and byte-for-byte preservation of rejected files. `LocalStoreLoadError` is
re-exported from the package entry point so hosts can distinguish this fail-safe
condition without relying on message parsing or a deep import.

The follow-on OpenCode adversarial gate returned `PASS`. It noted that store
validation remains intentionally top-level, matching encrypted-backup
validation; deep field validation is a separate hardening opportunity rather
than a regression in this fix.

## Nested-store integrity follow-on

That hardening opportunity is now implemented. Direct JSON loads and encrypted
backup restores share one runtime validator for episodes, facts, epochs,
skills, reflections, associations, knowledge-graph state, embedding maps, and
embedding-space identity. Invalid nested values fail closed before adapter
state is installed; rejected direct files remain byte-for-byte untouched.

The first adversarial review rejected array-only validation because malformed
elements could still be narrowed to product types and crash downstream. After
element validation and corruption tests were added, the second review found a
high-severity compatibility regression: pre-lifecycle v1 facts without
`status` were rejected before the existing `active` migration could run. Both
direct load and backup restore now use the same normalize-then-validate path.
Empty embedding vectors are also rejected.

The final adversarial review returned `PASS` after challenging two proposed
findings that were not supported by the declared contracts: empty strings in a
`string[]` and empty keys in a `Record<string, number[]>` cause neither a
runtime failure, security issue, nor compatibility break. No stronger semantic
invariant was introduced without evidence.

Verification after the follow-on:

- Focused load/backup suite: 2 files, 31 tests passed.
- Full suite: 103 files, 905 tests passed.
- Build and typecheck: passed (`tsc`).
- Formal `review-pass` CLEAN remains unclaimed for the recovery-mode/preflight
  reason recorded above; OpenCode review evidence is advisory, not a formal
  signed gate.

This remains reliability and data-integrity evidence, not retrieval-quality
evidence. The independent full-corpus MIRACL run continues separately and was
not restarted or altered by this change.
