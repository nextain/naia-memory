# Graphiti benchmark companion

This is a benchmark-only extension for the exact Graphiti revision in
`pin.json`. It adds one synchronous native ingestion route and two observations
needed for a fail-closed comparison:

- sequential episode commit before acknowledgement;
- exact episode/group commit acknowledgement;
- complete group-scoped current entity-edge state.

Copy `router.py` to
`server/graph_service/graphiti_benchmark_sidecar.py` in the pinned checkout, then
register it in the FastAPI application:

```python
from graphiti_benchmark_sidecar import router as benchmark_router

app.include_router(benchmark_router)
```

Run the service on loopback with Neo4j. Do not expose it to a shared network: the
upstream reference graph-service is unauthenticated. The companion does not alter
Graphiti extraction, prompts, invalidation, ranking, or persistence semantics.
It calls `add_episode` synchronously because the pinned reference server's queued
`/messages` handler closes its request-scoped Graphiti client before the queued
closure runs. Graphiti core 0.28.2 also treats a supplied episode UUID as an
existing-node lookup, so the companion lets core allocate its native UUID and
returns it in the commit receipt.

`current-facts` pages through Graphiti core's native group operation and returns
only edges whose `expired_at` is null. `invalid_at` is retained as temporal
metadata in Graphiti and is not treated as a separate benchmark deletion signal.

Native search may return expired historical edges. The REST client intersects
search results with the complete current-edge set using byte-identical native UUID
and fact text. This benchmark validity projection does not add, rewrite, or rerank
facts, but it can return fewer than the requested `max_facts`; it must not be
described as unmodified native search output. Competitive reports must disclose
this projection and report stale-result contamination separately from retrieval
quality.

The exact service passed two-group isolation, supersession, commit, and
search/current-state identity probes on 2026-08-22. The tracked receipt is
`reports/quality/graphiti-backend-smoke-2026-08-22.json`. This proves backend
eligibility, not competitive quality; a public comparison still requires the
sealed multilingual campaign and paired confidence intervals.

With the pinned service running, execute the fail-closed probe and save its JSON
receipt outside tracked report paths until the run passes:

```bash
GRAPHITI_BENCHMARK_URL=http://127.0.0.1:8000/ \
  pnpm benchmark:graphiti-smoke /tmp/graphiti-smoke.json
```
