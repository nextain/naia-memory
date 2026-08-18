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

The semantic tier now has a score-free raw execution boundary. An engine bridge
receives only chronological natural-language turns and the query; it never
receives expected IDs, stale labels, deleted labels, or fixture lifecycle
operations. Receipts contain the engine-native active state and top-k retrieval,
with hashes over both input and output. Retrieved native IDs and content must
round-trip exactly to the state captured from the same isolated execution, so an
adapter cannot fabricate benchmark-friendly retrieval identities.

Real semantic bridges now exist for Mem0 OSS and Naia. Mem0 executes native
`add(..., infer:true)` once per turn. Naia executes public `encode()` followed
by `consolidate()` once per turn. Both expose only engine-native semantic
memories for state and retrieval; Naia episodes are deliberately excluded.
This is an apples-to-apples semantic-memory surface, not a claim about either
product's full end-to-end recall experience. Receipts freeze the ingestion and
retrieval-surface policies.

Fixture timestamps are not sent to either engine. The raw receipt therefore
records separate fixture and engine-input hashes: the former preserves the
annotated corpus chronology, while the latter hashes only the language, turn
content, and query actually crossing the engine boundary. Mem0's OSS add interface does
not accept an event timestamp, so passing one only to Naia would create an
oracle-like input advantage. Both engines receive turn order and natural
language only, and use their default ingestion time. Consequently, relative-
time cases are ineligible for this comparison; temporal-memory behavior needs
a separate tier whose competitors all accept equivalent event-time input.

No semantic score is implemented yet. Native engines can rewrite or summarize
memory text, so exact string matching would systematically favor engines whose
output resembles the annotation wording. A public score requires a separately
frozen, engine-blind adjudication artifact (and signed raw decisions) or an
independently labeled accepted-variant set. Until that exists, the raw runner is
execution evidence only.

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

The current implementation checkpoint passes 541 tests across 47 files, both
TypeScript configurations, and the package build. It adds a semantic raw CLI
for Naia and Mem0 that uses the same provider models, top-k, natural-language
turns, query, fresh per-case state, and engine-native inference surface. Naia's
benchmark extractor now fails closed on provider, transport, and parse errors;
the product default remains backward-compatible and skips failed batches. Raw
artifacts refuse overwrite, disclose the provider endpoint and model IDs, and
are explicitly marked unscored.

A headless OpenCode adversarial review found
three material receipt/isolation defects: ambiguous timestamp hashing, stale
Naia facts missing from native-state evidence, and a reusable local store path.
The implementation now separates fixture and engine-input hashes, preserves
project-scoped inactive facts so stale retrieval remains measurable, and owns a
unique removable store file per case. Five lower-value or incorrect findings
were checked against the implementation; for example, chronology is strictly
increasing rather than permitting identical timestamps. Follow-up OpenCode and
Claude runs timed out without a verdict, so this is evidence of independent
defect discovery and remediation, **not** a converged CLEAN review. The
publication gate remains closed. A later OpenCode inspection reached the
relevant runner, bridge, cleanup, and hash paths but exceeded its 180-second
limit before issuing a verdict; two Claude headless attempts likewise produced
no verdict. These attempts are recorded as unavailable, not as passes.

## Frozen anti-overfit requirements

- Use independently authored, native-reviewed Korean, English, and Japanese
  test cases; generated cases remain diagnostic only.
- Freeze train/development/test family IDs before engine execution. Related
  entities and paraphrases stay in one family to prevent leakage.
- For evidence marked `independent-native-reviewed`, require distinct
  pseudonymous author/reviewer IDs, native-language declarations for both,
  review chronology, and a SHA-256 digest over the frozen family-to-split map.
  Self-review, missing provenance, and post-freeze split edits fail validation.
- Include corrections, reversals, temporary states, negation, repeated values,
  and unrelated distractors in every language.
- Run each case in fresh engine state and randomize engine/case execution order.
- Give semantic-tier engines the same turn text, order, query, provider
  budget, and top-k. Product-native prompts and update logic remain enabled and
  are disclosed rather than normalized away.
- Preserve engine-native memory IDs in signed raw receipts. Benchmark logical
  IDs remain outside the engine and raw-output boundary.
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
6. An adapter may emit benchmark logical IDs or fabricate retrieval objects.
   Semantic execution accepts engine-native identity only and verifies every
   retrieved item against the captured native state.
7. An exact-text scorer may reward annotation mimicry rather than correct
   memory. Semantic scoring remains gated on blind adjudication or frozen
   independently reviewed accepted variants.
8. Fixture timestamps may advantage engines that accept event time over engines
   that do not. The shared tier withholds them from all engines and excludes
   relative-time cases; temporal behavior must be benchmarked separately.

## Publication gate

Current status is **not public-ready**. Publication requires independently
owned multilingual semantic cases, real Naia and at least two external-engine
raw receipts, successful replay under the frozen scorer, and an independent
adversarial review. Passing implementation tests prove harness integrity only;
they do not satisfy those evidence requirements.
