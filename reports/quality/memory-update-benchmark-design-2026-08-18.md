# Memory update benchmark design audit

## Decision

Do not extend the public static-retrieval dataset and do not report the existing
structured-supersession result as semantic update quality. The next comparison
must publish two separately scored tiers:

1. **Lifecycle conformance** — deterministic add, replace, delete, active-view,
   and history-view operations. This tests storage/update mechanics without an
   LLM and cannot support a language-understanding claim.
2. **Semantic update interpretation** — natural-language turns only, with no
   fixture-supplied subject/property identity. This tests whether each product's
   production update pipeline preserves the current fact and suppresses stale
   facts.

Scores from the two tiers must never be aggregated.

## Evidence audit

The existing `structured-supersession-contract-v3` is a generated diagnostic
with Korean, English, and Japanese cases. Its Naia runner maps every statement
to fixture-owned `StructuredFact` data through an oracle `FactExtractor`. It
therefore demonstrates the value and failure modes of structured lifecycle
machinery, not extraction from language.

The existing Mem0 control uses `infer:false`. It is a valid same-embedding raw
retrieval control, but it disables Mem0's extraction and update logic. Comparing
its stale retrieval against Naia lifecycle state would answer different product
questions and cannot establish general superiority.

The new public-engine bridges make same-corpus static retrieval executable and
preserve frozen dataset IDs. They do not add update operations and do not change
any measured quality score.

The lifecycle tier now has executable Naia and Mem0 OSS bridges. A real
`LocalAdapter` integration test exposed an important boundary: raw Naia
`semantic.upsert` updates only the same native ID and does not automatically
supersede another fact that shares a structured property. The Naia lifecycle
bridge therefore writes the predecessor's native `superseded`, `validTo`, and
`successorId` fields and the successor's `supersedes` field explicitly. Mem0's
bridge maps replace to its native `update(memoryId, content)` operation. These
are disclosed operation mappings for CRUD conformance, not evidence that either
engine inferred an update from conversation text.

The implementation checkpoint passes 528 tests across 43 files plus both
TypeScript configurations. An adversarial self-review found and fixed a Mem0
adapter ordering defect: duplicate logical IDs are now rejected before a native
write or update can occur. Independent reviewer execution remains **NOT_RUN**:
both the headless OpenCode path and the governed sub-agent path were rejected by
the workspace's nested-runtime guard. This is a tooling limitation, not a review
pass, and the publication gate remains closed.

## Frozen anti-overfit requirements

- Use independently authored, native-reviewed Korean, English, and Japanese
  test cases; generated cases remain diagnostic only.
- Freeze train/development/test family IDs before engine execution. Related
  entities and paraphrases stay in one family to prevent leakage.
- Include corrections, reversals, temporary states, negation, repeated values,
  and unrelated distractors in every language.
- Run each case in fresh engine state and randomize engine/case execution order.
- Give semantic-tier engines the same turn text, chronology, query, provider
  budget, and top-k. Product-native prompts and update logic remain enabled and
  are disclosed rather than normalized away.
- Preserve native memory IDs plus benchmark logical IDs in signed raw receipts.
- Primary semantic metrics: current-fact hit@1, stale-fact exposure@k,
  deletion leakage@k, update decision accuracy, and no-update preservation.
- Report per-language confidence intervals and paired case-level deltas. No
  global claim is allowed from aggregate-only or self-authored diagnostic data.

## Adversarial failure hypotheses

1. Naia may appear better only because fixture-owned structured identity is
   injected. The semantic tier forbids this input.
2. Mem0 may appear worse only because `infer:false` disables its core update
   feature. The semantic tier requires its production inference path.
3. A CRUD adapter may look like intelligent update behavior. Tier separation
   prevents that claim substitution.
4. Korean gains may come from templates or tokenizer overlap. Independent
   native authorship, family splits, and per-language reporting are mandatory.
5. Cleanup or namespace reuse may leak earlier cases. Fresh state and narrow,
   receipt-recorded cleanup are mandatory.

## Publication gate

Current status is **not public-ready**. Publication requires independently
owned multilingual semantic cases, real Naia and at least two external-engine
raw receipts, successful replay under the frozen scorer, and an independent
adversarial review. Passing implementation tests prove harness integrity only;
they do not satisfy those evidence requirements.
