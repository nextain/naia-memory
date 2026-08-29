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

`shard-008` completed five new checkpoints covering 2,519 turns and 69,010,802
aggregate store bytes. Semantic reindexing took 557,290.9 ms, recall took 352.4
ms, and total receipt time was 558,337.9 ms. The receipt-recorded process peak
RSS was 2,866,708,480 bytes; the independent `/usr/bin/time` maximum was
2,896,892 KiB. Its validated receipt SHA-256 is:

`b53ad3fcfc31699d2dd0d39151f85ca86c82394e94249ec428386aa7c9b3d04b`

The independent aggregate and blind-label checks passed, and a repeated
manifest command reused the receipt in 1.64 seconds without new computation.
The first nine shards now cover 45 of 500 cases (9%), 22,552 turns, and
618,060,212 aggregate store bytes.

`shard-009` completed five new checkpoints covering 2,472 turns and 67,748,040
aggregate store bytes. Semantic reindexing took 546,586.3 ms, recall took 389.6
ms, and total receipt time was 547,555.1 ms. The receipt-recorded process peak
RSS was 2,595,250,176 bytes; the independent `/usr/bin/time` maximum was
2,636,176 KiB. Its validated receipt SHA-256 is:

`130a2c53aa27e11fdcbbacd7882456535aa5028c09cfe973071a694f2bc966f9`

The independent aggregate and blind-label checks passed, and a repeated
manifest command reused the receipt in 1.66 seconds without new computation.
The first ten shards now cover 50 of 500 cases (10%), 25,024 turns, and
685,808,252 aggregate store bytes.

`shard-010` completed five new checkpoints covering 2,456 turns and 67,347,322
aggregate store bytes. Semantic reindexing took 531,394.4 ms, recall took 379.8
ms, and total receipt time was 532,392.1 ms. The receipt-recorded process peak
RSS was 2,863,702,016 bytes. The initial runner's independent `/usr/bin/time`
termination line was not retained after its PTY closed, so no independent peak
RSS is claimed for this shard. Its validated receipt SHA-256 is:

`4fe9f723535a03aa8cfa0c418dfc0ffac6a7a9e82200dd417be1ba62d445c385`

The independent aggregate and blind-label checks passed, and a repeated
manifest command reused the receipt in 1.62 seconds without new computation.
The first eleven shards now cover 55 of 500 cases (11%), 27,480 turns, and
753,155,574 aggregate store bytes.

`shard-011` completed five new checkpoints covering 2,571 turns and 70,378,223
aggregate store bytes. Semantic reindexing took 534,409.9 ms, recall took 328.9
ms, and total receipt time was 535,476.3 ms. The receipt-recorded process peak
RSS was 2,724,700,160 bytes; the independent `/usr/bin/time` maximum was
2,731,328 KiB. Its validated receipt SHA-256 is:

`c9a25c862802151948ebafbbd7eafe457fd2ceededf36c93584e70ba83b08f5b`

The independent aggregate and blind-label checks passed, and a repeated
manifest command reused the receipt in 1.66 seconds without new computation.
The first twelve shards now cover 60 of 500 cases (12%), 30,051 turns, and
823,533,797 aggregate store bytes.

`shard-012` completed five new checkpoints covering 2,562 turns and 70,152,109
aggregate store bytes. Semantic reindexing took 560,842.6 ms, recall took 353.7
ms, and total receipt time was 561,740.2 ms. The receipt-recorded process peak
RSS was 2,669,326,336 bytes; the independent `/usr/bin/time` maximum was
2,606,764 KiB. Its validated receipt SHA-256 is:

`92d6a34087d0a04583c347eea6cc82794964007086227a409db006a181bf793a`

The independent aggregate and blind-label checks passed, and a repeated
manifest command reused the receipt in 1.62 seconds without new computation.
The first thirteen shards now cover 65 of 500 cases (13%), 32,613 turns, and
893,685,906 aggregate store bytes.

`shard-013` completed five new checkpoints covering 2,567 turns and 70,304,099
aggregate store bytes. Semantic reindexing took 550,230.5 ms, recall took 316.9
ms, and total receipt time was 551,060.4 ms. The receipt-recorded process peak
RSS was 2,723,995,648 bytes; the independent `/usr/bin/time` maximum was
2,758,764 KiB. Its validated receipt SHA-256 is:

`0d472f23a0a89de7fbf228df3369f83b88cee25643278f2ef20601818227188b`

The independent aggregate and blind-label checks passed, and a repeated
manifest command reused the receipt in 1.64 seconds without new computation.
The first fourteen shards now cover 70 of 500 cases (14%), 35,180 turns, and
963,990,005 aggregate store bytes.

## Claim boundary and next gate

This establishes campaign partition integrity, bounded scheduling metadata, and
deterministic fail-closed aggregation. It does not establish retrieval quality,
answer accuracy, superiority over the keyword-fallback control, or global SOTA.

The next quality gate is to execute the remaining 86 semantic shards and the
matched keyword-fallback control, then answer and judge all 500 cases under the
sealed protocol. A support claim requires higher overall judged accuracy
without lower abstention accuracy and valid receipts across the complete
campaign.
