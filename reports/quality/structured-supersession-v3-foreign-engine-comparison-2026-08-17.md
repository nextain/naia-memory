# Structured Supersession v3 — Foreign Engine Comparison (2026-08-17)

## Decision

Naia Memory now demonstrates a meaningful but deliberately narrow advantage: when a caller supplies a language-neutral `(subject, property)` query identity, its explicit lifecycle path retrieves the complete current fact set at rank 1 and excludes superseded or same-property foreign-entity facts on this generated Korean/English/Japanese corpus. This is evidence for **update-safe current-memory retrieval**, not global memory-engine superiority.

The improvement removes the pooled-corpus multi-value failure found in the previous diagnostic. Explicit-structure complete acceptable recall at top 20 rises from 83.3% to 100.0%, history coverage rises from 16.7% to 100.0%, and hit@1 rises from 82.4% to 100.0%. No answer value is supplied at recall: the new hint contains only `subject` and `property`.

## Same-condition executable comparison

Fixture: 108 generated diagnostic cases, 36 each in Korean, English, and Japanese. Embeddings use `multilingual-e5-small` on CPU and evaluation depth is top 20. All systems receive the same statement text and project partition. Mem0 runs with `infer:false`, so it is a raw retrieval control. Hindsight runs its normal synchronous Gemini 2.5 Flash extraction/update path and local multilingual embedding/reranking path. These are feature-effect controls, not a symmetric whole-product leaderboard.

| Engine/path | hit@1 | hit@20 | complete acceptable@20 | acceptable recall@20 | MRR | forbidden@1 | forbidden@20 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Naia explicit structure | **100.0%** | 100.0% | 100.0% | 100.0% | **1.000** | **0.0%** | **0.0%** |
| Mem0 OSS 2.4.5 raw control | 69.4% | 100.0% | 100.0% | 100.0% | .834 | 25.9% | 66.7% |
| Hindsight 0.9.1 normal retain/recall | 62.0% | 100.0% | 100.0% | 100.0% | .793 | 38.0% | 66.7% |

The defensible result is first-rank freshness and stale/foreign-fact exclusion. All three paths recover all acceptable facts by top 20. Therefore the evidence does not support a claim that Naia stores or broadly recalls more information; it supports a claim that Naia's explicit identity plus lifecycle contract ranks currently applicable facts more safely on this diagnostic. Hindsight's per-language hit@1 was Korean 72.2%, English 61.1%, and Japanese 52.8%; Naia was 100% in each language. This is not evidence that Hindsight broadly fails Japanese, because this generated fixture and its structured identity intervention are Naia-specific.

Receipts:

- `reports/quality/structured-supersession-contract-v3-multilingual-e5-small-top20-vector-only.json`
- `reports/quality/structured-supersession-contract-v3-mem0-oss-raw-control-multilingual-e5-small-top20.json`
- `reports/quality/structured-supersession-contract-v3-hindsight-gemini-2.5-flash-multilingual-e5-small-top20.json`

The Hindsight receipt pins official container v0.9.1 at digest `sha256:8a305b...3729`, CPU-only local `intfloat/multilingual-e5-small`, Gemini 2.5 Flash, 252 retained statements, 534,621 extraction tokens, and 140.9 seconds wall time with concurrency 8. Its recall API accepts a token budget rather than a result count, so unique statement IDs were truncated to top 20 after recall. Naia receives caller-supplied structured identity; Hindsight must infer memory structure from text. That asymmetry is the product mechanism under test and also the reason this table cannot establish general superiority.

## What changed

`RecallContext.structuredQuery` carries only the normalized subject and property identity into local semantic search. Exact identity receives a candidate-ranking bonus before broad-pool truncation. The answer value, polarity, and cardinality are not part of the query hint. Strict project filtering and latest/history lifecycle rules still run independently.

An embedding-based MMR variant was also tested and rejected: it produced no improvement over the 83.3% complete-recall baseline. Doubling the broad candidate pool had previously produced no improvement either. These null results, plus 100% isolated multi-value retrieval, identify identity-aware pooled ranking rather than storage loss, MMR, or shortlist size as the relevant bottleneck.

## Foreign-engine capability comparison

