# MIRACL multilingual source lock

Date: 2026-08-23

Status: **KO anchor plus EN/AR transfer sources qualified; retrieval evidence
remains pending**

## Purpose

The Korean full-corpus result is strong evidence for Korean base retrieval, but
it cannot by itself distinguish a generally useful multilingual retrieval stack
from Korean or benchmark-family overfit. Before observing transfer scores, this
checkpoint freezes native MIRACL Korean, English, and Arabic development sources
and their complete provider manifests.

The campaign roles are fixed as:

- Korean: existing anchor result.
- English: required transfer result.
- Arabic: required transfer result and the first feasible CPU-only execution
  because its compressed corpus is materially smaller.

Arabic may run first, but English cannot be silently dropped based on the Arabic
outcome. A subset qualification requires an explicit `--partial` flag, and its
receipt lists every omitted preregistered language.

## Pinned source identities

- Dataset revision: `5be20db9509754dadad47689368639fcec739c00`
- Corpus revision: `d921ec7e349ce0d28daf30b2da9da5ee698bef0d`

| Language | Role | Dev queries | Judged queries | Corpus shards | Provider-manifest compressed bytes |
|---|---|---:|---:|---:|---:|
| Korean | anchor | 213 | 213 | 3 | 225,970,548 |
| English | transfer | 799 | 799 | 66 | 5,060,264,106 |
| Arabic | transfer | 2,896 | 2,896 | 5 | 319,972,345 |

All six topic/qrels files matched their pinned byte size and SHA-256. Parsed
topic IDs were unique, every judged query ID matched the topic set in both
directions, and all three corpus manifests reproduced their pinned canonical
digest from the Hugging Face API. The English manifest exercised two API pages.

Corpus identities at this stage are provider-tree LFS SHA-256 and size metadata,
not locally downloaded bytes. Every later execution must hash each downloaded
shard before it can claim a run. The source-lock output states this boundary and
contains no retrieval score or quality claim.

## Isolation and anti-selection controls

- Execution namespaces include language, source-lock digest, and embedding-policy
  digest.
- Same-origin pagination, cycle rejection, relative next-link resolution, and a
  60-second request timeout fail closed.
- No-argument qualification means all KO/EN/AR sources.
- Partial qualification is explicit and records omitted languages.
- Duplicate and unsupported language arguments are rejected.

## Verification

- Focused tests: 16/16 passed, including pinned-manifest positive parsing and
  malformed full-size manifest rejection.
- Benchmark TypeScript check: passed.
- Biome on changed files: passed.
- Diff whitespace check: passed.
- Live metadata/source qualification: passed for KO/EN/AR.

Formal `review-pass` preflight remains `NOT_CLEAN` because the pre-existing,
unrelated untracked path `.cache/tools/trec_eval-ba38899/` is inside the
repository. This checkpoint therefore makes no formal CLEAN or release-eligible
claim.

## Next evidence

1. Generalize the KO-only full-corpus runner to consume the frozen language
   contract and enforce the language-specific namespace.
2. Download and hash every Arabic shard, then execute the frozen retrieval
   policy without GPU1.
3. Keep English required regardless of the Arabic result and execute it when
   CPU/storage time permits.
4. Compare transfer deltas against language-matched frozen MIRACL baselines;
   do not pool languages into a single score that can hide a failure.

Public competitive eligibility remains false until transfer retrieval results,
same-input competitor evidence, and the separate powered lifecycle comparison
are complete.
