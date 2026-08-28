# MIRACL-en length-bucket batch decision record — 2026-08-28

> Evidence status: retrospective development record, not a preregistration or
> reproducible qualification artifact. The legacy filename is retained to avoid
> breaking existing references.

## Question

Does stable length bucketing remove enough padding from the existing CPU tensor
batch path to beat `per-item-v1` without weakening the locked retrieval result or
the long-document vector agreement observed by the 2026-08-25 preflight?

## Recorded treatment

- control: `per-item-v1`
- treatment: `length-bucketed-array-batch-v1`
- window: the existing 512-passage MIRACL-en execution chunk
- ordering inside each window: ascending UTF-8 byte length, then original row
- tensor batch width: 8 rows
- restoration: vectors are returned in original input order
- model, revision, dtype, prefixes, pooling, normalization, truncation, sample,
  queries, qrels, corpus ordering, and CPU-only environment remain unchanged

The width of 8 came from the earlier English preflight treatment. This record
does not independently prove that the remaining treatment details were frozen
before execution. The intended independent variable was whether rows with
similar observed input lengths shared the same padded tensor batch.

## Retrospectively recorded promotion gate

The numeric thresholds and early-stop rule below were committed together with
the observations. They are useful as a conservative decision rule, but cannot
be represented as preregistered or used as confirmatory qualification evidence.

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

## Recorded v2 after the v1 pilot

The first 512-row development-window pilot produced 4.3490x control throughput
but minimum cosine 0.927233, so v1 failed condition 4 and is not promotable. The
next treatment was recorded as `length-bucketed-hybrid-v1`: inputs at
or above 4,096 UTF-8 bytes use per-item inference, while shorter inputs retain
the v1 stable length buckets. The 4,096 boundary was defined by the existing
longest MIRACL-en sampling stratum and its 2026-08-25 degradation finding; it was
not selected by searching this pilot's rows. All gates above remain unchanged.

## Development-window observations

These observations cover the first 512 rows only. No raw measurement receipt,
hashed evidence JSON, or executable candidate implementation is retained in the
repository, so the numbers cannot be independently reproduced from this commit.
They are retrospective development notes, not qualification evidence.

| treatment | control docs/s | treatment docs/s | ratio | minimum cosine | longest-stratum minimum |
|---|---:|---:|---:|---:|---:|
| `length-bucketed-array-batch-v1` | 1.4397 | 6.2614 | 4.3490 | 0.927233 | not isolated |
| `length-bucketed-hybrid-v1` | 7.7993 | 6.5286 | 0.8371 | 0.927233 | 1.000000 |

The first row included cold model initialization in the control timing and is
therefore unsuitable for a throughput claim. The second run reused the model
cache and showed that the hybrid treatment was slower than the warmed control.
Under the recorded decision rule, both treatments independently failed the
minimum-cosine threshold. The full 7,168-row qualification run was not pursued;
no product default or public qualification flag is changed. Because the rule
was not independently timestamped before execution, this is a safe rejection,
not a confirmatory benchmark result.

## Disposition

Neither experimental mode is present in the product API, and this report's
commit contains no candidate runtime code to merge. `per-item-v1` remains the
constructor default and all current product wiring remains unchanged. Any
future CPU or GPU attempt requires a new, independently committed,
order-balanced and warmed preregistration plus machine-readable receipts. These
development observations cannot authorize a product or public performance
claim.
