# MIRACL-ko full-corpus competitive evidence

Date: 2026-08-23

## Result

Naia's current base retrieval path completed the full MIRACL Korean development
benchmark over 1,486,752 passages and 213 queries using exact Qdrant cosine
search on CPU. NIST `trec_eval` independently reproduced:

| Metric | Naia base retrieval | MIRACL BM25 + mDPR | Delta |
| --- | ---: | ---: | ---: |
| nDCG@10 | 0.6526 | 0.609 | +0.0436 |
| Recall@100 | 0.9233 | 0.900 | +0.0233 |

The run also recorded Success@1 0.5962, Success@10 0.9202, Recall@10
0.7475, and MRR 0.7228. Mean query latency was 202.10 ms and maximum query
latency was 1,040.76 ms in the self-observed CPU run. The ingestion-duration
field is excluded from performance claims because its timer semantics are not
tightly specified.

## What this proves

This is strong evidence that the Korean base retriever is not the obvious weak
link. Under a protocol-matched historical comparison, both primary metrics
exceed the strongest frozen MIRACL Korean row by more than its three-decimal
reporting resolution. The result is full-corpus, exact-search, hash-bound, and
independently metric-reproduced.

## What this does not prove

It does not establish current global SOTA, a Naia-specific memory innovation,
superiority to current memory engines, multilingual quality, statistical
significance against the historical systems, or independent-lab reproducibility.
The multilingual-e5-large model reports MIRACL training-split use, so this is
not dataset-family zero-shot evidence. Accordingly the machine-readable result
keeps `publicClaimEligible: false`.

## Public-report gate

A defensible public competitive report still needs both of these evidence
families:

1. The same sealed full-corpus protocol in at least English and Japanese, with
   language-level failure analysis, to test whether the Korean result transfers.
2. A preregistered, sufficiently powered lifecycle campaign against Mem0,
   Hindsight, Graphiti's correctly named native historical surface, and Letta's
   separately named agent-managed surface. The primary claim must concern
   update/supersession behavior, where Naia can demonstrate product-specific
   value rather than inherited embedding quality.

Until those gates pass, the publishable wording is: **Naia demonstrates strong
Korean full-corpus base retrieval, exceeding the strongest frozen
protocol-matched MIRACL comparison row on nDCG@10 and Recall@100. Its distinctive
memory-update advantage remains under evaluation.**
