# Naia Memory semantic update benchmark evidence — 2026-08-19

## Executive result

Naia Memory, Mem0, and Hindsight were executed against the same nine natural-language memory-update diagnostic cases in Korean, English, and Japanese. Three repetitions used a seeded three-engine Latin rotation, producing 9 engine runs and 81 engine-case receipts. Every retrieved native ID was present in the same case's native state and all runs respected `topK=5`.

This campaign is meaningful as execution and lifecycle-behavior evidence, but it is not yet defensible evidence that Naia is globally higher quality. The cases are generated diagnostics, repeat the same nine scenarios, and the sealed packet has not been scored by independent native-language adjudicators. Public quality ranking remains blocked until the already-enforced independent/native-reviewed held-out contract and adjudication gates are satisfied.

## Product value under test

The differentiated value is not generic vector recall. It is memory lifecycle correctness:

- replace an outdated fact without returning the stale value;
- honor a natural-language deletion request;
- preserve a current fact when a later utterance should not update it;
- behave consistently across Korean, English, and Japanese.

Naia's current implementation shows a distinct lifecycle signature in the raw receipts: all nine delete cases returned no memory, every no-update case returned one memory, and every update case returned one memory while retaining two native records for audit/state history. This is consistent across all three languages and all three repetitions. It is not a semantic correctness score; independent judges must still determine whether each returned memory is current, stale, deleted, irrelevant, or uncertain.

## Campaign and reproducibility

- Contract: `memory-update-semantic-diagnostic-v1.json`, SHA-256 `48e46e10fe736415a209d33af8f19468f5f3ff47821e7de6d1ab549839148a90`.
- Campaign: `semantic-campaign-2026-08-19-v2/campaign.json`.
- Engines: Naia Memory, Mem0, Hindsight 0.9.1.
- Hindsight image: `ghcr.io/vectorize-io/hindsight@sha256:a0e937366261b8a8f20ebcaf13758c689c381dcbbf01684e4375c2787c8c666d`; revision label `e5b49eb6729512bd9b103058daa93f701da25644`.
- Hindsight LLM: Gemini / `gemini-2.5-flash`; server-native embedding and reranking configuration pinned by the image digest.
- Naia and Mem0: the same disclosed Gemini embedding endpoint/model/revision/dimensions and Gemini 2.5 Flash LLM configuration within each paired repetition.
- Execution: 3 repetitions, 3 engines, 9 cases, `topK=5`; every engine ran once in each first/second/third position.
- Language balance: 3 contract cases each for Korean, English, and Japanese.
- Hardware: CPU execution and external model APIs only; GPU1 was not used.

## Objective raw observations

| Engine | Engine-cases | Native memories | Retrieved | Empty retrievals | Ghost IDs |
| --- | ---: | ---: | ---: | ---: | ---: |
| Naia | 27 | 36 | 18 | 9 | 0 |
| Mem0 | 27 | 25 | 25 | 7 | 0 |
| Hindsight | 27 | 81 | 60 | 0 | 0 |

These counts demonstrate materially different engine behavior, not which behavior is correct. In particular, Hindsight's observation/world/experience recall surface emits more memories; Naia's mutation-aware retrieval is selective; and Mem0 is between them. Comparing raw recall volume as quality would reward verbosity and is therefore invalid.

## Adversarial review

An OpenCode headless review found no blocker and confirmed the seeded Latin rotation is balanced. Its actionable findings were addressed as follows:

- High: campaign validation previously allowed retrieved IDs absent from native state and did not enforce the top-k cap. Both now fail closed and have regression coverage.
- High: recurring conversations can be paired by an adjudicator even when engine identity is withheld. The packet now explicitly discloses recurrence and requires independent per-sample judgment; the report does not claim perfect sample unlinkability.
- Medium: Hindsight runtime identity and Naia/Mem0 provider details were incomplete. Raw receipts now include immutable Hindsight image/version/model data and embedding revision/dimensions/auth details.
- Medium: engine-native tuning surfaces are asymmetric and the fixed diagnostic does not show generalization. Both limitations are machine-readable in campaign disclosure.
- Medium: language balance was implicit. The campaign now records per-language case counts.
- Low: standalone raw execution did not validate the input contract. It now does.

## What is and is not proven

Proven by committed receipts:

- three real engine paths accept equivalent raw natural-language turns and queries;
- execution order is position-balanced and input/case/output artifacts are hash-bound;
- native state, retrieval identity, top-k, and engine cleanup are validated;
- Naia exhibits deterministic selective lifecycle behavior on the nine multilingual diagnostics;
- a sealed, engine-blinded adjudication packet can be generated reproducibly.

Not proven:

- global SOTA or superiority over Mem0/Hindsight;
- generalization beyond the nine generated diagnostic scenarios;
- broad multilingual support beyond Korean, English, and Japanese;
- semantic quality until independent native-language adjudication is frozen and unsealed.

## Required next evidence

1. Independently author and native-review development/test families for Korean, English, and Japanese; author and reviewer identities must differ.
2. Freeze family-level splits before tuning and keep the test split inaccessible during development.
3. Run the same three-engine campaign once on the frozen test split.
4. Have independent native-language adjudicators score the blind packet, then unseal and report confidence intervals and per-language/per-decision cells.
5. Add a fourth engine only after its native input, identity, cleanup, and reproducibility contract can pass the same gates.

Until those steps are complete, the defensible public statement is: **Naia Memory has a reproducible three-engine multilingual lifecycle benchmark and shows stable mutation-aware behavior on its diagnostic set; comparative quality leadership is not yet established.**
