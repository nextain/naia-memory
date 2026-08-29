# LongMemEval H3 preregistration

Date: 2026-08-30
Status: preregistered; no H3 answer generation or judging has run

## Question

Can Naia Memory's production storage and semantic retrieval path improve end-to-end LongMemEval answer quality over its own keyword-fallback control under a fixed, upstream-compatible reader and judge protocol?

## Why this is the next valid claim

H2 established protocol conformance and deterministic retrieval over all 500 cleaned LongMemEval cases. It did not measure answer quality. H3 is intentionally narrower than a global-SOTA claim: it measures whether Naia's semantic retrieval adds value under one frozen protocol before any vendor result is treated as comparable.

## Frozen inputs and code

- Cleaned dataset revision: `98d7416c24c778c2fee6e6f3006e7a073259d48f`
- Cleaned dataset SHA-256: `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`
- Cases: 500
- Official LongMemEval harness revision: `9e0b455f4ef0e2ab8f2e582289761153549043fc`
- Naia starting implementation: `3ae12b1`
- Machine-readable contract: `src/benchmark/quality/longmemeval-h3-contract.json`

The contract also pins the SHA-256 digests of the five upstream generation and evaluation files used by this protocol.

## Frozen Naia retrieval lane

- Production `MemorySystem.encode()` and `MemorySystem.recall()` over `LocalAdapter`
- One isolated project scope per question
- `OfflineEmbeddingProvider`, `multilingual-e5-large`
- Model revision `00fc3aeb3dbb95842de2ac1961d33c6319acf57b`
- RRF search mode; no consolidation
- Flat-turn retrieval, top 50
- Expand a selected user turn to the same round by including its next turn
- Re-sort selected material by ascending timestamp before reading

The answer, `answer_session_ids`, and turn-level `has_answer` labels remain unavailable to retrieval until its artifact is frozen and hashed.

## Frozen reader and judge

The reader is `gpt-4o-2024-08-06`, temperature 0, maximum 800 output tokens, JSON history, and the official Chain-of-Note prompt. The judge is the same model at temperature 0 and maximum 10 output tokens, using the official task-specific prompts.

The official score preserves the upstream case-insensitive `yes` substring parser for comparability. A stricter exact `yes`/`no` parse is reported alongside it as an integrity diagnostic. One official judge run is primary; one identical rerun is a stability audit and cannot replace the primary result.

## Outcomes and decision rule

Primary outcomes are official overall accuracy, task-averaged accuracy, per-type accuracy, and abstention accuracy. Retrieval recall/NDCG at 5, 10, and 50 are diagnostics; the official retrieval metrics exclude abstention cases.

H3 is supported only if the complete 500-case pipeline validates, custody and provider receipts are complete, retrieval was frozen before labels were opened, both judge parses are reported, and semantic Naia exceeds the preregistered keyword-fallback control in overall accuracy without reducing abstention accuracy. Otherwise H3 is refuted.

Even a supported H3 establishes only a protocol-matched Naia result. It does not establish global SOTA or superiority over vendor-reported numbers that use different prompts, models, top-k cutoffs, datasets, or revisions.

## Primary-source basis

- LongMemEval paper, arXiv:2410.10813: experiments sort retrieved items by timestamp; JSON plus Chain-of-Note is the default reading design; greedy generation is capped at 800 tokens.
- Official LongMemEval generation scripts at the pinned revision: GPT-4o resolves to `gpt-4o-2024-08-06`, the shell default context is top 50, and the default `con` reading lane enables Chain-of-Note.
- Official evaluation scripts at the pinned revision: task-specific GPT-4o judging, temperature 0, 10-token cap, and official metric aggregation.

## Execution order

1. Validate and commit this preregistration.
2. Run a label-blind semantic embedding and retrieval throughput pilot.
3. Freeze and hash the full semantic retrieval artifact.
4. Open labels only for retrieval diagnostics and frozen answer evaluation.
5. Run the fixed reader and primary judge, then the stability audit.
6. Publish all receipts, costs, failures, strict-parser disagreements, and the decision outcome.
