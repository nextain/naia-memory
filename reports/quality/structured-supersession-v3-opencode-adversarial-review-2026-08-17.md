# Structured Supersession v3 — OpenCode Headless Adversarial Review

Date: 2026-08-17

Runner: local `opencode run --pure`

Model: `opencode/big-pickle`

Mode: read-only post-implementation review

## Verdict

**CLEAN**

## Findings

- Answer leakage: none. Recall identity contains only normalized `subject` and `property`; answer value is not passed or compared.
- Lifecycle/project filtering bypass: none detected. The identity bonus ranks eligible candidates and does not bypass strict project or lifecycle filters.
- Metric consistency: exact. The report values match the parsed Naia and Mem0 JSON artifacts.
- Hindsight control: exact. Its hit/recall/MRR/forbidden metrics match the receipt, and the scorer is equivalent to the Naia summary path.
- Explicit lifecycle: 108/108 cases pass; history coverage is 108/108.
- Mem0 comparison: correctly disclosed as an asymmetric `infer:false` raw retrieval control, not an overall engine ranking.
- Benchmark gaming: none detected. The identity bonus is uniform, the clock is fixed, and no per-case model or threshold is used.
- Regression coverage: no issue detected in the scoped lifecycle candidate-filter tests.
- Public-claim gates: generated/template-correlated/non-native-reviewed data and missing natural-utterance extraction are explicitly disclosed.

## Acceptance coverage

| Criterion | Result |
|---|---|
| Answer leakage | Clean |
| Lifecycle or project-filter bypass | Clean |
| Report/receipt metric consistency | Exact |
| Hindsight scorer and receipt | Clean / exact |
| Comparison fairness disclosure | Adequate |
| Benchmark gaming | None detected |
| Generated-fixture overclaim | Adequately blocked |
| Missing end-to-end extraction | Explicitly disclosed |

## Scope

The review covered the structured query types and call path, local semantic ranking, lifecycle candidate regression test, v3 schema/generator/runners, the foreign-engine report, and all three executed v3 result artifacts (Naia, Mem0, and Hindsight). It is a source-and-artifact review, not an independent benchmark rerun on a separately provisioned machine.
