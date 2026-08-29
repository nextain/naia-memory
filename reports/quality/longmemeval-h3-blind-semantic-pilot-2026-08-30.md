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
feasible, bounded, and repeatable for one case. It does not establish retrieval
quality, answer accuracy, superiority over the keyword-fallback control, or a
global SOTA claim.

Before the 500-case run, the harness still needs resumable per-case checkpoints
and aggregate custody validation. The preregistered support decision remains:
semantic retrieval must beat the keyword-fallback control on overall judged
accuracy without lowering abstention accuracy, with valid receipts throughout.
