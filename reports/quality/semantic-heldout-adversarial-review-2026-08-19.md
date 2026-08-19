# Semantic held-out adversarial review

- Date: 2026-08-19
- Reviewer: Anthropic API, `claude-sonnet-4-6`, headless
- Input: comparative report and model-adjudication score
- Verdict: comparison ranking is not defensible; diagnostic behavior evidence is publishable only with explicit limitations.

## Blocking findings

1. Nine unique cases repeated three times must not be represented as 27 independent generalization samples.
2. Gemini 2.5 Flash authored the cases and Gemini 2.5 Flash Lite judged them, creating unmeasured same-family/provider bias.
3. The update/delete/no-update structure matches Naia's development target and may disadvantage engines with different native goals.
4. Mem0 and Hindsight do not represent the global competitor field; Mem0's exact version must be disclosed.
5. The campaign ran from a dirty worktree, so a clean-commit rerun remains necessary for release-grade reproducibility.

## Applied corrections

- Renamed the result as execution evidence and stated the effective unique case count beside every interpretation.
- Removed retrieval metrics as delete-success indicators and marked them N/A.
- Added Mem0 2.4.5, model-family dependence, Naia-side experimenter involvement, engine-goal mismatch, and dirty-tree limitations.
- Restricted the defensible claim to observed multilingual lifecycle behavior, not comparative rank, SOTA, or statistical superiority.

## Defensible claim after correction

On three model-authored lifecycle cases per language, each repeated three times, Naia executed Korean, English, and Japanese update/delete/no-update flows and consistently placed the new state at Top-1 for update, while stale and deleted-memory suppression remains an unresolved weakness.