| Engine | Publicly documented strength | Relation to Naia result | Verification level in this report |
|---|---|---|---|
| Mem0 | Managed/OSS memory extraction and search; newer releases document linked supersession chains and `latestOnly` | Closest executable package already pinned locally, but the installed OSS 2.4.5 raw API does not expose the same lifecycle query contract used here | Executed, numeric retrieval control only |
| Graphiti | Temporal knowledge graph with validity windows, automatic fact invalidation, history, and hybrid semantic/keyword/graph retrieval | Closest conceptual competitor to Naia's temporal lifecycle and history behavior | Capability review only; not executed because it requires a graph DB and LLM-backed ingestion stack |
| Hindsight | Four-network structured memory with retain, recall, and reflect stages; publishes LongMemEval and LoCoMo harnesses | Strong OSS end-to-end competitor for evolving facts, observations, and beliefs | Executed numerically with official v0.9.1 container and normal LLM-backed retain |
| Supermemory | Relational versioning, temporal grounding, hybrid search, and a public MemoryBench adapter surface | Strong hosted/OSS benchmark competitor, especially for knowledge updates and temporal reasoning | Official code/results review only; not yet executed under a common model and judge |
| Memora | Harmonic abstraction/specificity representation with official LoCoMo and LongMemEval runners | Research-grade comparison candidate for semantic and episodic memory | Official code review only; not yet executed |
| LangMem | Background memory extraction, consolidation, update tools, and LangGraph store integration | Comparable orchestration/update layer; less directly comparable to this local retrieval adapter | Capability review only |
| Letta | Agent memory blocks, archival semantic search, and git-backed MemFS direction | Broader agent-state/memory-files abstraction than this fact-lifecycle benchmark | Capability review only |

Primary sources: Mem0 releases (`https://github.com/mem0ai/mem0/releases`), Graphiti/Zep (`https://github.com/getzep/graphiti`, `https://www.getzep.com/research/`), Hindsight (`https://github.com/vectorize-io/hindsight`, `https://github.com/vectorize-io/hindsight-benchmarks`), Supermemory (`https://github.com/supermemoryai/supermemory`, `https://supermemory.ai/research/longmembench/`), Memora (`https://github.com/microsoft/Memora`), LangMem (`https://github.com/langchain-ai/langmem`), and Letta (`https://github.com/letta-ai/letta`). Public capabilities and vendor results were reviewed on 2026-08-17; vendor numbers are not copied into Naia's numeric table because model, judge, retrieval depth, and protocol differ. Absence from this table is not evidence that an engine lacks a capability.

The bounded comparison shortlist was fully preflighted. Naia, Mem0, and Hindsight were executable and measured. Graphiti was not quality-scored because no required Neo4j/FalkorDB plus LLM ingestion service was present; Memora requires its Python source stack and model configuration; Supermemory requires a hosted credential or local service; LangMem is an orchestration/toolkit layer rather than a standalone retrieval engine; Letta requires its agent server and changes the unit of comparison. These are **unexecuted arms**, not failures or zero scores. Installing their service stacks or spending hosted API credit would be a new benchmark environment, not the frozen local contract.

The next fair global comparison should use one frozen LongMemEval-S and LoCoMo protocol with the same answer model, judge, context budget, and latency accounting. The executable shortlist is Hindsight, Graphiti, Memora, and Naia; API-backed arms can add Supermemory and Zep.

## Multilingual meaning

The lifecycle and identity mechanism is language-neutral in the limited sense that it compares caller-provided opaque subject/property strings and preserves original-language values. The same generated contract passes in Korean, English, and Japanese. It does **not** perform cross-lingual entity canonicalization: `사용자`, `user`, and `ユーザー` are different identities unless an upstream extractor maps them to a stable identity. Thus Naia is not Korean-only, but robust multilingual production use still depends on multilingual extraction/canonicalization in naia-agent or another caller.

## Adversarial limits and remaining gates

- The fixture is generated, template-correlated, and not native-reviewed. It is diagnostic evidence, not a publication-grade leaderboard.
- The benchmark directly supplies the structured query identity. It proves the retrieval mechanism once identity exists, not that naia-shell/naia-agent reliably extracts it from natural user utterances.
- The Naia and Mem0 controls are intentionally asymmetric in available metadata. That asymmetry represents the feature being tested, but prevents a claim about overall engine quality.
- Graphiti, Memora, Supermemory, LangMem, and Letta were preflighted but not run under this contract, so no numeric ranking against them is claimed.
- The next release gate is end-to-end extraction/canonicalization from naturally authored Korean/English/Japanese utterances, followed by unchanged cross-engine adapters, held-out native-reviewed cases, confidence intervals, and naia-shell/naia-agent integration tests.

An independent local OpenCode headless review was run with `opencode run --pure` using `opencode/big-pickle`. It returned **CLEAN** after checking answer leakage, lifecycle/project filtering, report-to-artifact metrics, comparison asymmetry, benchmark gaming, regression coverage, and public-claim gates. The review is recorded in `reports/quality/structured-supersession-v3-opencode-adversarial-review-2026-08-17.md`. Review date: 2026-08-17.

## Claim that can be made now

“On Naia Memory's frozen 108-case generated Korean/English/Japanese update-retrieval diagnostic, the explicit identity/lifecycle path achieved 100% top-1 current-fact retrieval and 0% forbidden-fact exposure. Mem0 OSS 2.4.5 raw retrieval scored 69.4%/25.9%, and Hindsight 0.9.1 with normal Gemini-backed retain scored 62.0%/38.0%. All paths reached 100% acceptable recall by top 20. This establishes a narrow current-fact ranking advantage under Naia's structured-identity contract, not global engine superiority.”
