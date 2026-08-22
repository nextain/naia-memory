# HNSW 100k Multilingual Qualification — 2026-08-22

## Verdict

**Public status: NO-GO.** A corrected, geometry-qualified 100,000-vector corpus
produced a viable Korean-only candidate (`m=64`, `ef_construct=400`,
`hnsw_ef=512`), but no shared Korean/English configuration passed the frozen
quality contract. This is useful engineering evidence, not a global
competitiveness claim.

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

At `m64/efC400/ef512`, Korean overlap@10 was 0.9951–1.0000 and top-1
agreement was 0.9903–0.9951. English at the same setting reached only
0.9670–0.9845 overlap and 0.9466–0.9709 top-1 agreement. Raising English to
ef2048 improved it, but two of three builds still missed the 0.99 top-1 floor
at 0.9854.

The exact baseline also exposes language asymmetry. Generated distractors
entered exact top-10 for 8.74% of Korean queries versus 23.79% of English
queries; mean generated results at top-10 were 0.189 versus 1.092. This does
not excuse ANN failures: it identifies a separate translated-corpus/embedding
neighborhood problem that must be fixed rather than hidden by a relative gate.

## Adversarial interpretation

The strongest falsification succeeded: the original poor 100k result was not
solely a pathological generator, and increasing graph construction quality did
not produce a robust multilingual setting. The earlier 10k selected-ef result
also changed from 256 to 512 on rerun, so three builds remain a qualification
minimum rather than publication-grade confidence.

An earlier adversarial pass, whose transcript is not stored in this repository,
raised concerns that the 10k parameter change was confounded, scale was below
the target, build repetition was insufficient, and English baseline quality was
weak. This 100k campaign removes the scale confound but confirms the English
and build-stability objections. A fresh headless review cross-checked the report
against all three JSON artifacts and returned PASS after requiring this
provenance wording. Recovery mode prevents a formal `review-pass CLEAN` claim.

## What the evidence supports

Naia Memory can preserve exact-search quality for Korean at 100k with a
high-quality HNSW graph. It does **not** yet support “best global engine,”
“multilingual production-qualified,” or cross-engine superiority claims.
ANN-Benchmarks emphasizes recall/query-time/build-time/index-size trade-offs,
while BEIR emphasizes heterogeneous retrieval datasets; this campaign covers
only within-engine exact-vs-ANN preservation, not either complete protocol.

Primary references: [BEIR](https://arxiv.org/abs/2104.08663),
[ANN-Benchmarks methodology](https://github.com/erikbern/ann-benchmarks/blob/main/README.md),
and [ANN-Benchmarks datasets](https://github.com/erikbern/ann-benchmarks/blob/main/ann_benchmarks/datasets.py).

## Required next work

1. Diagnose English nearest-neighbor failures by query family and generated
   template, then replace translated synthetic text with independently authored
   English and at least one third-language set.
2. Freeze the revised multilingual corpus before labels, rerun 100k, and use
   at least five independent builds for any release candidate.
3. Measure build time, index size/RSS, and QPS/latency alongside quality; the
   m64 candidate has a material memory and construction-cost trade-off.
4. Run sealed external-engine adapters under equivalent memory-update semantics
   before making a competitive claim.

## Machine-readable evidence

- `hnsw-exact-scale-gate-100000-m32-efc200-2026-08-22.json`
- `hnsw-exact-scale-gate-100000-m32-efc200-ef2048-2026-08-22.json`
- `hnsw-exact-scale-gate-100000-m64-efc400-ef2048-2026-08-22.json`
