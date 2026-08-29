# LongMemEval H3 blind semantic pilot

Date: 2026-08-30
Scope: engineering feasibility and reproducibility; not answer-quality evidence

## Result

Naia's production `MemorySystem` + `LocalAdapter` completed blind ingestion,
offline semantic reindexing, and strict-project RRF top-50 recall for the first
official LongMemEval case (550 turns). Two clean-store runs returned the same
ordered retrieval SHA-256:

`d2456d57fad5215328e7dd5235eedbc2736ae4e3f2644b583939677184c66950`

Both stores were 15,019,399 bytes and returned 50 episodes. Reindex wall time
was 138.4 seconds and 135.6 seconds; recall took 56.5 ms and 63.0 ms.

## Memory correction

The first unbounded padded-array batch attempt was stopped after 5 minutes 21
seconds and reached 30,431,464 KiB maximum RSS. A bounded provider now delegates
at most eight texts per embedding batch while preserving result order. The two
successful runs reached 3,654,116 KiB and 3,650,784 KiB maximum RSS under GNU
`time`, an approximately 88% reduction from the failed attempt.

The benchmark receipt distinguishes receipt-time RSS from process maximum RSS.
The chunk boundary is covered by unit tests, including ordering, maximum batch
size, and invalid configuration rejection.

The runner now writes one owner-only checkpoint per completed case through a
temporary file and atomic rename. Each checkpoint binds the input file hash,
blind content hash, policy hash, case ordinal, question ID, and retrieval
result. A real repeat validated and reused the checkpoint
(`reusedCheckpointCount=1`) rather than reindexing; its core checkpoint loop
completed in 0.44 ms.

## Multi-case interruption recovery

The runner now accepts an absolute case offset, validates a contiguous range,
reports each reused or completed case, and atomically writes the final aggregate.
An explicit forced-stop control exists for recovery testing.

A real two-case test reused case 0, completed and checkpointed case 1, and then
intentionally exited with status 1. No aggregate file existed after that stop.
Case 1 covered 485 turns, returned 50 episodes with ordered retrieval SHA-256
`4ca2099abd79ed80b38ea228db618b99df6eafdfefbe2d7b16293cd7a7cf9d96`,
and produced a 13,299,612-byte store. Its semantic reindex took 121.2 seconds
and recall took 65.5 ms; the forced-stop process reached 2,699,916 KiB maximum
RSS under GNU `time`.

The same two-case command then reused both checkpoints, executed zero new
cases, and atomically emitted the aggregate in 2.69 seconds wall time. The
aggregate binds 1,035 turns, 28,319,011 store bytes, two case results, the same
blind corpus identity, and the same semantic policy identity. Unit coverage
also proves a three-case forced stop after two new checkpoints resumes by
executing only the remaining case. Invalid checkpoint integer ranges, identity
drift, input drift, and policy drift fail closed.

## Evidence custody

- Input: label-free corpus only; `answer`, `answer_session_ids`, and
  `has_answer` were removed before the retrieval process.
- Blind content SHA-256:
  `bd6a6b017bd59479baecbee4047197511b2051551e0b0966755f8d0e06624f63`
- Model: `Xenova/multilingual-e5-large`, revision
  `00fc3aeb3dbb95842de2ac1961d33c6319acf57b`, CPU execution.
- Search: strict one-project scope, deep RRF, top 50.
- Clean-store repeat: question ID, turn count, retrieval count, ordered
  retrieval hash, and store bytes all matched.

## Claim boundary and next gate

This supports only that the preregistered blind semantic retrieval path is
feasible, bounded, repeatable, and interruption-safe for the two exercised
cases. It does not establish retrieval
quality, answer accuracy, superiority over the keyword-fallback control, or a
global SOTA claim.

The resumable sharding and bounded campaign gate subsequently passed with 100
deterministic five-case shards and fail-closed merge validation. The next gate
is full semantic and keyword-fallback execution, answer generation, and judging
across all 500 cases. The preregistered support decision remains: semantic
retrieval must beat the keyword-fallback control on overall judged accuracy
without lowering abstention accuracy, with valid receipts throughout.
