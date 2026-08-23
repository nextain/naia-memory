# Global memory-engine comparison design (2026-08-22)

Status: research design; not a competitive-result claim.

## Decision

The public report must not present every memory product in one undifferentiated
leaderboard. Engines are grouped by the behavior exercised through their native
interfaces.

| Class | Engine | Native behavior exercised | Public comparison role |
|---|---|---|---|
| A: direct lifecycle-memory competitor | Mem0 OSS | LLM-inferred extraction/update plus semantic search | Primary same-input comparator |
| A: direct lifecycle-memory competitor | Hindsight | retain/recall over world, experience, and observation memories | Primary same-input comparator |
| A: direct temporal-memory competitor | Graphiti | incremental temporal graph construction and hybrid temporal/semantic retrieval | Required comparator before a broad update-correctness claim |
| B: agent-managed memory | Letta | an agent decides how to rewrite always-active core memory and archival memory; archival retrieval is query-dependent | Separate agent-policy plus archival-search comparison; not component-equivalent to direct retrieval engines |
| C: architecture reference | MemGPT | virtual context management across memory tiers | Cite as architectural ancestry unless an equivalent runnable surface is fixed |

## Evidence for the classification

- Mem0 describes dynamic extraction, consolidation, and retrieval, and reports
  LoCoMo results spanning single-hop, temporal, multi-hop, and open-domain
  questions: <https://arxiv.org/abs/2504.19413>.
- Hindsight exposes retain, recall, and reflect over four logical memory
  networks. Its open benchmark explicitly warns that judge prompts, generation
  prompts, and models can move scores substantially:
  <https://aclanthology.org/2026.acl-demo.27/> and
  <https://github.com/vectorize-io/hindsight/blob/main/hindsight-docs/blog/2026-03-23-agent-memory-benchmark.mdx>.
- Zep/Graphiti is explicitly temporal: it preserves historical relationships
  while incrementally integrating conversations and structured data. Its paper
  evaluates DMR and LongMemEval: <https://arxiv.org/abs/2501.13956>.
- MemGPT's primary abstraction is virtual context management and movement
  between memory tiers, not a drop-in retrieval index:
  <https://arxiv.org/abs/2310.08560>.
- Letta identifies itself as the continuation of MemGPT's agent design and
  memory-management work: <https://www.letta.com/blog/memgpt-and-letta/>.

## Adversarial findings against the current harness

1. The original Letta semantic bridge ignored the search query and returned the
   first `topK` non-persona core-memory blocks. The bridge was updated to expose
   always-active non-persona core state first and fill remaining slots with the
   version-pinned backend's native query-ranked archival search. The mixed
   surface is explicit in every artifact and still cannot support a
   component-level claim that Letta retrieval is weaker than Naia. Each run is
   required to bind `LETTA_ENGINE_VERSION` and an immutable image digest in its
   raw execution receipt; the bridge itself does not claim compatibility with a
   floating Letta version.
2. Mem0 and Hindsight use native query-dependent search/recall, so they remain
   suitable primary comparators when model, embedding, input order, isolation,
   and query budgets are disclosed.
3. A broad claim that Naia updates changing memories better than global engines
   is incomplete without a temporal-graph comparator. Graphiti is the strongest
   currently identified missing comparator because temporal validity is part of
   its stated architecture.
4. Published scores are not transitive. LoCoMo, LongMemEval, DMR, MIRACL, and
   Naia's supersession suites measure different tasks; paper numbers must never
   be placed beside local numbers as if produced by one experiment.
5. Korean or multilingual capability cannot be inferred from an English
   benchmark or from multilingual embeddings alone. Each engine needs the same
   held-out Korean, English, and Japanese lifecycle families, with language-level
   confidence intervals and failure categories.
6. The 2026-08-23 Graphiti backend smoke test rejected native-search eligibility
   for a current-state lifecycle leaderboard. After a relationship changed, the
   pinned native search surface returned three edges, including two superseded
   historical edges; the Naia adapter's explicit current-state projection
   returned one current edge. That projection is potentially useful product
   integration behavior, but it must not be relabeled as Graphiti-native update
   correctness. The failed smoke and runtime provenance are recorded in
   `graphiti-backend-smoke-2026-08-23-v2.json`.
7. The first Graphiti/Hindsight campaigns are diagnostic-only and carry tracked
   `DO_NOT_SCORE.md` markers. Graphiti failed the current-state identity gate,
   while Hindsight was initially read before asynchronous consolidation had
   settled. A corrected nine-case Hindsight diagnostic uses an explicit settled
   barrier, but its sample size and diagnostic origin are insufficient for a
   competitive claim.

## Required gates before a public competitive report

1. Finish and seal the full-corpus MIRACL-ko run with corpus hash, source
   manifest, runtime receipt, latency distribution, and exact-search settings.
2. Define two separately named Graphiti tracks: (a) native historical/temporal
   retrieval and (b) product-integrated current-state projection. Pin the
   revision, graph database, LLM, embedding model, and temporal fields, and do
   not place the two tracks in one undifferentiated update-correctness row.
3. Keep Letta results under an agent-managed-state section. Its native archival
   search is now exposed with the same query and bounded top-k budget, but the
   always-active core-first semantics remain a distinct engine surface rather
   than a direct-retrieval leaderboard row.
4. Run pre-registered, sealed same-input lifecycle campaigns for ko/en/ja. Keep
   contradiction, supersession, deletion, temporal ordering, multi-hop, and
   ordinary semantic recall as separate strata.
5. Report paired family-cluster bootstrap intervals, per-engine failures,
   ingestion/search latency, token and API cost, local/remote execution, and all
   model dependencies. A win requires the predeclared effect threshold and a
   confidence interval excluding zero; otherwise report parity or uncertainty.
6. Run an engine-blind adjudication packet and an adversarial review that checks
   for Naia-specific labels, metadata leakage, favorable query wording, unequal
   budgets, and benchmark-family overfitting.

## Current claim ceiling

Until those gates pass, the defensible statement is limited to: Naia has a
reproducible local benchmark program aimed at multilingual retrieval and memory
supersession, with direct adapters for Mem0, Hindsight, and Graphiti and an
agent-managed core-plus-archive adapter for Letta. Graphiti has passed backend
connectivity but failed current-state search-identity eligibility; its native
historical surface and Naia's projected current-state surface therefore require
separate tracks. Hindsight has only a corrected nine-case settled diagnostic,
not a sealed competitive campaign, and Letta's mixed surface is not a
component-equivalent leaderboard row. This is not yet evidence of global
superiority or global SOTA.
