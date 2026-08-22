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
