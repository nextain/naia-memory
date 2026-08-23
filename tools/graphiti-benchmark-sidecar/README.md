# Graphiti benchmark companion

This is a benchmark-only extension for the exact Graphiti revision in
`pin.json`. It adds one synchronous native ingestion route and two observations
needed for a fail-closed comparison:

- sequential episode commit before acknowledgement;
- exact episode/group commit acknowledgement;
- complete group-scoped current entity-edge state;
- complete group-scoped historical entity-edge state, independently of search.

Copy `router.py` to
`server/graph_service/graphiti_benchmark_sidecar.py` in the pinned checkout, then
apply `process-lifetime-client.patch` from the checkout root. The patch registers
the router and changes the reference server from a request-scoped Graphiti/Neo4j
client to one process-lifetime client:

```bash
cp /path/to/router.py server/graph_service/graphiti_benchmark_sidecar.py
git apply /path/to/process-lifetime-client.patch
git apply /path/to/provider-adapter.patch
cp /path/to/test_process_lifetime_client.py server/tests/test_process_lifetime_client.py
cd server && uv lock
uv run python -m unittest -v tests/test_process_lifetime_client.py
```

`process-lifetime-client.patch` contains only the service lifecycle change and
benchmark-router registration. It is required for the locked graphiti-core 0.28.2
distribution.
Its Neo4j driver schedules index construction whenever construction occurs inside
an active event loop, so the upstream request-scoped dependency races repeated
index creation against benchmark transactions. That can produce defunct
connections and unhandled background task exceptions while HTTP requests still
return 200. The patch constructs one process-lifetime client in a worker thread,
where no event loop is active, then explicitly awaits Graphiti's public
`build_indices_and_constraints()` method before publishing the client. Shutdown
closes it once. The regression test proves off-loop construction, one explicit
initialization, request reuse, failure cleanup, and one shutdown close without
depending on a private driver attribute.

`provider-adapter.patch` is a separate benchmark-environment adapter. It replaces
the reference service's default OpenAI clients with graphiti-core's native Gemini
LLM and embedding clients. This adapter does change the extraction-model and
embedding-model configuration, so reports must identify it independently from the
lifecycle fix. It calls the external Gemini API and therefore the resulting run is
not network-hermetic even though the unauthenticated Graphiti HTTP service and
Neo4j are bound to loopback. Regenerate `server/uv.lock` immediately after
applying the adapter; evidence must record the resulting lockfile hash.

Run the service on loopback with Neo4j. Do not expose it to a shared network: the
upstream reference graph-service is unauthenticated. The lifecycle patch and
companion do not alter Graphiti prompts, invalidation, ranking, or persistence
semantics; the separately disclosed provider adapter changes model configuration.
It calls `add_episode` synchronously because the pinned reference server's queued
`/messages` handler closes its request-scoped Graphiti client before the queued
closure runs. Graphiti core 0.28.2 also treats a supplied episode UUID as an
existing-node lookup, so the companion lets core allocate its native UUID and
returns it in the commit receipt.

`current-facts` pages through Graphiti core's native group operation and returns
only edges whose `expired_at` is null. `invalid_at` is retained as temporal
metadata in Graphiti and is not treated as a separate benchmark deletion signal.
`historical-facts` uses the same complete paginated group operation without the
expiry filter. It is the independent identity source for the separately named
native-historical search track; query output must never be used as its own state
evidence.

Native search may return expired historical edges. Normal benchmark recall
intersects
search results with the complete current-edge set using byte-identical native UUID
and fact text. This benchmark validity projection does not add, rewrite, or rerank
facts, but it can return fewer than the requested `max_facts`; it must not be
described as unmodified native search output. Competitive reports must disclose
this projection and report stale-result contamination separately from retrieval
quality.

The smoke probe separately requests unprojected native search output and fails if
that output contains an edge absent from current state. This keeps the validity
projection from making the search/state check tautological.

The original request-scoped service passed two-group isolation, supersession,
commit, and search/current-state identity probes on 2026-08-22. The tracked receipt is
`reports/quality/graphiti-backend-smoke-2026-08-22.json`. This proves backend
eligibility, not competitive quality; a public comparison still requires the
sealed multilingual campaign and paired confidence intervals. Because that probe
did not audit background task failures, rebuild with the lifecycle patch and
produce a new clean receipt before using Graphiti results as competitive evidence.

With the pinned service running, execute the fail-closed probe and save its JSON
receipt outside tracked report paths until the run passes:

```bash
GRAPHITI_BENCHMARK_URL=http://127.0.0.1:8000/ \
  pnpm benchmark:graphiti-smoke /tmp/graphiti-smoke.json
```
