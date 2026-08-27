# Graphiti semantic comparison contract (2026-08-22)

Status: backend eligibility rejected by the 2026-08-23 v2 smoke; do not score
or publish the existing Graphiti campaigns. Eligibility requires a new clean
smoke with `passed: true` before any campaign rerun.

## Why Graphiti belongs in the comparison

Graphiti is a direct temporal-memory competitor: it incrementally extracts entity
edges from episodes, invalidates superseded facts, and retrieves facts with hybrid
search. That makes it more relevant to update, contradiction, and temporal cases
than a vector store alone.

## Fair execution boundary

- One random `group_id` per held-out case; delete only that group after the case.
- Send natural-language turns only. Do not send fixture timestamps, expected IDs,
  benchmark labels, language hints, or lifecycle labels.
- Submit one episode and wait until that exact episode UUID is readable before the
  next turn. The stock graph-service queues `/messages`; accepting HTTP 202 is not
  evidence that extraction and invalidation completed.
- Retrieve with Graphiti's native group-scoped fact search and preserve entity-edge
  UUIDs as identities.
- Score state against all currently valid native entity edges in the group. Do not
  substitute raw episodes, the query's top-k results, or an unbounded synthetic
  query for complete state.
- Exclude edges whose native `expired_at` is set. `invalid_at` is temporal interval
  metadata and is not an independent state-deletion rule. Retain both fields in
  raw engine receipts when lifecycle evidence capture is added.
- Pin the Graphiti revision, graph backend, LLM, embedder, reranker, prompts/defaults,
  and dependency lock. Report ingestion/search latency and provider cost separately.

## Required companion surface

The stock graph-service exposes fact search and episode listing, but no complete
group fact-list route. Graphiti core does expose group-scoped entity-edge listing.
The benchmark therefore uses a revision-pinned companion sidecar that maps that
native core operation and commits one episode synchronously without changing
extraction, invalidation, or ranking. The REST bridge intersects native search
results with native current edges by exact UUID and fact text because Graphiti
search can return expired historical edges.

## Adversarial risks and gates

1. Async stale-state false positives: prove turn N is committed before turn N+1.
2. Namespace routing: run two-group isolation probes on the exact backend/revision.
3. State/search identity mismatch: every retrieved UUID must occur in current state
   with byte-identical fact text.
4. Bulk-ingestion shortcut: forbidden for lifecycle cases because update ordering
   and edge invalidation are the behavior under test.
5. Benchmark overfit: use the same sealed Korean, English, and Japanese cases and
   adjudication rules as every engine; no Graphiti-specific fixture rewrite.
6. Surface bias: report retrieval and lifecycle-state strata separately. A temporal
   graph may be better at state evolution while another engine ranks top-k better.
7. Security boundary: bind the service to loopback or an isolated network. Do not
   expose the unauthenticated reference graph-service to a shared network.

## Current evidence

- The independent TypeScript bridge enforces random group isolation, sequential
  commit polling, native fact UUID preservation, native current-state listing, and
  isolated cleanup.
- The concrete REST client maps stock ingestion/search/delete plus companion
  commit/current-state routes, validates native fact identity, and rejects the
  unauthenticated service on non-loopback hosts by default.
- The companion is pinned to Graphiti commit
  `993e081a6d7948a0d8851c12a5fbdbeb49fed862` with Neo4j and pages native
  `EntityEdge.get_by_group_ids`, filtering current state by `expired_at is None`.
- The exact backend passed commit, two-group isolation, supersession, and
  search/current-state identity checks with Graphiti core 0.28.2, Neo4j 5.26.2,
  native Gemini client 1.62.0, Gemini 2.5 Flash, and gemini-embedding-001.
- Eleven Graphiti-specific tests and four generic semantic-runner regression tests
  pass;
  project TypeScript typechecking and Python syntax compilation pass.
- Formal external review is `NOT_RUN`: deterministic review preflight rejected an
  unrelated, user-owned untracked tool cache. No cross-validation claim is made.

## Remaining release gate

Wire the eligible engine into the sealed semantic campaign, then run a paired
multilingual comparison with bootstrap intervals. Only those receipts can support
a public claim. The smoke result must not be presented as a quality win.

Primary references:

- Graph-service retrieval routes: https://github.com/getzep/graphiti/blob/main/server/graph_service/routers/retrieve.py
- Graph-service ingestion routes: https://github.com/getzep/graphiti/blob/main/server/graph_service/routers/ingest.py
- Native entity-edge group operation: https://github.com/getzep/graphiti/blob/main/graphiti_core/driver/operations/entity_edge_ops.py
- Graphiti search behavior: https://help.getzep.com/graphiti/working-with-data/searching
