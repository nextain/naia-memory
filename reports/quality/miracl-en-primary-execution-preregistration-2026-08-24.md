# MIRACL-en primary execution preregistration

Status: **DESIGN ACCEPTED WITH CHANGES; NOT AUTHORIZED; NOT PUBLIC-CLAIM ELIGIBLE**

## Purpose

MIRACL-en contains 32,893,221 passages. The completed corpus identity is fixed by source lock `99727481b47a8a423ad8fa54ca09c8296515fba17ce9c9ce6356e53654918549` and ordered docid digest `23a425f3889a6b6a3f41f32666cb748fca05ae2e750abad13ebbc0354ebb7847`.

The existing multilingual candidate gate remains unchanged: it requires a completed per-item full-corpus baseline before testing true-batch as a noninferior candidate. This document defines a different measurement target. English true-batch passage inference is preregistered as the primary frozen implementation before any English retrieval score exists. It does not stand in for, estimate, or compare against a full-corpus per-item result.

## Frozen target

- passages: `padded-array-batch-v1`, batch 8, chunk 512, source-lock file order then JSONL record order
- queries: `per-item-v1`
- model: `Xenova/multilingual-e5-large@00fc3aeb3dbb95842de2ac1961d33c6319acf57b`, q8, 1024 dimensions
- composition: `title + "\n" + text`
- runtime: CPU-only; `@huggingface/transformers@3.8.1`; `onnxruntime-node@1.21.0`
- frozen execution-policy SHA-256: `d2d6e0c505dbe11ff8e34999a7ddfff02f82ef977f739e7884153d63771e5856`
- retrieval: Qdrant exact cosine top-100; dedicated English service receipt
- output: `reports/quality/miracl-en-full-corpus-vector-exact-true-batch.json`
- checkpoints: `/var/mnt/hdd/naia-memory-benchmark/checkpoints/miracl-en-full-primary-batch-v1`

The HDD checkpoint location is mandatory: the estimated 64,245 chunks require roughly 135 GB before filesystem overhead, while the current home filesystem has only about 72 GB free.

## Pre-launch gates

1. Do not modify or reconnect the active evaluation CLI until the Arabic per-item run is complete and its source-bound evidence is closed.
2. Generate a deterministic, SHA-256-seeded, eight-length-stratum sample of 8,192 real MIRACL-en passages using production composition and order.
3. Measure per-item and true-batch vectors, repeat-run bit identity, ordinal-versus-shuffled batch sensitivity, length-stratified deltas, and observed throughput.
4. Build a SHA-256-seeded fixed 64-query retrieval diagnostic containing real English dev queries and qrels-positive passages; recompute nDCG and top-10/top-100 overlap from canonical raw rankings and qrels. These are disclosure diagnostics, not equivalence gates.
5. Require finite 1024-dimensional vectors and exact repeatability. All other deltas must be reported without converting them into an equivalence claim.
6. Bind source, producer, policy, runtime, Qdrant, output, TREC, checkpoint, and evaluation-source identities in a canonical authorization receipt.
7. Fail closed if either result or TREC already exists, if output/checkpoint paths differ, if GPU is visible, or if candidate and primary authorizations are requested together.

## Claim boundary

Even after a successful run, the evidence supports only the score of this frozen mixed execution (`padded-array-batch-v1` passages plus `per-item-v1` queries) on MIRACL-en exact retrieval. It does not support per-item equivalence or noninferiority, throughput superiority, multilingual transfer, Naia lifecycle quality, ANN quality, product latency, SOTA, or public comparison eligibility.

If a later MIRACL-en execution mode is run, every completed mode result must be disclosed regardless of score. Korean and Arabic remain explicitly `per-item-v1`; mixed modes may not be aggregated into one multilingual score.

## Adversarial review

The implementation review on 2026-08-24 returned `ACCEPT_WITH_CHANGES` from opencode and `REJECT` from Claude. The first remediation pass now computes and verifies raw-ranking and vector artifact digests, fixes the retrieval sample at 64 seeded queries, pins the execution-policy digest as a literal, excludes the active Arabic Qdrant port, isolates the English collection by source and policy digest, and marks public, equivalence, noninferiority, throughput, multilingual-transfer, and SOTA claims ineligible.

Authorization remains blocked. A source-lock-derived corpus extraction receipt, direct topics/qrels byte verification, full producer source-set closure, live Qdrant re-verification, checkpoint/attempt-ledger controls, and mandatory evaluation-CLI wiring are not yet implemented. Until those controls and their positive/fail-closed tests pass a second independent review, this document authorizes neither the English run nor an external claim.
