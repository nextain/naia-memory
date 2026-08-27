# Retrieval improvement decision — 2026-08-14

## Decision

Do not change the default RRF, deploy a Korean-only rank rule, or enable an
ANN index yet.  The next production candidate is conflict-aware retrieval over
the existing append-only structured-fact chain: a fact that has been
conservatively superseded is excluded from `latest` recall, while its raw
source and history remain available.

This is language-neutral.  It relies only on explicit structured metadata
(`subject`, `property`, `value`, `polarity`, `cardinality`), never Korean token
rules, translation, or a per-language score threshold.

## Evidence at the decision point

The reproducible Korean diagnostic is intentionally small (16 reviewed queries,
11 categories, 200 facts plus 110 hard negatives).  On CPU with
`paraphrase-multilingual-MiniLM-L12-v2`:

| Search mode | hit@1 | hit@5 | MRR | forbidden@1 | forbidden@5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| default RRF | 6.3% | 56.3% | .226 | 25.0% | 43.8% |
| vector-only | 25.0% | 50.0% | .365 | 18.8% | 56.3% |

Receipts: `korean-retrieval-contract-v1-rrf.json` and
`korean-retrieval-contract-v1-vector-only.json` in this directory.

The attempted RRF correction that removes zero-score BM25 candidates improved
relevance but made forbidden exposure worse (forbidden@1 31.3%, forbidden@5
50.0%).  It remains rejected.  The observed RRF pathology is real—zero-score
documents still receive a rank contribution—but changing that alone does not
meet the safety objective.

The 100k SQLite deterministic latency report already records deep p95 43.8ms.
That is an index-path result, not semantic-quality evidence; it does not justify
an ANN or GPU claim.

## Why this candidate

The present failure is often a pair of semantically similar but incompatible
facts.  A bi-encoder ranker cannot reliably infer which assertion is current or
safe from query text alone.  #39 already represents a narrow, auditable case:
only affirmed, single-valued claims with the same explicit subject and property
may form a supersession chain.  Negated, multi-valued, malformed, and
unstructured claims stay append-only.

This removes only facts already known to be obsolete; it does not attempt a
natural-language truth or answer policy in `naia-memory`.

## Acceptance gate

1. Build a *held-out* multilingual fact/query set.  It must contain Korean,
   English, and Japanese source facts, paraphrase queries, entity confusions,
   and known incompatible facts.  The fact IDs, labels, split manifest, model,
   revision, hardware, and generated timestamp must be receipted.
2. Run default retrieval before and after structured supersession.  A candidate
   is admissible only if forbidden@1 and forbidden@5 both do not increase and
   at least one relevance measure improves on the held-out split.  Report each
   language and aggregate; do not tune language-specific constants.
3. Preserve raw source IDs and prove `history` still returns the chain.  Add
   negative cases for multi-value, negation, differing property, extraction
   uncertainty, and cross-project scope.
4. Re-run the formal review gate.  #39 is currently `NOT_CLEAN / REVIEW_ONLY`;
   no release, default flip, or performance claim is permitted until it is
   clean.

## Deferred options

### Multilingual re-ranking

BGE-M3 supports dense, lexical, and multi-vector retrieval in more than 100
languages; its own documentation recommends cheap dense/sparse candidate
generation followed by expensive multi-vector re-ranking.  The same project
lists `bge-reranker-v2-m3` as a multilingual lightweight cross-encoder.  This
fits Naia's optional caller-injected reranker boundary, but it needs a separate
latency/cost receipt and the held-out corpus above before adoption.

Sources: [BGE-M3 documentation](https://github.com/FlagOpen/FlagEmbedding/blob/master/docs/source/bge/bge_m3.rst),
[FlagEmbedding model list](https://github.com/FlagOpen/FlagEmbedding).

### ANN / quantization

Faiss documents HNSW and IVF as approximate alternatives to exhaustive vector
search, with explicit recall, memory, build-cost, and deletion trade-offs.
HNSW in particular does not support removal in Faiss.  Evaluate this only once
the corpus reaches a scale where the current measured 100k latency no longer
meets the product target; compare exact recall and update/delete behavior on
the same corpus.  GPU1 remains out of scope for this session.

Source: [Faiss index guide](https://github.com/facebookresearch/faiss/wiki/Faiss-indexes).
