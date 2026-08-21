# Four-engine multilingual memory-update diagnostic — 2026-08-21

## Decision

This run is commit-worthy mechanistic evidence, but it is not yet public
competitiveness evidence. Naia reduced deletion leakage from 6/36 samples in
the immediately preceding campaign to 1/36 while preserving current-memory
retrieval at 24/36. The remaining Korean deletion miss and the generated,
small case set keep a global-superiority claim at **NO-GO**.

## What changed

- Delete authorization can ask the verifier to resolve extractor surface-form
  drift when an identity has one unambiguous value.
- Equivalent duplicate representations of the verifier-selected value are
  archived together. Distinct values under the same property remain
  fail-closed.
- Durable-cessation extraction guidance is language-independent and its
  examples no longer overlap the benchmark's target attributes.
- The semantic campaign supports a disclosed N-engine matrix and records
  engine-native surface differences.

## Reproducible diagnostic

- Engines: Naia, Mem0 OSS, Hindsight 0.9.1, Letta 0.16.8
- Languages: English, Korean, Japanese
- Cases: 3 generated cases per language
- Repetitions: 4
- Samples: 36 per engine, 144 total
- Ordering: seeded four-engine Latin rotation
- Blind adjudicator: Gemini 2.5 Flash
- Packet SHA-256:
  `ee8f2075c4dd86857b0d491936d86a078b28f3c4facd360e55f1a33d86aa05b7`
- Judgment SHA-256:
  `5dd07d3ac05a28de54397ef8d3694b49a76487ac7d91012bf4de46dc27a60f42`
- Score SHA-256:
  `13fe0a1f294e82b3b05fbafecb1f4615d123a44b7eafb092e6ae41fc9ea67ee7`

| Engine | Current@1 | Current@K | Stale exposure | Deletion leakage |
|---|---:|---:|---:|---:|
| Hindsight | 28/36 | 36/36 | 18/36 | 6/36 |
| Letta | 29/36 | 29/36 | 0/36 | 1/36 |
| Mem0 | 23/36 | 23/36 | 0/36 | 0/36 |
| Naia | 24/36 | 24/36 | 3/36 | 1/36 |

Letta exposes full non-persona core state rather than query-ranked retrieval,
so its row is diagnostic and must not be presented in one retrieval
leaderboard with the other engines.

Naia deletion leakage by language was EN 0/12, KO 1/12, JA 0/12. An isolated
pre-campaign check reached 12/12, but the complete campaign is the canonical
result because it exposed the remaining stochastic Korean miss.

## Comparison with the preceding campaign

The preceding run used the same 4-engine × 4-repetition shape. Naia changed
from current@1 24/36, stale exposure 5/36, deletion leakage 6/36 to 24/36,
3/36, and 1/36 respectively. This supports the narrow causal statement that
the duplicate/surface-drift change improved update cleanup on these cases. It
does not establish out-of-distribution generalization.

## Adversarial assessment

- Multi-value properties remain protected: identity fallback is disabled when
  active candidates contain distinct structured values, and the verifier can
  only select from the bounded candidate set.
- Equivalent duplicate archival is sequential, not transactional. An adapter
  failure can leave a partially archived duplicate group; no atomicity claim
  is made.
- The semantic bridge flattens benchmark turns into the current public ingest
  contract. That can create duplicate facts from assistant confirmations and
  is both a real integration stressor and a comparability limitation.
- The same model family participates in some engine configurations and blind
  adjudication. Model-judge bias has not been ruled out.
- Two fresh Claude headless review attempts timed out without a verdict. They
  are recorded as failed review attempts, not independent approval.

## Verification

- Project tests: 62 files, 662 tests passed
- Typecheck: passed
- Build: passed
- `git diff --check`: passed
- Workspace benchmark-contract suite: passed
- Entrypoint and context-translation suites: passed

## Public-report gate

Before an external competitiveness report can be published, run at least 30
independently authored, frozen held-out cases per language; separate ranked
retrieval from state inspection; use multiple independent native-language
judges with disagreement reporting; add latency and cost; and repeat from a
clean released commit with immutable artifacts. The Korean stochastic miss and
partial-failure behavior should be resolved or explicitly budgeted first.
