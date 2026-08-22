# MIRACL Korean global comparison contract

Date: 2026-08-22 (Asia/Seoul)

Status: frozen before the Naia full-corpus score is available

## Purpose

This contract prevents the full-corpus Korean retrieval result from being
presented as a broader memory-engine result. The primary comparison is limited
to runs on the MIRACL v1.0 Korean development split with all 1,486,752 corpus
passages, 213 queries, and the official nDCG@10 and Recall@100 definitions.

## Metric compatibility

The locked Korean qrels contain 547 positive rows for 213 queries. Every
positive judgment has relevance `1`; 2,510 explicit judgments have relevance
`0` and are excluded. Therefore binary DCG with `1/log2(rank + 1)`, normalized
by the ideal top-ten ranking, is equivalent to the official nDCG@10 calculation
for this split. Recall@100 is the mean, over all 213 queries, of unique judged
positive passages retrieved in the first 100 divided by that query's positive
judgment count.

The generated TREC run is the interchange artifact. Before a public claim, its
metrics must be reproduced by an independent evaluator or a separately
implemented parser, not accepted solely from the benchmark runner's in-process
calculation.

The independent evaluator is NIST `usnistgov/trec_eval` pinned to commit
`ba38899cbd4de0fb699b47f39b64ef1c107e4a5c` (reported version `10.0-rc3`). Its
upstream `make quicktest` suite passed locally before the benchmark completed.
The frozen invocation is:

```text
trec_eval -m ndcg_cut.10 -m recall.100 <locked-qrels> <generated-trec-run>
```

Both `all` values must agree with the JSON result within `1e-6`. The evaluator
commit, command, stdout, binary SHA-256, and agreement deltas belong in the
final evidence receipt.

## Frozen historical reference rows

The MIRACL dataset paper's Table 5 reports the following Korean development
scores. These rows are historical protocol-matched reference points, not a
claim about the current global state of the art.

| System | nDCG@10 | Recall@100 | Class |
| --- | ---: | ---: | --- |
| BM25 | 0.419 | 0.783 | lexical |
| mDPR | 0.419 | 0.737 | dense |
| BM25 + mDPR | 0.609 | 0.900 | hybrid |
| mColBERT | 0.487 | 0.722 | late interaction |
| mContriever | 0.483 | 0.875 | dense |
| in-language retriever | 0.472 | 0.807 | dense |

Primary source: [MIRACL dataset paper, Table 5](https://aclanthology.org/2023.tacl-1.63.pdf).

## Allowed statements

After the run and independent metric reproduction, the report may state the
measured Naia vector score and its numerical difference from each frozen row.
It may call a result stronger or weaker only on the corresponding metric and
protocol. It must identify the actual embedding policy, including model,
revision, q8 quantization, prefixes, pooling, title composition, and exact
search.

## Prohibited statements

- “best global memory engine”, “state of the art”, or equivalent language;
- attribution of base-model retrieval quality to Naia's lifecycle algorithms;
- comparison with Mem0, Zep, Letta, or other memory engines using MIRACL;
- comparison with leaderboard/model-card values whose corpus, split, passage
  composition, query instruction, candidate depth, reranking, or metric
  implementation cannot be shown compatible;
- treating a Korean development result as evidence for every language;
- hiding that multilingual-e5-large used MIRACL training data (training split
  only, according to its model card), even though development qrels were not
  used by this run.

## Evidence needed for a public competitiveness report

1. Completed immutable full-corpus result and TREC artifact with matching
   hashes and 1,486,752 indexed points.
2. Independent reproduction of nDCG@10 and Recall@100 from the TREC artifact.
3. Adversarial review of source locks, model policy, metric compatibility,
   leakage/overfitting risk, and claim wording.
4. Separate lifecycle/update evidence against memory-engine peers. MIRACL can
   support the multilingual retrieval section but cannot replace that evidence.
5. At least one non-Korean full-corpus run under the same frozen runner before
   claiming multilingual behavior beyond the base model's documented support.

## Interpretation threshold

Beating BM25 or mDPR alone is not a publishable differentiator. Matching or
exceeding the historical hybrid row on both metrics would be a strong base
retrieval result, but still not a Naia-specific innovation because the run uses
an existing multilingual embedding model. Naia's defensible differentiation
must additionally come from independently measured memory update, temporal
validity, contradiction handling, consolidation, and operational integration.
