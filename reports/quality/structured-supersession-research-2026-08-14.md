# Structured supersession research note — 2026-08-14

## Decision

Add a fixed, held-out mechanism contract for explicit fact supersession before changing retrieval ranking. The contract runs the same Korean, English, and Japanese update sequences with an unstructured control and with explicit extractor structure. It reports lifecycle correctness, retrieval relevance, and stale/foreign fact exposure separately.

This is deliberately narrower than a general retrieval claim. It validates that a structured write-time policy does what it says: a newer affirmed single-valued fact can supersede the predecessor in the same project; multi-valued facts, negations, different properties, and project boundaries remain preserved.

## External research

- [MemConflict](https://arxiv.org/abs/2605.20926) separates dynamic, static, and conditional memory conflicts, and evaluates both final answers and retrieval/ranking. Its conflict taxonomy supports measuring stale-memory exposure separately from general retrieval.
- [Memora](https://arxiv.org/abs/2604.20006) argues that fact-retrieval benchmarks alone miss conflict resolution, and its FAMA metric penalizes obsolete facts that remain active. This supports an explicit active/inactive lifecycle metric.
- [BGE-M3 documentation](https://bge-model.com/tutorial/6_Retrieval/6.2.html) describes multilingual dense, sparse, and multi-vector retrieval and recommends candidate retrieval followed by reranking. It is a future ranking option, not evidence that changing the default model will help this package.

These 2026 papers are design evidence, not product-performance evidence. No result from them is imported into Naia Memory's score.

## Implementation boundary

The benchmark is at `src/benchmark/quality/structured-supersession-contract.ts`; fixture at `src/benchmark/quality/structured-supersession-contract-v1.json`.

- Metadata is supplied by a deterministic benchmark extractor. The benchmark therefore measures the store/reconciliation mechanism, not an LLM extractor's accuracy.
- Every comparison uses the same CPU embedding model and fixed corpus. There are no language-specific weights, translated labels, or tuned thresholds.
- The control is an **unstructured pipeline control**, not a historical-release comparison. It establishes the contribution of explicit metadata within the current revision.
- The existing Korean retrieval contract remains the broader semantic-retrieval guardrail. A structured-supersession win must not be represented as an improvement to its hit@k/MRR.

## First receipt

Command:

`pnpm exec tsx src/benchmark/quality/structured-supersession-contract.ts`

Receipt: `reports/quality/structured-supersession-contract-v1.json`. It uses `paraphrase-multilingual-MiniLM-L12-v2` on CPU, top-5, seven fixed cases, and a dirty working tree at revision `722dfc5e2af7098b01b49a3229c5477b80a4e547`.

| Variant | hit@1 | hit@5 | MRR | forbidden@1 | forbidden@5 | lifecycle |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| unstructured control | 14.3% | 42.9% | 0.243 | 14.3% | 42.9% | 42.9% |
| explicit structure | 42.9% | 85.7% | 0.564 | 0.0% | 0.0% | 100.0% |

The explicit-structure run correctly preserved every guard case and hid each predecessor in the three replacement cases. Per-language lifecycle was 100% for Korean, English, and Japanese. The Japanese hit@1 result remains 0.0% (hit@5 100.0%), so this receipt does **not** justify a Japanese ranking-quality claim; it only shows that the write-time lifecycle policy is language-agnostic when the extractor supplies matching opaque labels.

## Adversarial history check

The initial receipt measured whether a `mode: "history"` recall returns every expected fact in the same top-5 result. That result is 14.3% for explicit structure (and 28.6% for the control). It must be named **history coverage@5**, not history correctness: the API uses normal relevance ranking with a top-K limit, then permits superseded facts; it does not promise a complete chain in a five-item result.

To distinguish retrieval truncation from data loss, the identical frozen contract was run at top-20 before restoring the canonical top-5 receipt. At top-20, explicit structure reached 100.0% history coverage and the control 85.7%. The predecessor/successor data is therefore retained and visible to the history path; the unresolved limitation is discoverability of an entire chain at small K. This is a real product question, but it is not evidence that consolidation destroyed history.

Do not add a chain-promotion heuristic merely to improve this number. It could displace more relevant facts, change the public top-K contract, and overfit seven synthetic cases. The next experiment should add a separately named chain-expansion API or evaluate a ranker on a larger frozen corpus, with relevance, latency, and the Korean forbidden-exposure guardrail measured together.

## v2 multilingual paraphrase and entity-confusion expansion

`structured-supersession-contract-v2.json` preserves the seven v1 cases and adds one native-language paraphrase plus same-property third-party distractor case for Korean, English, and Japanese (10 cases total). This is an expansion of the mechanism diagnostic, not an independent production benchmark or a basis for a default-ranking claim.

On CPU at top-5 with RRF, explicit structure retained 100.0% lifecycle correctness and 0.0% stale/foreign exposure, while moving MRR from 0.150 to 0.500 and hit@5 from 20.0% to 60.0% against the unstructured control. The three added cases expose an important limit: Japanese entity-confusion retrieval missed at top-5, and existing multi-value/negation/property cases compete poorly once cross-language distractors are present. The mechanism is behaving correctly; relevance ranking is the bottleneck.

`vector-only` scored better within this small expansion (explicit MRR 0.620, hit@5 70.0%, stale/foreign exposure 0.0%). It is still rejected as a default candidate because the pre-existing, broader Korean frozen contract records forbidden@5 56.3% for vector-only versus 43.8% for RRF. A local improvement cannot override that safety regression.

## Rejected MMR candidate

MMR is a global diversification setting, so disabling it was tested as a single configuration candidate rather than a language-specific adjustment. The receipts `structured-supersession-contract-v2-no-mmr.json` and `korean-retrieval-contract-v1-rrf-no-mmr.json` record the setting explicitly.

The result was exactly unchanged on both frozen contracts: the v2 explicit-structure score remained hit@1 40.0%, hit@5 60.0%, MRR 0.500, stale/foreign exposure 0.0%, and lifecycle 100.0%; the Korean contract remained hit@1 6.3%, hit@5 56.3%, MRR 0.226, forbidden@1 25.0%, and forbidden@5 43.8%. Therefore MMR is not the source of the Japanese entity-confusion miss and is not a performance lever on either corpus. Keep its default unchanged.

This narrows the next investigation: the failure originates in candidate relevance before diversification. A valid next candidate must provide better multilingual candidate scoring without adding query-intent parsing or relying on fixture-only entity metadata.

## Deferred CPU reranker candidate

The benchmark runners now record an explicit `BENCH_RERANKER` setting so an optional `bge-reranker-base` provider can be measured without changing the product default. On 2026-08-15, the v2 fixed contract was started with `BENCH_RERANKER=bge-reranker-base` on CPU fp32. The provider loaded successfully, but the 10-case run did not complete within eight minutes and was interrupted before it emitted a receipt. No quality metric is claimed from this attempt.

This is sufficient to reject the configuration as a default CPU path, and insufficient to accept it even as a high-quality option: there is neither a completed held-out quality result nor an isolated warm-run latency receipt. Keep the provider injection optional and leave RRF as the default. Revisit only with batched inference, a measured warm-start latency budget, and both the multilingual stale-exposure and broad Korean forbidden-exposure contracts.

## Rejected batched q8 reranker candidate

The provider audit found two implementation defects in the deferred experiment: it invoked the model once per candidate, and the generic text-classification pipeline did not supply BGE's query/passage pair as a tokenizer `text_pair`. The provider now scores pairs directly, applies sigmoid to BGE's single relevance logit, and processes eight candidates per model call. Unit tests fix both the pair-score ordering and the call-count contract.

The corrected CPU q8 run completed on the same v2 contract. Receipt: `reports/quality/structured-supersession-contract-v2-bge-reranker-base-q8.json`.

| Explicit-structure variant | hit@1 | hit@5 | MRR | forbidden@5 | lifecycle | wall time | max RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| RRF without reranker | 40.0% | 60.0% | 0.500 | 0.0% | 100.0% | not isolated | not isolated |
| RRF + BGE q8 reranker | 30.0% | 70.0% | 0.433 | 0.0% | 100.0% | 210.12 s | 1,729,480 KB |

The extra top-5 hit does not compensate for worse first-rank accuracy and MRR, and the CPU cost is outside an interactive retrieval budget. This candidate is rejected without spending another broad-contract run: it fails the local quality/latency gate before the broader Korean forbidden-exposure gate. The optional provider correctness fix remains useful, but it does not change the default retrieval path and is not evidence of a product performance improvement.

## Rejected ranking candidate

The same contract was also run with `BENCH_SEARCH_MODE=vector-only`; receipt: `reports/quality/structured-supersession-contract-v1-vector-only.json`.

With explicit structure, vector-only preserved the same stale/foreign exposure result as RRF and changed MRR only from 0.564 to 0.571. That narrow movement is not meaningful evidence for a default switch. More importantly, the independently reviewed Korean retrieval contract still records higher forbidden@5 exposure for vector-only (56.3%) than for RRF (43.8%). Keep RRF as the default and treat vector-only as rejected until a broader frozen corpus reverses that safety result.

## Next gate

The mechanism gate is now recorded. Next, expand the held-out corpus with native-language paraphrases and entity-confusion distractors, then test a reranker or multilingual retriever as a separate frozen-corpus comparison with costs and latency. Do not change the default ranker until the broad Korean contract and this stale-exposure contract both pass.

## 2026-08-15 benchmark-independence correction

Adversarial review found that both retrieval runners reused mutable recall state across cases. Every recall updates `recallCount`, `lastAccessed`, and `strength`; consequently, earlier cases and the requested top-K could affect later rankings. The runners now restore the original recall state before each measured query (and separately before the history query). Earlier v2 and broad-Korean ranking values in this note are superseded by the independent-case receipts below. Lifecycle results remain unchanged.

| Independent-case CPU receipt | hit@1 | hit@5 | MRR | forbidden@1 | forbidden@5 | lifecycle |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| v2 explicit structure / RRF | 40.0% | 70.0% | 0.525 | 0.0% | 0.0% | 100.0% |
| broad Korean / RRF | 50.0% | 81.3% | 0.635 | 31.3% | 56.3% | n/a |
| broad Korean / vector-only | 37.5% | 68.8% | 0.497 | 25.0% | 50.0% | n/a |

The corrected evidence changes the diagnosis. General Korean retrieval is substantially stronger than the contaminated sequence suggested, but hard-negative exposure remains high. Vector-only reduces forbidden exposure slightly while losing 12.5 points of hit@1, 12.5 points of hit@5, and 0.138 MRR, so it remains rejected.

Increasing the internal candidate multiplier from 3 to 6 and 12 produced byte-for-metric identical scores on both corrected contracts. The top-20 diagnostic still reaches 100% v2 hit coverage, but that reflects results below rank five rather than candidate starvation. The configurable multiplier experiment is rejected and was not retained in product code.

`multilingual-e5-large` q8 was also tested on v2. It produced hit@1 40.0%, hit@5 60.0%, and MRR 0.470 versus the then-current RRF receipt's 40.0%, 60.0%, and 0.500; it recovered one Japanese case while losing an English case and required a 562 MB model download with 1,744,852 KB max RSS. It is rejected as a generalized default-model improvement. Because that run predates the independence correction, it must not be compared numerically with the corrected 70.0% hit@5 receipt.

The product-side lifecycle filter was independently corrected so inactive rows are removed before candidate truncation. A targeted starvation regression test passes, while both frozen quality contracts remain metric-identical; this is a correctness fix, not a ranking-performance claim.

The next valid performance experiment should target contradiction and entity disambiguation without language-specific query rules. Acceptance requires preserving the corrected RRF relevance floor while materially reducing forbidden@1 and forbidden@5 on the broad Korean contract, then passing the multilingual lifecycle/stale-exposure gate.

## Corrected E5 candidate result

The pre-correction E5 rejection above is superseded. After case-state isolation, `multilingual-e5-large` q8 was run twice on each frozen contract. Both repetitions were metric-identical. The provider applies the model's asymmetric `query:` and `passage:` prefixes and uses no language-specific rule or benchmark-category weight.

| Independent-case CPU receipt | hit@1 | hit@5 | MRR | forbidden@1 | forbidden@5 | lifecycle |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| broad Korean / MiniLM RRF | 50.0% | 81.3% | 0.635 | 31.3% | 56.3% | n/a |
| broad Korean / E5-large q8 RRF | 68.8% | 87.5% | 0.781 | 12.5% | 56.3% | n/a |
| v2 explicit structure / MiniLM RRF | 40.0% | 70.0% | 0.525 | 0.0% | 0.0% | 100.0% |
| v2 explicit structure / E5-large q8 RRF | 50.0% | 70.0% | 0.570 | 0.0% | 0.0% | 100.0% |

This is a material multilingual-retriever candidate: on the broad Korean contract it adds 18.8 points of hit@1, 6.2 points of hit@5, and 0.146 MRR while reducing forbidden@1 by 18.8 points; v2 also gains 10 points of hit@1 and 0.045 MRR without weakening stale-exposure or lifecycle gates. The remaining forbidden@5 value (56.3%) shows that contradiction safety is not solved.

The candidate is not yet a default recommendation. Measured process max RSS was approximately 1.80–1.85 GB, with a roughly 562 MB cached model, versus the current 384-dimensional lightweight default. The next gate is a quality/resource curve across smaller E5 variants, followed by configuration and dimension compatibility checks in Naia Shell and Naia Agent. Receipts: `korean-retrieval-contract-v1-rrf-multilingual-e5-large.json` and `structured-supersession-contract-v2-multilingual-e5-large.json`.

## E5 quality/resource curve

The same q8 implementation and asymmetric prefixes were extended to the official E5 small and base variants. The broad Korean run for small was repeated after caching and produced identical metrics. The multilingual v2 contract remained at zero stale/foreign exposure and 100% lifecycle for every size.

| Model | dimensions | broad hit@1 | hit@5 | MRR | forbidden@1 | forbidden@5 | v2 hit@1 / hit@5 / MRR | measured max RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| paraphrase MiniLM | 384 | 50.0% | 81.3% | 0.635 | 31.3% | 56.3% | 40.0% / 70.0% / 0.525 | not isolated |
| E5 small q8 | 384 | 68.8% | 87.5% | 0.771 | 12.5% | 56.3% | 40.0% / 70.0% / 0.525 | 648–659 MB cached (observation only) |
| E5 base q8 | 768 | 62.5% | 87.5% | 0.729 | 12.5% | 56.3% | 40.0% / 70.0% / 0.533 | 972–1,040 MB |
| E5 large q8 | 1024 | 68.8% | 87.5% | 0.781 | 12.5% | 56.3% | 50.0% / 70.0% / 0.570 | 1.80–1.85 GB |

E5 small is the practical default candidate. The regenerated fixed-clock receipt supersedes the earlier 62.5%/0.740 row: it preserves the current 384-dimensional storage contract, gains 18.8 points hit@1, 6.2 points hit@5, and 0.136 MRR over MiniLM, and reduces forbidden@1 by 18.8 points. E5 base is rejected: it uses substantially more memory without improving hit@5 and its older receipt predates the strengthened provenance schema. Large remains an exploratory quality-max option, not the resource-balanced default.

Read-only integration tracing found that Naia Agent and Naia Shell currently expose only E5 large and paraphrase MiniLM in their closed model unions. Shell currently defaults its embedding slot to E5 large, while Agent correctly forwards that model to Naia Memory. Therefore the existing large path is wired, but E5 small cannot yet pass through the settings boundary. A separate Agent/Shell contract update is required before selecting small in the product UI; this Naia Memory contract does not authorize mutations in those repositories.

## Adversarial deployment review: model-switch safety

Equal dimensions do not make embedding spaces compatible. The JSON-backed LocalAdapter persists raw fact vectors but no provider/model identity. A MiniLM-to-E5-small switch therefore keeps the same 384-dimensional shape and silently compares new E5 query vectors with old MiniLM passage vectors. The cosine guard only rejects different lengths, so it cannot detect this corruption. The SQLite adapter has a second hazard: `vec0` tables are created with the configured dimension only when absent, so reopening an existing database with a differently sized model can retain the old schema.

This blocks a safe default switch despite the quality result. The required migration contract is: persist an embedding-space fingerprint (provider, model, dimensions, preprocessing revision), reject mismatches before recall, and provide an explicit full re-encode path that atomically rebuilds every vector index. Legacy stores without a fingerprint need an explicit adopt/reindex decision; dimensions alone are insufficient. Until that path and its restart tests exist, E5-small is a measured candidate rather than a deployable default.

The LocalAdapter portion is now implemented: offline providers expose a preprocessing-versioned space ID, new JSON stores persist it, and mismatched or unidentified legacy vectors fail before a write mutates memory. `reindexEmbeddings()` snapshots IDs and content, validates the rebuilt vectors, aborts if memory changed during asynchronous embedding, and then saves the vectors with the new identity using the adapter's atomic file replacement. Equal-dimension mismatch, rejected-write isolation, concurrent-change abort, and legacy-store regression tests pass. SQLite vector-space migration and the Agent/Shell configuration boundary remain open, so the deployable-default conclusion is unchanged.

## Frozen-input Mem0 OSS raw-memory control

The v2 input, queries, top-K, CPU device, and embedding provider were also run through Mem0 OSS 2.4.5 with `infer: false`. This is a frozen-input raw-memory control: it exercises Mem0's vector storage and search without an LLM update/extraction call. Naia's explicit-structure rows use the same frozen ten cases and embedding configuration. The retrieval stacks are deliberately engine-native, not identical: Mem0 uses its vector search, while Naia uses its configured RRF/MMR pipeline plus lifecycle filtering. The table therefore compares end-to-end retrieval behavior under controlled inputs; it does not isolate vector-store quality.

| Engine / embedder | hit@1 | hit@5 | MRR | forbidden@1 | forbidden@5 | stale forbidden@5 | active distractor@5 | lifecycle |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Naia explicit / MiniLM | 40.0% | 70.0% | 0.525 | 0.0% | 0.0% | 0.0% | 0.0% | 100.0% |
| Mem0 raw / MiniLM | 30.0% | 80.0% | 0.487 | 30.0% | 50.0% | 50.0% | 20.0% | not scored |
| Naia explicit / E5 small | 40.0% | 70.0% | 0.525 | 0.0% | 0.0% | 0.0% | 0.0% | 100.0% |
| Mem0 raw / E5 small | 50.0% | 100.0% | 0.658 | 40.0% | 60.0% | 60.0% | 30.0% | not scored |

The corrected control reveals a meaningful trade-off. Mem0 raw retrieval has higher top-five coverage, especially with E5 small, but frequently returns obsolete facts and sometimes active facts about another subject. Naia's end-to-end explicit-structure retrieval stack eliminates both classes of forbidden result in this fixture and records the expected active/inactive state in all ten cases. Its current history-mode top-five coverage is 10.0%. An experimental expansion briefly measured 60.0%, but adversarial review rejected it because it could evict independently ranked anchors and assign unearned relevance to linked rows; that result is not a current capability claim. Increasing embedding quality improves raw recall but does not provide correction safety: with E5 small, Mem0's hit@5 rises from 80% to 100% while stale-forbidden exposure rises from 50% to 60%. Because Naia also uses RRF, BM25, graph signals, MMR, strict project scope, and lifecycle filtering, this experiment does not attribute the entire difference to lifecycle filtering alone. It does show that the measured result is not a Korean-only embedding trick: the fixture spans Korean, English, and Japanese and uses no language-specific rule or threshold.

It does **not** establish global superiority over Mem0. The control excludes Mem0's `infer: true` LLM update path, does not score an equivalent lifecycle/history API, and contains only ten synthetic mechanism cases. Graphiti and Letta were not executable in this environment because their required services were absent. The next publication gate is a frozen corpus of at least 100 multilingual correction/entity-confusion cases, plus full-engine Mem0 and Graphiti runs with provider receipts and latency/cost accounting. Until then, the defensible measured result is narrower: **on this fixture, Naia's local-first multilingual stack preserves correction lifecycle state without exposing a forbidden fact in top five**. This is not yet a product-wide or SOTA claim.

Receipts: `structured-supersession-contract-v2.json`, `structured-supersession-contract-v2-multilingual-e5-small.json`, `structured-supersession-contract-v2-mem0-oss-raw-control.json`, and `structured-supersession-contract-v2-mem0-oss-raw-control-multilingual-e5-small.json`.

## History-chain expansion experiment

The earlier 10.0% history-coverage result exposed an implementation gap rather than a storage-loss problem: `mode: "history"` admitted superseded rows into semantic ranking but did not traverse the predecessor/successor links that the write path already persisted. A history-only expansion now follows those links from each ranked, project-scoped anchor. Latest-mode ranking, lifecycle filtering, and strict project isolation are unchanged.

The initial experiment raised explicit-structure history coverage@5 from 10.0% to 60.0% on both MiniLM and E5-small, while normal retrieval stayed at hit@1 40.0%, hit@5 70.0%, MRR 0.525, forbidden@1/5 0.0%/0.0%, and lifecycle 100.0%. After the safety correction below, the regenerated receipts return explicit-structure history coverage@5 to 10.0%; the normal retrieval and lifecycle metrics remain unchanged. Test and typecheck results are local validation evidence, not part of the benchmark receipt.

Adversarial review rejected that promotion policy as a product change: complete early chains could evict higher-ranked independent anchors and unranked predecessors inherited fabricated relevance scores. The implementation now preserves ranked anchors and appends linked rows only into spare capacity with an explicit zero score. A separately paginated history API is the appropriate next step for complete chains; the larger multilingual frozen corpus remains the publication gate.

The regenerated receipts now identify embedding and reranker dtypes separately and hash the ranking dependencies (`decay.ts`, `knowledge-graph.ts`, `ko-normalize.ts`, and `reranker.ts`). The benchmark clock also freezes internal `Date.now()` for deterministic lifecycle data while preserving the real artifact generation timestamp in the receipt.

Only the regenerated MiniLM and E5-small receipts named in the comparison section are current publication evidence. The base, large, BGE, top-20, broad-candidate, no-MMR, and vector-only artifacts are retained as exploratory history; several predate the strengthened implementation-hash, model-revision, fixed-clock, and resource-evidence schema. Their quality observations may guide experiments, but their runtime/RSS and repeated-run statements are not receipt-backed claims.
