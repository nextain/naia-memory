# Structured Supersession v3 Diagnostic — 2026-08-17

## Decision

The 108-case v3 run supports a narrow, reproducible claim: explicit structured lifecycle metadata correctly marks superseded facts inactive and prevents stale facts from appearing in latest-view recall in this generated Korean/English/Japanese stress corpus. Foreign-entity facts remain active by design; their exclusion is a retrieval result, not lifecycle suppression. The run does **not** establish global engine superiority or publication-grade multilingual quality.

The initial strongest CPU configuration was `multilingual-e5-small` q8 with vector-only search: hit@1 82.4%, hit@5 83.3%, MRR 0.829, forbidden@1/5 0.0%/0.0%. A subsequent language-neutral `(subject, property)` recall identity intervention removed the pooled multi-value failure: hit@1, complete acceptable@20, acceptable recall@20, lifecycle, transition lifecycle, and history coverage are now 100.0%, with forbidden@20 0.0%. See `structured-supersession-v3-foreign-engine-comparison-2026-08-17.md` for the post-intervention evidence and Mem0 control.

## Evidence contract

- Fixture: `src/benchmark/quality/structured-supersession-contract-v3.json`
- Size: 108 cases; Korean 36, English 36, Japanese 36.
- Strata: replacement 36, entity confusion 36, multi-value retention 18, project boundary 18.
- Tier: `generated-diagnostic`; native review: `not-reviewed`; split: `diagnostic`.
- Translation families are correlated. The fixture is frozen and hashed in each receipt, but is neither independently authored nor held out from template design.
- Validator gates: at least 100 total cases, at least 30 per language, four categories, unique normalized queries/statements, no query-to-statement copies, complete lifecycle labels, explicit construction provenance, and no structured identity reuse across families.

## Results

| CPU configuration | hit@1 | hit@5 | MRR | forbidden@1 | forbidden@5 | transition lifecycle |
|---|---:|---:|---:|---:|---:|---:|
| MiniLM fp32, RRF | 56.5% | 83.3% | .695 | 0.0% | 0.0% | 100.0% |
| E5-small q8, RRF | 64.8% | 83.3% | .741 | 0.0% | 0.0% | 100.0% |
| E5-small q8, vector-only | **82.4%** | 83.3% | **.829** | 0.0% | 0.0% | 100.0% |

E5-small RRF per-language results were Korean 66.7%/83.3%/.750, English 80.6%/83.3%/.819, and Japanese 47.2%/83.3%/.653 for hit@1/hit@5/MRR. All three languages had forbidden@5 0% and lifecycle 100%. This is evidence that the lifecycle mechanism is not Korean-only; Japanese top-1 ranking remains materially weaker.

The E5-small category split was:

- replacement: hit@1 63.9%, hit@5 100%
- entity confusion: hit@1 83.3%, hit@5 100%
- project boundary: hit@1 94.4%, hit@5 100%
- multi-value retention: hit@1 0%, hit@5 0%

Vector-only improves first-rank placement but does not recover multi-value facts in the pooled corpus. Fresh receipts generated from the current harness show RRF top-20, vector-only top-20, and vector-only top-20 without MMR all at hit@20 **and complete-acceptable@20 83.3%**. This benchmark now records every acceptable rank, mean acceptable-set recall, complete acceptable-set recall, and transition-only lifecycle; retrieving one of two retained values no longer counts as complete retention.

The isolated-family experiment resolves the leading ambiguity. With the unchanged fixture and engine but only the 18 multi-value cases loaded, E5-small vector-only without MMR reaches explicit-structure hit@20 100%, complete-acceptable@20 100%, acceptable-set recall 100%, and history coverage 100%. The same 18 cases retrieve nothing acceptable in the 108-case pooled corpus. Together with both facts remaining active and a representative direct cosine near 0.91, this is strong evidence for correlated-template ranking crowding, not storage/lifecycle loss. An exploratory broad-pool experiment doubled the pre-ranking pool from 60 to at least the complete corpus and changed no explicit metric, rejecting the shortlist truncation hypothesis; the unused option was removed. This remains a diagnostic comparison rather than a production distribution. The next investigation should record candidate scores/ranks and test diversity-aware ranking or a structured identity prefilter against a naturally authored corpus.

Before identity-aware recall, history coverage was only 16.7% at top 20. The post-intervention run reaches 100.0%; this proves the adapter mechanism when the caller supplies identity, while end-to-end natural-language identity extraction remains an open release gate.

## Adversarial findings

An initial generated fixture accidentally reused structured `(project, subject, property)` identities between replacement and entity-confusion families. It produced only 66.7% lifecycle correctness. That run was rejected as benchmark contamination, the generator was fixed, and a validator regression now rejects cross-family identity leakage. The corrected fixture reaches 100% transition lifecycle correctness.

An independent adversarial review found that the original harness treated any acceptable value as full success, that the old top-20 receipts no longer matched the reviewed harness, and that aggregate lifecycle mixed transition and active-only cases. Those findings were accepted and fixed; the top-20 receipts below now bind the current harness, schema, and generator hashes. The validator also rejects acceptable answers marked inactive, false native-review disclosure, query copies, language imbalance, missing generation provenance, and cross-family identity reuse. Focused tests pass 5/5 and typecheck passes. GPU1 was not used.

Two fixture limitations remain. First, the 18 project-boundary cases use strict project filtering and literal project cues, so they are easier than ambiguous cross-project ranking and inflate aggregate retrieval/exclusion metrics. Second, the generated translation families and repeated templates are correlated. v3 remains a diagnostic fixture; these issues require a new fixture version rather than silent edits to the frozen evidence.

## Remaining gate

Before a public multilingual claim, obtain independently authored and native-reviewed cases with a held-out split, replace answer-leaking project-boundary cases, run unchanged adapters for external engines under the same lifecycle labels, and report confidence intervals. Before changing the default search mode, isolate multi-value pooled-corpus crowding, repair history exposure, and rerun the Korean broad retrieval contract plus naia-shell/naia-agent integration gates.

Receipts:

- `reports/quality/structured-supersession-contract-v3.json`
- `reports/quality/structured-supersession-contract-v3-multilingual-e5-small.json`
- `reports/quality/structured-supersession-contract-v3-multilingual-e5-small-vector-only.json`
- `reports/quality/structured-supersession-contract-v3-multilingual-e5-small-top20.json`
- `reports/quality/structured-supersession-contract-v3-multilingual-e5-small-top20-vector-only.json`
- `reports/quality/structured-supersession-contract-v3-multilingual-e5-small-top20-no-mmr-vector-only.json`
- `reports/quality/structured-supersession-contract-v3-multilingual-e5-small-top20-multi-value-retention-only-no-mmr-vector-only.json`
