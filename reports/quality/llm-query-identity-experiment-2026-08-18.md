# LLM query identity experiment — 2026-08-18

## Decision

Do not enable free-form LLM query structuring in `naia-agent` or `naia-shell` yet. Keep it as an experimental API and benchmark path.

## Evidence

Fixed generated diagnostic: 108 correlated cases, 36 each in Korean, English, and Japanese; `multilingual-e5-small`, top 20, CPU.

| Variant | Hit@1 | MRR | Forbidden@20 | Lifecycle |
|---|---:|---:|---:|---:|
| Structured writes, natural query | 64.8% | 0.741 | 0.0% | 100.0% |
| Extracted identity, exploratory run (prediction artifact overwritten) | 67.6% | 0.755 | 0.0% | 100.0% |
| Extracted identity, repeat | 65.7% | 0.745 | 0.0% | 100.0% |
| Fixture oracle identity | 100.0% | 1.000 | 0.0% | 100.0% |

The persisted repeated extraction had 4/108 exact subject+property matches (3.7%) and 3 API/format failures. The earlier exploratory run also observed 4 exact matches and no failures, but its prediction artifact was overwritten and is not independently auditable. Different exact matches changed the observed end-to-end gain from +2.8 percentage points to +0.9 points.

## Interpretation

- The mechanism ceiling remains real: a correct stable identity reaches 100% on this diagnostic.
- Free-form multilingual labels are not a stable way to reach that ceiling. Semantically similar labels such as `user` / `the user` do not share an exact structured key.
- The observed gain is too small, correlated, model-coupled, and repeat-unstable to claim statistical or product significance.
- This fixture is generated and not native-reviewed. It cannot establish global superiority or general multilingual quality.

## Next experiment

Use language-neutral identity IDs owned by the memory schema, with deterministic aliases learned at write time and resolved at query time. Evaluate on independently authored, native-reviewed paraphrases with repeated same-identity queries, unseen aliases, multiple models, latency/cost, and confidence intervals. Only then consider agent/shell integration.

## Adversarial review

OpenCode challenged model coupling, exact-key semantics, metric disclosure, prompt boundaries, artifact loading, and fixture generalization. The implementation now separates query data, bounds output, records subject/property/exact rates, discloses exact matching, and caches prediction artifacts. Oracle-based normalization was rejected because it would leak benchmark answers.
