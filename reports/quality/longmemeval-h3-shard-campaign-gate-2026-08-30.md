# LongMemEval H3 shard campaign gate

Date: 2026-08-30
Scope: full-campaign integrity and reproducibility; not answer-quality evidence

## Result

The preregistered LongMemEval H3 semantic campaign now has a deterministic,
bounded execution manifest for all 500 official blind cases. It partitions the
fixed question order into 100 contiguous shards of five cases and limits the
recommended process parallelism to one, based on the approximately 2.7 GB peak
RSS observed in the two-case interruption test.

Generating the manifest twice from the same corpus and policy receipt produced
byte-identical files. The manifest SHA-256 is:

`ba58cb497a8d6ac46caa789d67fd0998314ed7290665bdd53600decb0821d4fa`

## Bound identities

- Input file SHA-256:
  `34e175af201b4b0409af2ec482c4f82b5bcc9b830f46c2be969980c272a239f8`
- Blind content SHA-256:
  `bd6a6b017bd59479baecbee4047197511b2051551e0b0966755f8d0e06624f63`
- Global question-order SHA-256:
  `a4849b8afda6b6ed31ead4fc28d00784d2d5fef945be87642f5ce3ab710b21c4`
- H3 semantic policy SHA-256:
  `2a05f7d86939b039f7fe6be2d950e6485753e67df734dff43fe5f0acac5b8ff5`
- First shard question-ID SHA-256:
  `89fb9a0769fc6ddcaa9fb4f6a3c3b47cc9cc004b86e1252e290e8cb3a2c9ad32`
- Last shard question-ID SHA-256:
  `24ad05fea27d3eef4762169dab7a3ac9e834977e3069311f59fb0ecd3387cf31`

## Fail-closed merge gate

Every shard receipt must match the manifest's input identities, policy identity,
absolute case range, ordered question IDs, completion counts, and aggregate turn
and store-byte totals. Case receipts reuse the checkpoint validator for numeric
ranges and retrieval hashes. The merge rejects missing shards, gaps, overlaps,
order changes, substituted question IDs, policy drift, input drift, duplicate
question IDs, malformed hashes, and invalid resource summaries. The merged
receipt is written through a temporary file and atomic rename.

Manifest creation also rejects duplicate corpus question IDs and configurations
whose declared parallelism exceeds the shard count. The CLI accepts both direct
pnpm arguments and the conventional `--` separator.

## Verification

- Full suite: 183 test files passed; 1,494 tests passed and 1 skipped.
- TypeScript production and benchmark typechecks passed.
- Formatting and diff checks passed.
- Official 500-case manifest generation passed twice with byte equality.
- Unit tests exercise deterministic 500-case partitioning, corpus order drift,
  receipt policy/question drift, complete ordered merge, and incomplete-set
  rejection.

## First production shard

`shard-000` completed all five cases and passed the manifest receipt validator.
It covers 2,690 turns, 73,544,644 aggregate store bytes, 636,630.2 ms semantic
reindex time, and 376.3 ms recall time. Its receipt SHA-256 is:

`09d4420bd92f46c58fa101e7e14a2ef81cf3487bf34b0f175bc1905f22a8ae63`

The first run reused the two earlier checkpoints and created three new atomic
checkpoints. It exposed a CLI defect after computation: a previously absent
receipt parent directory was not created before atomic output. No completed
case was lost. After adding parent-directory creation, the retry validated and
reused all five checkpoints, executed zero new cases, and wrote the complete
receipt in 2.41 seconds wall time. Peak RSS for the original five-case process
was 2,321,868 KiB, remaining within the single-process scheduling assumption.

## Manifest-driven shard execution

The campaign CLI now runs a shard only after validating the exact input file
bytes, blind-content identity, global question order, per-shard question IDs,
and declared shard ID against the sealed manifest. Offsets, counts, and receipt
filenames come from the manifest rather than operator-supplied values. An
existing receipt is validated before reuse; a malformed or mismatched receipt
fails closed instead of being overwritten. A newly produced receipt is also
validated before the command reports completion.

`shard-001` was the first production execution through this manifest-driven
path. It completed five new atomic case checkpoints covering 2,487 turns and
68,186,725 aggregate store bytes. Semantic reindexing took 667,747.0 ms, recall
took 389.6 ms, and total receipt time was 668,753.4 ms. Peak RSS within the
process was 2,862,804,992 bytes. The validated receipt SHA-256 is:

`aa25d8a851d0d996a108580ff5f91556a666248cb1ffdb1473285516e21ceeca`

Re-running the same manifest command validated and reused that receipt in 1.76
seconds without launching another semantic pilot. Together, `shard-000` and
`shard-001` provide validated semantic receipts for 10 of 500 cases (2%) and
5,177 turns. This remains execution-integrity evidence, not a quality score.

