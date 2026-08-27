# MIRACL Arabic completion and English primary gate checkpoint

Date: 2026-08-25

## Outcome

The CPU-only Arabic MIRACL full-corpus vector-exact run completed over 2,061,414
documents and 2,896 queries. The result is meaningful evidence for multilingual
embedding retrieval at full-corpus scale, but it is not evidence that Naia is the
best global memory engine.

| Metric | Result |
| --- | ---: |
| Success@1 | 0.700622 |
| Success@5 | 0.886740 |
| Success@10 | 0.924378 |
| Recall@10 | 0.834449 |
| nDCG@10 | 0.743225 |
| MRR | 0.782540 |
| Recall@100 | 0.962765 |
| Mean exact-query latency | 1,005 ms |
| Maximum exact-query latency | 1,677 ms |
| Ingestion time | 104,768 s (29.1 h) |

## Evidence integrity

- Result SHA-256: `4be7f9d583452ee815c8f808172ad6536f4161f356449b46bdf28c052253776d`
- TREC SHA-256: `a9f4e06588f8cc7965e939f2ed265fe90d5269a873e6e876bfe8ce7fdc702e0a`
- Runtime observation v2 SHA-256: `dd4b35d6bbd987a4593907aeb75e100ca393e5425bf0662984615ed56e615c29`
- Launch receipt v2 SHA-256: `bd6feeb1c7bd0e6613b55bed59a2b93bddfc3be2def9d58d8230730adab48e8f`
- Checkpoint chain: 4,027 chunks, 2,061,414 documents, terminal receipt
  `e20ac01282f39e851e12e0ece213acc1890d8b5a7cf42ce2ac2afb5b59940eb6`
- Corpus doc-ID SHA-256: `b81389dd2afad4d0273ec92c25f446b478cb41afb8327c162f8919d93b3c3659`

The result, TREC output, runtime observation, launch receipt, and checkpoint
chain agree. Qdrant was stopped after completion, so a new live completion
receipt cannot now be issued honestly. This checkpoint therefore claims a
completed, hash-bound retrieval run; it does not claim current live collection
state.

## English primary execution improvement

The production evaluator now invokes
`verifyMiraclEnPrimaryExecutionLaunch(process.env)` for English before any
Qdrant access. The gate checks explicit opt-in, pinned paths and outputs,
canonical authorization, source and runtime manifests, vector artifact bytes,
and the source-derived sample against the locked corpus. A process-level test
launches the real CLI with an unreachable Qdrant endpoint and confirms that it
fails on missing English authorization first.

The evaluator source pin is
`23fe8c205c0e58d17eea87b25812827c3021b1ee8b0f09721fbbce57d9d2f251`,
which equals the current evaluator file digest.

Validation:

- 1,409/1,409 tests passed across 168 files.
- Both TypeScript configurations passed.
- Biome passed on the touched benchmark files.
- No GPU was used.

## Adversarial review and claim boundary

Claude and OpenCode were invoked independently through the read-only review
adapter. Claude timed out before first output; OpenCode exited with a provider
process error. Both are recorded as `NOT_RUN`, not as approvals.

The deterministic adversarial check found no authorization path from the English
evaluator to Qdrant before the launch verifier. The remaining evidence limits
are material:

1. MIRACL vector-exact measures embedding retrieval, not memory update,
   contradiction handling, temporal validity, deletion, personalization, or
   end-to-end agent usefulness.
2. Exact Qdrant search excludes ANN recall/latency trade-offs and the measured
   one-second query latency is not a production serving target.
3. The model and benchmark are public and multilingual, so the result is useful
   but cannot by itself rule out benchmark familiarity or goal-specific overfit.
4. A global superiority claim requires identical-protocol full-corpus results
   from additional engines, out-of-domain and multilingual held-outs, lifecycle
   update tests, repeated runs with uncertainty, and product-level latency/cost.

The defensible public wording at this checkpoint is: **Naia has demonstrated
strong Arabic full-corpus multilingual embedding retrieval with verifiable run
artifacts, while broader memory-engine superiority remains unproven.**

## Next research gate

Run the locked English primary full corpus through the newly fail-closed path,
then execute identical multilingual and lifecycle campaigns against Graphiti,
Hindsight, Mem0, and a plain-vector baseline. Promotion requires repeated runs,
confidence intervals, failure accounting, and no Naia-only scoring dimensions.
