# Graphiti benchmark companion

This is a benchmark-only, read-only extension for the exact Graphiti revision in
`pin.json`. It adds the two native observations missing from the stock REST API:

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
Graphiti extraction, prompts, invalidation, search, or persistence.

`current-facts` pages through Graphiti core's native group operation and returns
only edges whose `expired_at` is null. `invalid_at` is retained as temporal
metadata in Graphiti and is not treated as a separate benchmark deletion signal.

The pin establishes source compatibility only. A competitive run remains blocked
until the exact service passes two-group isolation, supersession, and identity
smoke probes and its LLM/embedder/reranker configuration is frozen in the campaign
receipt.
