# #39 adversarial implementation review — 2026-08-14

## Scope and evidence

- Issue: <https://github.com/nextain/naia-memory/issues/39>
- Complexity baseline: `db5378f2c719dc1df3d12edfd7c9ca10b5463d0e`
- Review target: structured write-time supersession, Local/SQLite persistence,
  Korean-first and multilingual regression coverage.
- Deliberately excluded: GPU execution, language detection/translation, natural
  language intent parsing, response or abstention policy, ranking thresholds.

## Adversarial questions and observed controls

| Failure mode | Control | Evidence |
| --- | --- | --- |
| A Korean value change is missed because lexical retrieval cannot find the old value. | Structured candidates compare against all facts in the same project, not only top-K search hits. | `memory-system.test.ts`: Korean replacement case |
| A loose text/LLM classifier replaces an unrelated fact after structure is supplied. | Structured input has no text/LLM contradiction fallback. Same subject/property and `single` cardinality are required. | `structured-facts.ts`; different-property regression |
| A raw negated episode bypasses the structured policy before extraction. | `encode` stores the episode only; semantic replacement is deferred to consolidation, where negated facts are append-only. | negated Korean regression |
| A list or coexistable preference loses a value. | `multi` facts are append-only. | `memory-system.test.ts`: multi-value regression |
| A predecessor disappears or cannot be traversed. | Supersession writes predecessor status/validity/successor and a new active fact. Local adapter preserves those lifecycle fields. | Korean chain regression |
| An unscoped update mutates a fact belonging to another project. | Write-time supersession requires an exact project match; unscoped candidates can only supersede unscoped predecessors. | `structured-facts.test.ts`: cross-project isolation regression |
| Structured metadata silently disappears in an alternate local storage path. | SQLite stores `structured_fact` with an additive column migration and round-trip test. | `sqlite.ts`; SQLite smoke regression |
| Non-Korean behavior relies on Korean parsing rules. | NFC/whitespace/case comparison is generic; values remain opaque strings. | English/Japanese regression |
| Search extraction reads stale state after a backup import replaces the JSON store or knowledge graph. | The search host exposes live getters for store-backed facts, embeddings, graph and configuration rather than capturing a snapshot. | `LocalAdapter.semanticSearchHost()`; `local-semantic-search.ts` |
| Search behavior changes while reducing adapter complexity. | The moved pipeline preserves the original vector/BM25/KG/RRF/MMR stages and receives only retrieval capabilities through an explicit host contract. | Local-adapter regression suite; typecheck |
| SQLite latest recall returns stale facts or lets them exhaust the candidate window. | Candidate SQL and final materialization now require `status = 'active'` unless history/deep/bi-temporal recall was explicitly requested. | `sqlite-smoke.test.ts`: 60 superseded rows cannot starve the active row; empty latest query returns active rows only |
| SQLite history recall silently loses cold historical facts. | Explicit history mode selects the full FTS/vector indexes instead of the strength-gated hot indexes. | `sqlite-smoke.test.ts`: a strength-0.5 superseded fact remains retrievable in history mode |
| SQLite vector recall lets inactive rows occupy the latest-view ANN window. | Only active, strength-qualified facts enter the hot FTS/vector indexes; demotion or lifecycle replacement removes stale hot entries atomically. | `sqlite-smoke.test.ts`: 60 superseded vectors cannot displace 60 requested active vectors |
| SQLite silently returns fewer than requested when `topK` exceeds 50. | The final RRF materialization gate now retains at least `topK` fused IDs instead of a fixed 50. | `sqlite-smoke.test.ts`: `topK=60` returns 60 active rows |
| Strict-project vector recall cannot reach an older match beyond 1,000 scoped rows. | Strict scope performs exact distance search over the complete project/lifecycle-filtered partition; it does not use a global or recency-truncated ANN window. | `sqlite-smoke.test.ts`: oldest target remains top-1 among 1,002 same-project vectors |
| An embedding write that began before `reset` contaminates the replacement store after its await resumes. | Local semantic and episode writes retain the starting store identity and abort if import/reset replaced it while embedding was in flight. Reset also rebinds the knowledge graph to the new store. | `embedding-space-migration.test.ts`: semantic and episode reset-race regressions |
| A transient embedding failure permanently leaves an unchanged fact without a vector. | Semantic upsert retries whenever the current fact has no persisted vector, even when its content is unchanged. | `local-write-consistency.test.ts`: identical-content retry regression |
| A caller mutates an input object while embedding is in flight, pairing new content with the old content's vector. | Semantic and episode writes take a structured snapshot before the first await and persist only that snapshot. | `local-write-consistency.test.ts`: caller-owned input mutation regressions |
| Concurrent same-ID writes commit in embedding completion order instead of invocation order. | Semantic and episode writes use an ID-scoped promise queue; later calls cannot overtake earlier calls, while different IDs remain independent. | `local-write-consistency.test.ts`: same-ID serialization regression |
| A failed concurrent retry deletes a valid vector written by another retry. | ID-scoped serialization reevaluates vector presence after the prior write completes, so an unchanged later retry does not embed or delete a valid vector. | `local-write-consistency.test.ts`: missing-vector retry and serialization regressions |
| A provider returns a wrong-length, non-finite, or sparse vector that is silently persisted. | Query, document, and reindex boundaries validate declared dimensionality, dense ownership of every index, and finite components before caching or persistence. | `local-write-consistency.test.ts`: oversized and sparse semantic/episode vector regressions |
| A second adapter reopens stale data immediately after `reset` and can resurrect it. | Reset atomically flushes the replacement store before returning. | `local-write-consistency.test.ts`: immediate reopen regression |

