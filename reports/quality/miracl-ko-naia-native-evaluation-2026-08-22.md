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

## Same-pool retrieval ablation

The frozen passage vectors and candidate pool were reused to isolate retrieval
fusion. All three modes ran through the same product retrieval implementation.

| Mode | nDCG@10 | MRR | Success@10 | Recall@100 | Median | p95 |
|---|---:|---:|---:|---:|---:|---:|
| Vector only | **0.6704** | **0.7379** | **0.9390** | 0.9727 | 54.6 ms | 73.9 ms |
| Equal-weight RRF | 0.6010 | 0.6476 | 0.8920 | **0.9851** | 1,166.9 ms | 1,306.9 ms |
| BM25 only | 0.3799 | 0.4132 | 0.6009 | 0.8919 | 1,060.8 ms | 1,178.8 ms |

Vector-only improved nDCG@10 by 0.0693 and MRR by 0.0903 absolute over
equal-weight RRF. At query level it won 87, tied 73, and lost 53 of 213 nDCG@10
comparisons. A deterministic 10,000-resample query bootstrap gave a descriptive
95% interval of [0.0338, 0.1049] for the mean nDCG@10 difference (seed
`0x4e414941`). This interval was computed post hoc and is not a preregistered
confirmatory test.

The RRF path recovered 0.0124 more relevant-document recall at depth 100, so the
lexical signal is not uniformly useless. On this candidate-pool Korean ranking,
it is harmful at the current equal weight near the top while still supplying a
small number of deep candidates. This rejects equal-weight RRF for this bounded
diagnostic; it does not justify changing the production default from a reduced,
label-conditioned candidate pool.

The latency gap is diagnostic, not a hardware-performance claim. The current
in-memory path rebuilds and scores BM25 for every query, whereas vector-only
skips that work. It identifies both a fusion-quality problem and an avoidable
index-lifecycle cost.

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
- Vector-only TREC SHA-256: `05c0f110358b28158f1b882ad6d2960044b65254d9c7d263dadb0abb6e08a925`
- BM25-only TREC SHA-256: `c81c199a7e2f51ce5f9ce08738c247806c7533967903989598352c91eb449f41`
- RRF result SHA-256: `d0801dfd0a2ea82e9f295bfbd72124f43846c4673e74a60910599076a05a1e7c`
- Vector-only result SHA-256: `fedb268c7f78bbeb25a23c885c77fdceb3e4b6910f40f1a3367a982f160d0de6`
- BM25-only result SHA-256: `6732ec5781013c57b519b111a0d1f814c8edfa85bab5c2d038e214339e293981`
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

Before this result can influence a public claim, preregister a fusion rule that
preserves vector top ranks while admitting lexical candidates only where they
add evidence, then validate it on the full locked Korean corpus rather than
tuning repeatedly on this pool. The BM25 index must also be built once per
corpus, not once per query. After that, replicate the same contract in English
and Arabic and compare against independently reproduced competitors. Until the
full-corpus and cross-language gates pass, vector-only is a candidate baseline,
not a new production default or a claim of Naia-specific superiority. A public
claim also requires a non-degraded independent review; the recovery-mode review
recorded here cannot satisfy that gate.
