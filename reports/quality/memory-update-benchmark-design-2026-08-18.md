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

The raw semantic runner now implements the case-order half of the ordering
requirement. It derives a deterministic shuffled schedule from an execution
seed, records that seed in the artifact disclosure, and records every case's
actual execution position. Omitting `--seed` generates a per-run UUID; a frozen
comparison can pass the same precommitted seed to every engine. The lower-level
runner requires an explicit seed so programmatic callers cannot silently fall
back to a reusable default schedule.

The multi-engine semantic campaign runner now closes the engine-order half of
this harness requirement for Naia and Mem0. It requires an explicit campaign
seed and an even repetition count, alternates the seed-selected first engine,
and records a manifest proving that each engine occupied each execution
position equally often. Within a repetition, both engines receive the same
derived case-order seed; different repetitions receive different derived case
seeds. The completed manifest binds every raw artifact by SHA-256 so later file
replacement is detectable. This removes a known execution-order confound but
does not turn generated diagnostics or unscored native output into comparative
quality evidence.

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

## 2026-08-19 compatibility and receipt checkpoint

A same-provider Korean smoke run invalidated the earlier interpretation that an
empty Mem0 state demonstrated a Korean update failure. With
`gemini-2.5-flash-lite`, Mem0's inference path returned no native operations;
with `gemini-2.5-flash` and the same `gemini-embedding-001` embedding model,
Mem0 emitted one native operation for each of the two turns, retained only the
new Busan residence, and retrieved it. Naia also retrieved only the new Busan
residence, while its captured native state still contained both the inactive
Seoul predecessor and active Busan successor. This single generated smoke case
is a provider-compatibility diagnostic, not comparative quality evidence.

The raw artifact schema is now v2. Every turn records an ingestion receipt.
Mem0 receipts expose the count in its native `add(..., infer:true)` response and
fail closed when that response lacks a results array. Naia records the receipt
as opaque because its public `encode`/`consolidate` boundary does not expose a
comparable native-operation count. This asymmetry is intentional disclosure;
the counts must not be compared as a quality metric. A zero Mem0 operation
count remains ambiguous between a legitimate no-update decision and an
extraction/model failure, so promotion still requires case labels and blind
adjudication.

The provider configuration can now freeze an OpenAI-compatible endpoint,
model/revision IDs, embedding dimensions, and authentication mode without
placing credentials in artifacts. The default Gemini semantic diagnostic uses
`gemini-2.5-flash`; the fact extractor output budget was raised because Gemini
2.5 reasoning can consume a 2K budget before emitting the short JSON result.
This is a compatibility fix, not evidence of better memory quality.

Deterministic verification on this checkpoint: 47 test files / 543 tests
passed, both TypeScript configurations passed, and `git diff --check` passed.
The requested nested OpenCode process was blocked by the workspace runtime
policy before launch, so no independent-review verdict is claimed. A manual
adversarial pass found no basis for a superiority claim and retained the closed
publication gate. The next meaningful experiment is a frozen Korean, English,
and Japanese semantic update/delete/no-update corpus, followed by blinded
scoring and at least two external engines under identical provider and budget
conditions.

## 2026-08-19 multilingual mutation diagnostic

A generated diagnostic corpus now covers the full Korean/English/Japanese ×
update/delete/no-update matrix (nine cases). Contract validation fails unless
all nine cells are present. The corpus is labelled `generated-diagnostic`; it
is not independent, native-reviewed, blind, or a publication test set.

The Naia bridge now injects the exact frozen provider/model into both fact
extraction and contradiction filtering. This fixed a real benchmark defect:
the contradiction filter had read ambient credentials, failed with HTTP 400,
and silently used a heuristic fallback while extraction continued through the
configured provider. With the pinned path, one run retrieved only the latest
residence in all three languages. The earlier update failure was therefore
partly configuration drift, not an engine ceiling.

The product now represents an explicit extractor mutation as `operation:
delete`. Consolidation honors it only when a complete structured target exactly
matches an active fact, then archives that fact and closes its validity range.
Unstructured, negated, identity-only, and mismatched requests fail closed. This
adds preservation-first natural-language deletion without a broad regex or
destructive fuzzy match. Extraction temperature is zero because this is
contract parsing rather than creative generation.

Here, `delete` means retrieval suppression, not physical erasure: the matched
fact remains in storage with `archived` status for lineage and auditability.
It therefore must not be presented as GDPR-style right-to-erasure or secure
deletion. The existing explicit store deletion API remains the physical-delete
surface; deciding whether natural-language "forget" should invoke it requires
a separate product and privacy contract.

Two post-change Naia executions produced these qualitative retrieval
observations. They are not scored passes: no frozen accepted-variant set or
blind judge exists yet.

| Cell | Naia run 1 | Naia run 2 | Mem0 baseline |
|---|---|---|---|
| ko update | latest only | latest only | latest only |
| ko delete | no deleted fact retrieved | no deleted fact retrieved | deleted fact leaked |
| ko no-update | duplicate variants | duplicate variants | one fact |
| en update | latest + stale | latest + stale | latest only |
| en delete | deleted fact leaked | deleted fact leaked | no deleted fact retrieved |
| en no-update | duplicate variants | duplicate variants | one fact |
| ja update | latest only | latest only | latest only |
| ja delete | no deleted fact retrieved | no deleted fact retrieved | no deleted fact retrieved |
| ja no-update | duplicate variants | one fact | one fact |

## 2026-08-19 language-neutral identity and idempotency checkpoint

