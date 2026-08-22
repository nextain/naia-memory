# Graphiti semantic comparison contract (2026-08-22)

Status: implementation checkpoint; not a competitive result.

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
- Exclude invalidated or expired edges from current state, while retaining their
  native lifecycle evidence in the raw engine receipt when the sidecar is added.
- Pin the Graphiti revision, graph backend, LLM, embedder, reranker, prompts/defaults,
  and dependency lock. Report ingestion/search latency and provider cost separately.

## Required companion surface

The stock graph-service exposes fact search and episode listing, but no complete
group fact-list route. Graphiti core does expose group-scoped entity-edge listing.
The benchmark therefore requires a revision-pinned, read-only companion sidecar
that maps that native core operation without changing extraction, invalidation, or
ranking. Until its isolation and current-edge filtering are tested against the
pinned backend, Graphiti execution is `NOT_RUN`; it must not be approximated.

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
- Four focused unit tests and the semantic-runner regression tests pass; project
  TypeScript typechecking passes.
- Formal external review is `NOT_RUN`: deterministic review preflight rejected an
  unrelated, user-owned untracked tool cache. No cross-validation claim is made.

## Remaining release gate

Implement and pin the companion sidecar, pass backend namespace/validity smoke tests,
wire the engine into the sealed semantic campaign, then run paired multilingual
comparison with bootstrap intervals. Only those receipts can support a public claim.

Primary references:

- Graph-service retrieval routes: https://github.com/getzep/graphiti/blob/main/server/graph_service/routers/retrieve.py
- Graph-service ingestion routes: https://github.com/getzep/graphiti/blob/main/server/graph_service/routers/ingest.py
- Native entity-edge group operation: https://github.com/getzep/graphiti/blob/main/graphiti_core/driver/operations/entity_edge_ops.py
- Graphiti search behavior: https://help.getzep.com/graphiti/working-with-data/searching
