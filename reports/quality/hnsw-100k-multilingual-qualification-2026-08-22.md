# HNSW 100k Multilingual Qualification — 2026-08-22

## Verdict

**Public status: NO-GO.** A corrected, geometry-qualified 100,000-vector corpus
now has a shared Korean/translated-English candidate (`m=128`,
`ef_construct=800`, `hnsw_ef=2048`) that passed six of six independent
language/build gates. This moves the within-engine ANN ceiling materially, but
the high-cost configuration and translated synthetic English set do not prove
global competitiveness or native multilingual quality.

## Contract and corpus

- Exact Qdrant search is the oracle; approximate HNSW must achieve overlap@10
  >= 0.98, top-1 agreement >= 0.99, and recall@10 loss <= 0.01 in every build.
- 100,000 vectors per language, 206 positive source queries, three independent
  index builds, and three repeated searches per query.
- The deterministic generator uses 32 domains, 32 regions, 16 units, 32
  sentence families, and independent seeded axis mixing. An earlier
  mixed-radix bug made the 10k qualification exercise only one template; it was
  fixed before this 100k campaign.
- Geometry passed in both languages. Generated-vs-base cosine deltas were
  `(-0.0107, -0.0035, +0.0151)` for Korean and
  `(+0.0136, +0.0102, +0.0216)` for English at p50/p95/p99, below the
  provisional +0.03 density-inflation guard.

## Results

| Configuration | Korean | English | Verdict |
|---|---:|---:|---|
| m32 / efC200 / ef512 | 0/3 builds | 0/3 builds | reject |
| m32 / efC200 / ef2048 | 3/3 builds | 0/3 builds | reject |
| m64 / efC400 / ef512 | 3/3 builds | 0/3 builds | Korean candidate only |
| m64 / efC400 / ef2048 | 3/3 builds | 1/3 builds | reject |
| m96 / efC600 / ef2048 | 1/1 build | 0/1 build | reject |
| m128 / efC800 / ef2048 | 3/3 builds | 3/3 builds | shared candidate |

At `m64/efC400/ef512`, Korean overlap@10 was 0.9951–1.0000 and top-1
agreement was 0.9903–0.9951. English at the same setting reached only
0.9670–0.9845 overlap and 0.9466–0.9709 top-1 agreement. Raising English to
ef2048 improved it, but two of three builds still missed the 0.99 top-1 floor
at 0.9854.

The stronger `m128/efC800/ef2048` candidate passed three independently rebuilt
indexes per language. Korean overlap@10 was 1.0000 in every build and top-1
agreement was 0.9903–1.0000. Translated-English overlap was 0.9966–0.9990 and
top-1 agreement was 0.9903–0.9951. Approximate-search p95 was 9.85–10.55 ms for
Korean and 9.10–9.82 ms for translated English on this host. Those latency
numbers are host-local observations, not cross-engine throughput evidence.

The exact baseline also exposes language asymmetry. Generated distractors
entered exact top-10 for 8.74% of Korean queries versus 23.79% of English
queries; mean generated results at top-10 were 0.189 versus 1.092. This does
not excuse ANN failures: it identifies a separate translated-corpus/embedding
neighborhood problem that must be fixed rather than hidden by a relative gate.
The new attribution localizes English intrusion primarily to `temporal`
(65% of queries had a generated item in exact top-10; mean 3.35 generated
items) and `multi_fact_synthesis` (40%; mean 2.73). This points to corpus and
embedding-neighborhood ambiguity, not a missing E5 prefix: the implementation
already applies `query:` to queries and `passage:` to stored facts.

## Adversarial interpretation

The earlier conclusion that no shared setting exists is falsified: a denser
graph and much larger search budget can preserve the exact rankings in this
campaign. It does not follow that this is a good production setting. `m=128`
increases graph storage and construction work, while `hnsw_ef=2048` examines
far more candidates than the earlier configuration. Build time, index size,
RSS, and QPS were not captured, so this is a quality ceiling result rather than
an efficiency result.

The result also remains vulnerable to benchmark overfit. Both languages share
the same source facts and query intent structure, English is translated rather
than independently authored, and generated distractors come from 32 known
template families. Parameter tuning observed the same campaign. Three fresh
builds test HNSW stochasticity, but not corpus independence.

An earlier adversarial pass, whose transcript is not stored in this repository,
raised concerns that the 10k parameter change was confounded, scale was below
the target, build repetition was insufficient, and English baseline quality was
weak. This 100k campaign removes the scale confound and finds a reproducible
quality-preserving candidate, but confirms the English-corpus objection.
Recovery mode prevents a formal `review-pass CLEAN` claim.

## What the evidence supports

Naia Memory can preserve exact-search quality for Korean and this translated
English set at 100k with a high-quality HNSW graph. It does **not** yet support
“best global engine,”
“multilingual production-qualified,” or cross-engine superiority claims.
ANN-Benchmarks emphasizes recall/query-time/build-time/index-size trade-offs,
while BEIR emphasizes heterogeneous retrieval datasets; this campaign covers
only within-engine exact-vs-ANN preservation, not either complete protocol.

BEIR warns that retrieval behavior varies across heterogeneous domains, MTEB
reports that no single embedding method dominates all tasks, and multilingual
benchmarks require native-language breadth beyond translated pairs. The next
publication gate therefore needs independently authored held-out languages and
same-input competitor receipts.

Primary references: [BEIR](https://arxiv.org/abs/2104.08663),
[MTEB](https://arxiv.org/abs/2210.07316),
[MMTEB](https://arxiv.org/abs/2502.13595),
[MIRACL](https://arxiv.org/abs/2210.09984), and
[ANN-Benchmarks methodology](https://github.com/erikbern/ann-benchmarks/blob/main/README.md).

## Required next work

1. Replace translated synthetic text with independently authored English and at
   least one typologically distinct third-language set; freeze it before tuning.
2. Rerun 100k with at least five independent builds and a sealed parameter
   selection/validation split.
3. Measure build time, index size/RSS, and QPS/latency alongside quality; the
   m128 candidate has a material memory and construction-cost trade-off.
4. Run sealed external-engine adapters under equivalent memory-update semantics
   before making a competitive claim.

## Machine-readable evidence

- `hnsw-exact-scale-gate-100000-m32-efc200-2026-08-22.json`
- `hnsw-exact-scale-gate-100000-m32-efc200-ef2048-2026-08-22.json`
- `hnsw-exact-scale-gate-100000-m64-efc400-ef2048-2026-08-22.json`
- `hnsw-exact-scale-gate-100000-m64-efc400-ef512-2026-08-22.json`
- `hnsw-exact-scale-gate-100000-m96-efc600-ef2048-2026-08-22.json`
- `hnsw-exact-scale-gate-100000-m128-efc800-ef2048-2026-08-22.json`