## Deterministic checks

- `pnpm typecheck`: passed.
- `pnpm test`: passed, 29 files / 428 tests.
- `SQLITE_WIP=1 pnpm exec vitest run src/memory/__tests__/sqlite-smoke.test.ts src/memory/__tests__/lifecycle-candidate-filter.test.ts`:
  passed, SQLite smoke suite 17 tests (the lifecycle file is covered by the
  default suite and its SQLite-specific peer is exercised here).
- `git diff --check`: passed.
- 2026-08-14 deterministic complexity preflight, using an isolated temporary
  index so the real staged charter file remained untouched: `PREFLIGHT_CLEAN`.
  Episode, semantic, procedural, and epoch responsibilities now live in
  dedicated modules; `LocalAdapter` is 498 lines and every changed source file
  is below the warning threshold. The current complexity digest is bound in
  the independent review transcript rather than duplicated in this mutable
  report.

## Independent reviewer result and disposition

A read-only Codex reviewer completed a named adversarial pass against the prior
digest. Three findings were accepted: inactive SQLite vectors could enter the
latest candidate window, the final fusion gate was fixed at 50 IDs, and strict
project vector recall had a bounded 1,000-row exact-search ceiling. All three
are fixed. One regression requests 60 active results in the presence of 60
superseded vectors; another proves that the oldest target remains reachable
among 1,002 vectors in one strict project. This deliberately makes strict mode
an exact, partition-scoped path; its linear cost must be tracked separately
from the approximate unscoped path.

Two LocalAdapter findings were rejected with existing experimental evidence.
History links intentionally consume spare capacity only, because promoting
unranked links can evict independently relevant anchors and fabricate relevance
for linked rows. Removing zero-score BM25 rows from RRF was already reproduced:
it improved hit/MRR but worsened forbidden exposure, so it remains rejected as
the default. The reviewer also confirmed that the 799-line LocalAdapter merits
named structural review; it is below the mandatory 800-line refactor threshold
but still triggers the 500-line warning.

The structural pass also exposed a previously untested asynchronous boundary:
semantic/episode embedding could resume after `reset` and write into a replaced
store. The accepted fix makes that operation fail closed, adds two deterministic
race regressions, and rebinds reset's knowledge graph. The accepted source fixes
changed the digest, so review convergence is reset on the current digest.
The following review then reproduced four additional failures: identical-content
retry did not repair a missing semantic vector, reset returned before its durable
write, malformed provider vectors were accepted, and caller mutation during an
embedding await could mismatch content and vector. All four findings were
accepted, fixed, and locked down with deterministic regressions. Because those
source fixes changed the digest again, the earlier review verdict is evidence of
defect discovery rather than convergence on the current tree.

The next read-only Codex pass reproduced three more deterministic failures:
same-ID calls could be committed in embedding completion order, a failed
unchanged-content retry could delete another retry's successful vector, and a
sparse JavaScript array bypassed finite-component validation. All three were
accepted. Same-ID semantic and episode writes are now invocation-ordered with
ID-scoped queues, and dense-vector validation is shared by ordinary embedding
and reindex paths. The focused suite now covers both oversized and sparse
vectors. These source changes again reset convergence; a fresh digest-bound
review is required below.

An independent OpenRouter pass used
`nvidia/nemotron-3-ultra-550b-a55b:free` on 2026-08-17 after a successful
availability probe. It raised five concurrency/rollback concerns. Source-level
validation rejected them: JavaScript executes each post-`await` continuation
through content and vector mutation without another yield, an unchanged-content
upsert has no yield at all, `reindexEmbeddings()` snapshots the current (not
zero) generation, episode replacement and its vector write are likewise one
turn, and clearing an embedding cache after failed import is a safe performance
trade rather than state corruption. The review was useful as an adversarial
schedule audit, but its `FOUND_ISSUES` verdict is not accepted as product
evidence without a reproducible interleaving.

## Formal review-gate result

`SCOPED_REVIEW_CLEAN` / `REVIEW_ONLY` — no release or push authorization yet.

The real index still contains a different staged copy of
`.agents/context/process-status.json`. The preflight therefore ran with an
isolated temporary index built from the current worktree; the real index was
not modified. The full worktree check also reports pre-existing whitespace in
`local-semantic-search.ts` and `memory-system-consolidation.ts`, outside this
write-consistency patch; those concurrent/user-owned changes were not rewritten.

The fresh read-only Codex pass returned `CLEAN` for the four source/test files
after checking same-ID ordering, reset interleavings, rejection cleanup,
different-ID independence, caller mutation, and malformed vectors. It recorded
the exact source hashes and made no edits. Its test runner could not create Vite
temporary files in the read-only sandbox, so the executable evidence remains
the writable-session 13/13 focused result and 428/428 default result above.

This does not invalidate the passing functional checks. A follow-up must
reconcile the charter-file index and unrelated worktree format failures under
their authorized workflows, then rerun the release gate before this change can
be released or pushed.