The extractor now emits a closed, language-neutral identity pair for explicit
user profile and preference facts. Both `subjectId` and `propertyId` must be
present and belong to the allowlist; partial, unknown, and invented identifiers
are discarded as a pair. Labels and values remain in the episode language.
This lets Korean, English, and Japanese labels converge on the same mutation
identity without translating stored content.

Two model-output drifts were observed rather than assumed. First, the
Korean-only prompt examples biased an English allergy fact into Korean. The
prompt now gives symmetric Korean, English, and Japanese language-preservation
rules. Second, an English delete emitted `peanuts` for a stored `peanut` value.
Deletion remains fail-closed, but a multi-valued, one-token ASCII value now
accepts only the narrow terminal-`s` variant. Single-valued facts, phrases, and
non-ASCII values do not receive this morphology rule.

Repeated no-update turns exposed structure-presence and punctuation drift.
Consolidation now treats active facts with identical NFC-normalized content as
idempotent even when extractor structure differs, ignoring only whitespace,
case, and terminal sentence punctuation. It does not fuzzy-merge different
content. A regression test covers Japanese terminal punctuation plus structured
metadata drift.

The final post-fix Gemini 2.5 Flash diagnostic execution produced the expected
qualitative behavior in all nine generated cells:

| Language | update | delete | no-update |
|---|---|---|---|
| Korean | latest only | retrieval empty | one active fact |
| English | latest only | retrieval empty | one active fact |
| Japanese | latest only | retrieval empty | one active fact |

This is a meaningful implementation result, not publication evidence. Earlier
intermediate repeats exposed English and Japanese no-update instability, and
the nine cases directly informed these changes. They are therefore a
development set susceptible to overfitting. The closed ontology covers only a
small profile/preference vocabulary, the morphology exception is deliberately
English-specific, all live runs used one Gemini model/provider, and no native
speaker blind review or external-engine rerun was performed at this checkpoint.
No global superiority claim follows. The next evidence gate remains a frozen
held-out corpus with unseen property families, native independent authorship,
repeated seeds/models, and Mem0 plus another production engine under the same
provider and budget contract.

Deterministic verification: 47 test files / 550 tests passed, both TypeScript
configurations passed, the package build passed, and `git diff --check` passed.

This is meaningful diagnostic progress, not evidence that Naia is globally
better. It isolates the next ceiling: extractor-generated subject/property
identity drifts across paraphrases (for example `lives in` versus `residence`),
and equivalent statements can be emitted with different keys. Korean and
Japanese deletion succeeded twice while English deletion failed twice, so the
new mechanism is real but not language-robust. Mem0 remains better on this
small diagnostic for English deletion and no-update deduplication; Naia is
better only on the generated Korean deletion cell.

The next experiment should separate language realization from
language-independent identity: a frozen ontology/ID resolver must normalize
subject and property after extraction, with unknown concepts failing closed.
It must be evaluated on held-out families rather than aliases added from these
nine cases. Publication still requires repeated runs, confidence intervals,
independent native review, blind scoring, and a second external engine such as
Hindsight. Formal multi-agent adversarial review was not run because nested
OpenCode/Claude execution remains prohibited by the workspace runtime; this
section records a manual adversarial review only.

Deterministic verification after this change: 47 test files / 547 tests
passed, both TypeScript configurations passed, the package build passed, and
`git diff --check` passed.

## 2026-08-19 blind adjudication packet checkpoint

The semantic campaign can now be converted into a reviewer-facing blind packet
and a separate confidential seal. The generator first reconstructs the exact
seeded campaign schedule, verifies every raw artifact SHA-256, and reuses the
raw-artifact validator. It then deterministically shuffles samples under a
private blinding seed, replaces native memory IDs with packet-local opaque IDs,
and withholds engine, repetition, engine position, artifact filename, native
ID, and blinding seed from the adjudicator. The seal binds those mappings to a
SHA-256 of the public packet content. Output is written into a private staging
directory and atomically published; an existing output directory is never
overwritten.

Run it only after a completed semantic campaign:

```sh
pnpm benchmark:semantic-blind-packet \
  --contract=<frozen-contract.json> \
  --campaign=<campaign.json> \
  --output-dir=<new-private-output-directory> \
  --seed=<private-precommitted-blinding-seed>
```

Only `adjudication-packet.json` may be sent to adjudicators.
`adjudication-seal.json` must remain confidential until judgments are frozen.
The packet schema name contains the Naia Memory protocol brand, but no compared
engine identity; the test explicitly separates that protocol identifier before
checking the entire remaining public envelope for engine/run/native-identity
leakage. Contract construction provenance is intentionally disclosed so a
reviewer can distinguish generated diagnostics from independently reviewed
evidence.

This mechanism removes explicit metadata leakage; it cannot prevent an engine's
wording or characteristic output style from statistically revealing its
identity. It also does not supply independent adjudicators, frozen labels,
independently authored held-out cases, or a third engine. It therefore closes a
harness-integrity gap but does not open the publication gate or establish a
quality advantage.

An OpenCode headless adversarial review read the new generator and tests plus
the campaign, raw runner, and contract boundaries. It reported a CLEAN verdict
and identified dead code, an unnecessarily complex filename expression, and an
under-scoped identity-leakage assertion. All three were corrected; provenance
disclosure and two-engine extensibility remain explicit design limitations.
This is an independent implementation review, not a completed multi-adjudicator
quality judgment and not a claim of full governed Review Pass convergence.

Deterministic verification at this checkpoint: 49 test files / 562 tests
passed, both TypeScript configurations passed, the package build passed,
Biome passed for the changed source and test, and `git diff --check` passed.
