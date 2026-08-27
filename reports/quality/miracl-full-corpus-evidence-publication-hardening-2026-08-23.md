# MIRACL Full-Corpus Evidence Publication Hardening

Date: 2026-08-23

## Outcome

The completed MIRACL full-corpus result can already be reproduced with the
pinned NIST `trec_eval` binary by
`benchmark:miracl-full-corpus-evidence`. The missing safeguard was at the final
receipt publication boundary: the CLI used a temporary-file rename that could
replace an existing evidence receipt and did not synchronize the parent
directory.

The CLI now publishes the exact receipt bytes through the shared exclusive
evidence writer. That writer synchronizes the file, creates the final path with
a no-overwrite hard link, and synchronizes the parent directory. A concurrent
or repeated invocation therefore fails with `EEXIST` instead of replacing the
first receipt.

Directory synchronization failure has distinct recovery semantics: the CLI
states that the output was written but crash durability could not be confirmed
and instructs the operator to inspect the existing output before retrying.
Other writer failures fail closed without emitting a success receipt.

## Scope decision

No completion orchestrator was added. Runtime observation already waits for the
bound process to exit and for its declared output, while the evidence command
already verifies the checkpoint chain, immutable result and TREC hashes,
canonical topics and qrels, live Qdrant identity and point count, pinned
`trec_eval` source and binary identities, and metric agreement. Another wrapper
would duplicate sequencing without making the locally operated run independent.

The evidence CLI was instead made import-safe and its publication boundary was
extracted for direct failure-injection testing.

## Verification

- Focused suite: 19 tests passed after the final review fix.
- Full suite before the final review fix: 129 files and 1,062 tests passed.
- Both `tsconfig.json` and `tsconfig.benchmark.json` typechecks passed.
- Biome passed on the changed files.
- Claude Sonnet post-implementation adversarial review: `PASS`; its two minor
  observations (unchecked error-code access and missing fallback writer test)
  were addressed after the review.

The pre-implementation Claude and OpenCode attempts failed to return a verdict;
they are not counted as successful reviews. Repository-wide formal
`review-pass` CLEAN is also not claimed because the preserved user-owned
`.cache/tools/trec_eval-ba38899/` path still prevents its deterministic
preflight.

## Claim boundary

This change hardens the integrity and recoverability of locally generated
evidence. It does not turn a self-observed run into an independent execution,
does not establish multilingual quality, and does not establish superiority as
a complete memory engine. Those claims remain gated by the completed score,
external signed execution attestation, lifecycle evidence, and a non-Korean
run under a frozen contract.