`shard-002` then completed through the same sealed path with five new atomic
checkpoints. It covers 2,475 turns and 67,856,294 aggregate store bytes.
Semantic reindexing took 630,051.6 ms, recall took 350.7 ms, and total receipt
time was 630,981.4 ms. The receipt-recorded process peak RSS was 2,501,136,384
bytes; the independent `/usr/bin/time` maximum was 2,523,376 KiB. Its validated
receipt SHA-256 is:

`da37884a8103ff92866c4c1614da97018135fdbe78048168b5c6166ff6f6327d`

An independent aggregate check confirmed that the five case turn counts and
store sizes exactly equal the receipt summary. Re-running the manifest command
validated and reused the receipt in 1.74 seconds. The first three shards now
provide sealed semantic retrieval evidence for 15 of 500 cases (3%), 7,652
turns, and 209,587,663 aggregate store bytes.

`shard-003` completed five additional new checkpoints covering 2,483 turns and
68,038,700 aggregate store bytes. Semantic reindexing took 555,814.2 ms, recall
took 329.0 ms, and total receipt time was 556,681.1 ms. The receipt-recorded
process peak RSS was 2,835,693,568 bytes; the independent `/usr/bin/time`
maximum was 2,826,456 KiB. Its validated receipt SHA-256 is:

`a3e53f148c52d1138457ce5a42a449996efd2332c2235638c4b0b4ca4a1b78d1`

The independent case-to-summary aggregate check passed, and a repeated command
validated and reused the receipt in 1.69 seconds. The first four shards now
cover 20 of 500 cases (4%), 10,135 turns, and 277,626,363 aggregate store
bytes under the sealed semantic protocol.

`shard-004` completed five new checkpoints covering 2,459 turns and 67,447,823
aggregate store bytes. Semantic reindexing took 576,635.6 ms, recall took 327.7
ms, and total receipt time was 577,508.3 ms. The receipt-recorded process peak
RSS was 2,768,953,344 bytes; the independent `/usr/bin/time` maximum was
2,780,952 KiB. Its validated receipt SHA-256 is:

`3250ff542e2b0b163dc98866dac461938c09f619838a1bf3f5fd610f8c8f70bd`

The independent aggregate check passed and a repeated manifest command reused
the receipt in 1.73 seconds. The first five shards now cover 25 of 500 cases
(5%), 12,594 turns, and 345,074,186 aggregate store bytes.

`shard-005` completed five new checkpoints covering 2,556 turns and 69,991,139
aggregate store bytes. Semantic reindexing took 600,072.7 ms, recall took 352.9
ms, and total receipt time was 601,002.6 ms. The receipt-recorded process peak
RSS was 2,727,866,368 bytes; the independent `/usr/bin/time` maximum was
2,754,428 KiB. Its validated receipt SHA-256 is:

`ea01f913e90690b3a71701ec3de6c2c5914e69a79763f432e3884b200cda4347`

The independent aggregate and blind-label checks passed, and a repeated
manifest command reused the receipt in 1.80 seconds without new computation.
The first six shards now cover 30 of 500 cases (6%), 15,150 turns, and
415,065,325 aggregate store bytes.

`shard-006` completed five new checkpoints covering 2,360 turns and 64,811,512
aggregate store bytes. Semantic reindexing took 568,322.1 ms, recall took 388.7
ms, and total receipt time was 569,291.5 ms. The receipt-recorded process peak
RSS was 2,705,125,376 bytes; the independent `/usr/bin/time` maximum was
2,763,236 KiB. Its validated receipt SHA-256 is:

`1b6703ec77c1b7bd65baf88d85ec5bc69ccd9308e5e8a551fe32e4dcb9811f51`

The independent aggregate and blind-label checks passed, and a repeated
manifest command reused the receipt in 1.71 seconds without new computation.
The first seven shards now cover 35 of 500 cases (7%), 17,510 turns, and
479,876,837 aggregate store bytes.

`shard-007` completed five new checkpoints covering 2,523 turns and 69,172,573
aggregate store bytes. Semantic reindexing took 587,595.9 ms, recall took 361.4
ms, and total receipt time was 588,635.9 ms. The receipt-recorded process peak
RSS was 2,730,672,128 bytes; the independent `/usr/bin/time` maximum was
2,766,968 KiB. Its validated receipt SHA-256 is:

`a0dcd764b597b8f71a1bd0b8395936cfa83e9294a091589de6719b31f6dce7f1`

The independent aggregate and blind-label checks passed, and a repeated
manifest command reused the receipt in 1.67 seconds without new computation.
The first eight shards now cover 40 of 500 cases (8%), 20,033 turns, and
549,049,410 aggregate store bytes.

## Claim boundary and next gate

This establishes campaign partition integrity, bounded scheduling metadata, and
deterministic fail-closed aggregation. It does not establish retrieval quality,
answer accuracy, superiority over the keyword-fallback control, or global SOTA.

The next quality gate is to execute the remaining 92 semantic shards and the
matched keyword-fallback control, then answer and judge all 500 cases under the
sealed protocol. A support claim requires higher overall judged accuracy
without lower abstention accuracy and valid receipts across the complete
campaign.
