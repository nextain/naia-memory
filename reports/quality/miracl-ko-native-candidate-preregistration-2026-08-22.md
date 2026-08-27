# MIRACL Korean native candidate diagnostic preregistration

Date: 2026-08-22 (Asia/Seoul)

Status: preregistered before inspecting dense-run effectiveness or candidate-pool geometry

## Purpose and claim boundary

This stage tests Naia Memory on a difficult, reproducible Korean retrieval
diagnostic derived from independent full-corpus retrieval. It is not an official
MIRACL score because the candidate pool is selected with relevance labels and
retriever outputs. Results must be labeled `label-conditioned hard-negative
diagnostic` and must not be compared directly with published full-corpus MIRACL
leaderboard scores.

## Frozen inputs

- Dataset: MIRACL v1.0 Korean development topics and qrels
- Dataset revision: `5be20db9509754dadad47689368639fcec739c00`
- Corpus revision: `d921ec7e349ce0d28daf30b2da9da5ee698bef0d`
- Corpus size: 1,486,752 documents
- Lexical generator: Pyserini `miracl-v1.0-ko` BM25, top 100
- Dense generator: Pyserini `miracl-v1.0-ko-mcontriever-pft-msmarco`,
  `facebook/mcontriever-msmarco`, top 100, CPU-only

The dense generator is not trained on MIRACL Korean labels. Lexical and dense
runs must have distinct source identifiers and content hashes.

## Frozen pool gates

- Include every judged-positive document present in the locked corpus.
- For every judged query, retain at least 50 non-positive documents uniquely
  contributed by the lexical run and at least 50 uniquely contributed by the
  dense run. A document already accepted from lexical does not count toward the
  dense minimum.
- Require global unique-hard-negative ratio at least 0.50, calculated as unique
  retained hard negatives divided by accepted query-source assignments.
- Pool mode: `required-only`; no random filler is permitted.
- Fail closed on missing positives, insufficient per-source query coverage,
  duplicate source identifiers, or any gate violation.

These thresholds are frozen before dense-run completion and before observing
pool size, overlap, or Naia effectiveness. A failure may motivate a separately
versioned experiment, but this preregistration must not be edited to turn that
failure into a pass.

## Required evidence

The stage receipt must include immutable input identifiers, raw-run SHA-256
hashes, per-query/per-source retained counts, global uniqueness, pool SHA-256,
and zero filler count. Naia evaluation must report paired query-level metrics
with uncertainty and must preserve the diagnostic claim boundary above.
