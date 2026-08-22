# Naia native Korean candidate diagnostic — first result

Date: 2026-08-22
Status: valid bounded diagnostic; public competitiveness remains **NO-GO**

## Result

Naia's production `searchLocalSemanticMemory` RRF path was run over 20,015
MIRACL Korean passages and all 213 development queries on CPU only.

| Metric | Result |
|---|---:|
| nDCG@10 | 0.6010 |
| MRR | 0.6476 |
| Success@1 | 0.5352 |
| Success@5 | 0.7793 |
| Success@10 | 0.8920 |
| Recall@10 | 0.7243 |
| Recall@100 | 0.9851 |

Median query latency was 1,166.9 ms and p95 was 1,306.9 ms on this unoptimized
20,015-document in-memory diagnostic. Passage embedding took 1,142.9 seconds;
retrieval took 252.4 seconds for 213 queries.

## What this proves

The native Naia path can retrieve at least one labelled passage in the top ten
for 89.2% of these Korean queries, and recovers 98.5% of labelled passages by
depth 100. The run called the product retrieval function with the product's
Korean-normalized BM25 and vector ranks fused by RRF. No LLM judge, entity
labels, knowledge graph, reranker, memory strength, or GPU influenced ranking.

## What this does not prove

The candidate pool was selected using relevance labels plus hard negatives from
two independent full-corpus systems. It is therefore easier than the 1,486,752-
document MIRACL Korean corpus and cannot be compared to leaderboard numbers.
It does not test memory updates, contradiction handling, lifecycle value,
English or Arabic, or superiority over mem0 and other global memory engines.
No public “global-level” or “best Korean engine” claim is justified yet.

## Evidence integrity

- Candidate list SHA-256: `e758692d71d0ab640927f3d9aaad741b88952b22e25707130adfe8e6d903ef08`
- Extracted corpus SHA-256: `d2c5cdaacb42d9a3000e1a016c2c3f3fd48f96898f3616d9421ac8c77b53ce7b`
- Vector SHA-256: `2006e65ce57d52b95a35dc10a69fc0914dfc24f20a878ba71dff2323f5dfd930`
- TREC run SHA-256: `45f9517ef243034319a14b2156aac1aa587b19d353b17a9732631ca1b5a3ad76`
- Model: `Xenova/multilingual-e5-large`, revision
  `00fc3aeb3dbb95842de2ac1961d33c6319acf57b`, q8, normalized, 1024 dimensions
- Execution configuration: `device=cpu`, `CUDA_VISIBLE_DEVICES=""`

Original topics, qrels, and three corpus shards were size- and SHA-256-verified
before extraction. Vector reuse is bound to candidate, extracted corpus, model
policy, dimensions, count, and vector hash. The external vector and run files
remain outside git because of their size.

## Adversarial review

OpenCode identified stale same-size vector reuse, ambiguous cached timing, and
missing execution-time source verification. These were fixed before the valid
run. Its E5-prefix and recall-mutation objections were rejected after source
inspection: asymmetric `query:`/`passage:` prefixes are the intended E5 policy,
and `deepRecall=true` excludes strength from final scoring. Claude headless was
not available because its local CLI was not authenticated. Recovery mode means
this is degraded external review, not a formal multi-review CLEAN result.

## Next gate

Before this result can influence a public claim, measure frozen vector-only and
BM25-only ablations on the same pool, then run the full locked Korean corpus.
After that, replicate the same contract in English and Arabic and compare
against independently reproduced competitors. The first immediate question is
whether Naia RRF improves over its embedding model or merely inherits it.
