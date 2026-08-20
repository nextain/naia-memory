# Naia Memory clean v4 multilingual lifecycle evidence

Date: 2026-08-20  
Status: **diagnostic evidence only; not cleared for a public superiority or SOTA claim**

## Outcome

Commit `989b3dc` fixes one real consolidation defect: when a newly extracted
structured fact was already present as a canonical duplicate, consolidation
returned early and could leave an older contradictory peer active. The new
reconciliation pass retires those peers to the canonical successor. A focused
regression test proves this behavior deterministically.

The clean three-engine campaign does not establish a robust aggregate quality
gain. Naia's deletion leakage fell from 1/9 to 0/9 in Korean and from 3/9 to
2/9 in Japanese, while stale exposure fluctuated from 1/9 to 2/9 in English
and from 3/9 to 4/9 in Japanese. With only three unique cases per language and
model-dependent extraction and adjudication, these differences are not a
statistical improvement claim.

## Clean v4 score

Each cell contains three unique lifecycle cases repeated three times. The nine
runs per language measure execution stability, not nine independent cases.

| Engine / language | current@1 | current@5 | stale exposure@5 | deletion leakage@5 |
|---|---:|---:|---:|---:|
| Naia / ko | 6/9 | 6/9 | 0/9 | 0/9 |
| Naia / en | 6/9 | 6/9 | 2/9 | 2/9 |
| Naia / ja | 6/9 | 9/9 | 4/9 | 2/9 |
| Mem0 / ko | 5/9 | 5/9 | 0/9 | 0/9 |
| Mem0 / en | 6/9 | 6/9 | 0/9 | 0/9 |
| Mem0 / ja | 4/9 | 4/9 | 0/9 | 0/9 |
| Hindsight / ko | 7/9 | 9/9 | 6/9 | 0/9 |
| Hindsight / en | 8/9 | 8/9 | 3/9 | 3/9 |
| Hindsight / ja | 6/9 | 9/9 | 6/9 | 0/9 |

This is a trade-off, not a global rank. Mem0 suppresses stale/deleted exposure
best in this set but retrieves fewer current memories. Hindsight retrieves more
current memories but exposes more stale items. Naia lies between those surfaces
and has not yet met its own per-language leakage gate of 5% or less.

## Evidence integrity

- Engines: Naia Memory, Mem0 OSS 2.4.5, Hindsight 0.9.1.
- Matrix: three engines × Korean/English/Japanese × three repetitions, top-k=5.
- Execution order: seeded Latin rotation; every engine occupies each position once.
- Raw receipts: all nine bind to revision
  `989b3dcd732fc5ad52ed795db44acf4fb5e60aab` with `git.dirty=false`.
- Hindsight image:
  `sha256:a0e937366261b8a8f20ebcaf13758c689c381dcbbf01684e4375c2787c8c666d`.
- Blinding: engine identity withheld in the packet and restored only by the seal.
- Adjudicator: Google AI Studio `gemini-2.5-flash-lite`, temperature 0, 81/81 samples.
- GPU1: not used.

Artifact hashes:

- campaign: `61ca0dcdbe6332495f8b0a4ffbaceb99f28c9a7e4574228aaddeaef219ac029e`
- blind packet: `aae1cbe357e4a65cc976f3d4053ce847f53df1650600c862f85db8660b4f0e00`
- model judgments: `9eb1cc5600d7374c8d4bc4819c5f50e918532d4be230b4b0dfa6927063209cb2`
- score: `c2b9196aae72a2b4c2966f732a8aeae314c98bc945783091d664de271aae66b7`

## Adversarial interpretation

The dataset remains close to Naia's target lifecycle ontology and therefore
cannot rule out benchmark overfitting or a goal mismatch with competitors.
Cases were authored by Gemini 2.5 Flash and judged by Gemini 2.5 Flash Lite, so
same-provider family bias remains. The benchmark has no native-speaker human
panel, confidence intervals, latency/cost surface, volume stress test, or a
fourth global engine such as Zep/Graphiti or Letta.

The defensible product value today is narrower: Naia keeps an auditable
append-only history and can reconcile current versus superseded personal facts
across Korean, English, and Japanese under one language-neutral lifecycle
model. This campaign shows the mechanism works, not that Naia is globally best.

## Public-release gates

1. At least 30 independently human-authored held-out cases per language,
   including temporary, historical, quoted, third-party, ambiguous, and
   durable-negative controls.
2. Independent native-speaker adjudication, with inter-rater agreement and a
   judge from a different model/provider used only as secondary analysis.
3. Per-language stale and deletion exposure at or below 5%, while current@5 is
   non-inferior to the strongest comparator.
4. Add at least one of Zep/Graphiti or Letta, disclose native configuration,
   and publish p50/p95 latency, token/API cost, and storage growth.
5. Repeat from a clean release commit with immutable receipts and run an
   external adversarial review before promoting any comparative claim.

