# Structured Supersession Query-Assistance Ablation (2026-08-18)

## Decision

The previous 100% hit@1 result is a mechanism ceiling obtained when the benchmark supplies the correct `(subject, property)` identity at recall. It is not the current end-to-end natural-query score. With the same structured writes but no query identity, Naia scores 64.8% hit@1 (70/108; 95% Wilson CI 55.4–73.2), 83.3% hit@20, and 0% forbidden exposure at top 20.

The defensible value is narrower and still meaningful: explicit structured writes make replacement lifecycle behavior reliable on this generated diagnostic. Lifecycle and transition-lifecycle pass 100%, and stale facts are not exposed, even without query assistance. The remaining bottleneck is query-to-identity resolution and first-rank retrieval, not the storage update transition.

## Same-run ablation

Fixture: 108 generated/template-correlated cases, 36 each in Korean, English, and Japanese. Model: `multilingual-e5-small` q8 on CPU. Search: RRF, top 20. The implementation baseline before this harness-only change was commit `4c3df05`.

| Naia path | hit@1 | hit@20 | MRR | forbidden@1 / @20 | lifecycle | history@20 |
|---|---:|---:|---:|---:|---:|---:|
| No structured writes, natural query | 0.9% | 60.2% | .075 | 0.9% / 51.9% | 33.3% | 20.4% |
| Structured writes, natural query | **64.8%** | 83.3% | .741 | **0% / 0%** | **100%** | 16.7% |
| Structured writes, correct identity supplied | 100% | 100% | 1.000 | 0% / 0% | 100% | 100% |
| Structured writes, wrong identity supplied | 0% | 83.3% | .387 | 0% / 0% | 100% | 16.7% |

Correct query identity adds 35.2 percentage points of hit@1 over natural query. Supplying a wrong identity collapses hit@1 to zero while leaving hit@20 at 83.3%. This proves the identity boost strongly controls ordering; it also shows that the natural-query candidate set usually contains an acceptable fact, so query understanding/ranking is the immediate improvement target.

## Language breakdown

| Language | natural-query hit@1 | hit@20 | MRR | forbidden@20 | lifecycle |
|---|---:|---:|---:|---:|---:|
| Korean | 66.7% (24/36; CI 50.3–79.8) | 83.3% | .750 | 0% | 100% |
| English | 80.6% (29/36; CI 65.0–90.2) | 83.3% | .819 | 0% | 100% |
| Japanese | 47.2% (17/36; CI 32.0–63.0) | 83.3% | .653 | 0% | 100% |

This is not a Korean-only failure. Japanese first-rank retrieval is weakest; lifecycle behavior is identical across the three fixture languages. The mechanism treats extracted identities as opaque labels, so multilingual production quality still depends on upstream extraction and cross-lingual canonicalization.

## Corrected foreign-engine context

The earlier report placed Naia's oracle-assisted 100% beside native Mem0 and Hindsight paths. That table was explicitly asymmetric, but it can still be misread as a leaderboard. The less misleading first-rank context is:

| Path | hit@1 | 95% Wilson CI | Important asymmetry |
|---|---:|---:|---|
| Mem0 OSS 2.4.5 raw control | 69.4% | 60.2–77.3 | natural query; `infer:false`, no lifecycle inference |
| Naia structured-write + natural-query diagnostic | 64.8% | 55.4–73.2 | fixture supplies structured facts at write time |
| Hindsight 0.9.1 normal retain/recall | 62.0% | 52.6–70.6 | LLM-backed native retain; natural recall |

The intervals overlap heavily. This evidence does not establish a global winner. Naia is approximately in the middle on natural-query hit@1 while uniquely showing 0% forbidden@20 and 100% lifecycle under fixture-supplied write structure. A symmetric whole-product comparison requires every engine to ingest the same natural statements, infer its own structures, receive the same natural queries, and use frozen judging and budgets.

## Claim gate and next work

Allowed claim: “On a frozen generated 108-case Korean/English/Japanese diagnostic, Naia's explicit structured-write lifecycle achieved 100% update-transition correctness and 0% stale/foreign exposure at top 20. Natural-query hit@1 was 64.8%; supplying the correct query identity raised the mechanism ceiling to 100%.”

Not allowed: general engine superiority, 100% end-to-end recall, native-language quality, cross-lingual canonicalization, or publication-grade benchmark claims.

The next meaningful gate is a sealed, independently authored/native-reviewed challenge set plus an end-to-end natural utterance path that extracts and canonicalizes query identity without fixture fields. It must include paraphrases, code-switching, entity aliases, negation, ambiguous properties, and deliberately wrong/low-confidence extraction. Report extraction accuracy separately from retrieval and lifecycle so one oracle cannot hide another subsystem's failure.

Receipt: `reports/quality/structured-supersession-contract-v3-multilingual-e5-small-top20.json`.

## Adversarial review status

OpenCode headless returned `CLEAN` after a full evidence-reading pass timed out and a bounded verdict pass rechecked the established metrics, controls, claim scope, and artifact agreement. Claude headless was unavailable because the local CLI was not authenticated. This is one external-review pass, not the two-reviewer/two-clean-round threshold for a globally clean publication claim.
