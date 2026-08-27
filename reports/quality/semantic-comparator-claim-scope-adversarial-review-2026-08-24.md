# Semantic comparator claim-scope adversarial review

Date: 2026-08-24 (Asia/Seoul)

## Decision

The comparator contract is acceptable for continued evidence collection, but it does **not** authorize a global-best or state-of-the-art claim. It authorizes either a direct lifecycle comparison against the explicitly declared runnable engines or a declared multi-class report whose classes remain separate.

## Initial adversarial verdict

OpenCode (`deepseek-v4-pro`) returned `FOUND_ISSUES`.

Confirmed issues were:

1. the runtime shape guard accepted arbitrary comparator labels;
2. the sample-size CLI used that weaker guard and could therefore accept a malformed plan;
3. `global-memory-engine-competitive-report-v1` overstated a hard-coded roster;
4. campaign disclosure did not bind the analysis claim scope or lane assignment;
5. validated gate output did not retain the machine-readable claim ceiling.

## Remediation

- The v5 runtime guard now permits only the declared engine identifiers in each lane.
- The sample-size CLI inherits the strict guard and rejects malformed lane values before simulation.
- The multi-class scope is named `declared-multi-class-competitive-report-v1`, not `global`.
- Campaign disclosure must exactly match `claimScope`, `comparisonLanes`, and `crossLaneAggregation` from the signed analysis plan.
- Validation output retains those three fields for downstream report enforcement.
- Direct inferential comparisons remain limited to Hindsight and Mem0. Graphiti historical behavior and Letta agent-managed behavior are characterization lanes and cannot be pooled with direct lifecycle inference. Projected Graphiti remains an optional product-integration diagnostic.

## Verification

- Focused semantic tests: 35 passed.
- TypeScript `tsc --noEmit`: passed.
- Biome check/format on changed semantic files: passed.
- `git diff --check`: passed.
- Focused post-fix OpenCode adversarial review: `CLEAN`.

The broader test suite was not used as a clean claim for this stage: an active Arabic full-corpus run intentionally pins source hashes, and unrelated user-owned HNSW evidence files are concurrently modified. Neither is part of this commit.

## Remaining claim ceiling

This change prevents comparator-category laundering; it does not produce competitive results. Public competitive claims still require completed same-input executions, independent repeated statistics, multiplicity correction, language-by-language sensitivity agreement, released-commit binding, and explicit disclosure of omitted engines and non-equivalent interfaces.
