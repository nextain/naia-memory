# MIRACL-en length-bucket batch preregistration — 2026-08-28

## Question

Does stable length bucketing remove enough padding from the existing CPU tensor
batch path to beat `per-item-v1` without weakening the locked retrieval result or
the long-document vector agreement observed by the 2026-08-25 preflight?

## Frozen treatment

- control: `per-item-v1`
- treatment: `length-bucketed-array-batch-v1`
- window: the existing 512-passage MIRACL-en execution chunk
- ordering inside each window: ascending UTF-8 byte length, then original row
- tensor batch width: 8 rows
- restoration: vectors are returned in original input order
- model, revision, dtype, prefixes, pooling, normalization, truncation, sample,
  queries, qrels, corpus ordering, and CPU-only environment remain unchanged

The width of 8 is the already preregistered treatment width. It is not selected
from this experiment's results. The only independent variable is whether rows
with similar observed input lengths share the same padded tensor batch.

## Promotion gate

The treatment is eligible for product wiring only if all conditions hold on the
locked 7,168-passage stratified sample and 64-query retrieval corpus:

1. treatment throughput is greater than `per-item-v1` throughput;
2. nDCG@10 is no lower than control by more than 0.005 absolute;
3. top-10 Jaccard is at least 0.95;
4. minimum per-row cosine is at least 0.95 overall and in the longest stratum;
5. ordered repeat output is bit-identical;
6. shuffled input restored to canonical order has minimum cosine at least 0.95;
7. all vectors are finite and have the frozen 1,024 dimensions.

A failed condition keeps the existing default and public qualification state
unchanged. This experiment cannot establish full-corpus English performance,
multilingual transfer, product latency, ANN quality, or public SOTA eligibility.

## Frozen v2 after the v1 pilot

The first 512-row development-window pilot produced 4.3490x control throughput
but minimum cosine 0.927233, so v1 failed condition 4 and is not promotable. The
next treatment is separately frozen as `length-bucketed-hybrid-v1`: inputs at
or above 4,096 UTF-8 bytes use per-item inference, while shorter inputs retain
the v1 stable length buckets. The 4,096 boundary was defined by the existing
longest MIRACL-en sampling stratum and its 2026-08-25 degradation finding; it was
not selected by searching this pilot's rows. All gates above remain unchanged.

## Development-window observations

These observations cover the first 512 rows only. They are an early-stop gate,
not qualification evidence.

| treatment | control docs/s | treatment docs/s | ratio | minimum cosine | longest-stratum minimum |
|---|---:|---:|---:|---:|---:|
| `length-bucketed-array-batch-v1` | 1.4397 | 6.2614 | 4.3490 | 0.927233 | not isolated |
| `length-bucketed-hybrid-v1` | 7.7993 | 6.5286 | 0.8371 | 0.927233 | 1.000000 |

The first row included cold model initialization in the control timing and is
therefore unsuitable for a throughput claim. The second run reused the model
cache and showed that the hybrid treatment was slower than the warmed control.
Both treatments independently failed the frozen minimum-cosine gate. The full
7,168-row qualification run was stopped according to the early-stop rule; no
product default or public qualification flag is changed.

## Disposition

Neither experimental mode is retained in the product API. The tested
implementations were removed after the early-stop gate because shipping a mode
that fails the frozen quality or throughput conditions would add unsupported
runtime behavior. `per-item-v1` remains the constructor default and all current
product wiring remains unchanged. Any future CPU or GPU attempt requires a new
order-balanced, warmed preregistration and the same quality gates; these
development observations cannot authorize it.
