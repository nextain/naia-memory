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

`shard-014` completed five new checkpoints covering 2,467 turns and 67,635,246
aggregate store bytes. Semantic reindexing took 542,989.3 ms, recall took 384.4
ms, and total receipt time was 543,868.0 ms. The receipt-recorded process peak
RSS was 2,705,334,272 bytes; the independent `/usr/bin/time` maximum was
2,752,596 KiB. Its validated receipt SHA-256 is:

`f3d846a467c23b003c9163d585146fefe5d17e16b4bc484450255a8ae2763c11`

The independent aggregate and blind-label checks passed, and a repeated
manifest command reused the receipt in 1.64 seconds without new computation.
The first fifteen shards now cover 75 of 500 cases (15%), 37,647 turns, and
1,031,625,251 aggregate store bytes.

`shard-015` completed five new checkpoints covering 2,454 turns and 67,302,501
aggregate store bytes. Semantic reindexing took 552,336.9 ms, recall took 376.4
ms, and total receipt time was 553,290.5 ms. The receipt-recorded process peak
RSS was 2,697,789,440 bytes; the independent `/usr/bin/time` maximum was
2,756,836 KiB. Its validated receipt SHA-256 is:

`19d5bf2cee6b49020d2a3e2a2be32a2de26f8c4bf94ef958c500856b9f667d3c`

The independent aggregate and blind-label checks passed, and a repeated
manifest command reused the receipt in 1.68 seconds without new computation.
The first sixteen shards now cover 80 of 500 cases (16%), 40,101 turns, and
1,098,927,752 aggregate store bytes.

`shard-016` completed five new checkpoints covering 2,428 turns and 66,640,492
aggregate store bytes. Semantic reindexing took 543,054.3 ms, recall took 335.5
ms, and total receipt time was 544,071.1 ms. The receipt-recorded process peak
RSS was 2,722,652,160 bytes; the independent `/usr/bin/time` maximum was
2,773,988 KiB. Its validated receipt SHA-256 is:

`b5966815c047f29a3bdc292af8cf10bbb4ca581d8de432b40d00b68cc1e0865a`

The independent aggregate and blind-label checks passed, and a repeated
manifest command reused the receipt in 1.63 seconds without new computation.
The first seventeen shards now cover 85 of 500 cases (17%), 42,529 turns, and
1,165,568,244 aggregate store bytes.

`shard-017` completed five new checkpoints covering 2,348 turns and 64,517,814
aggregate store bytes. Semantic reindexing took 536,499.6 ms, recall took 448.0
ms, and total receipt time was 537,490.0 ms. The receipt-recorded process peak
RSS was 2,730,184,704 bytes; the independent `/usr/bin/time` maximum was
2,703,896 KiB. Its validated receipt SHA-256 is:

`1b8726925e7ec39c234482e7b022420992e834d771438f812ed829110bbadd9e`

The independent aggregate and blind-label checks passed, and a repeated
manifest command reused the receipt in 1.63 seconds without new computation.
The first eighteen shards now cover 90 of 500 cases (18%), 44,877 turns, and
1,230,086,058 aggregate store bytes.

`shard-018` completed five new checkpoints covering 2,448 turns and 67,162,001
aggregate store bytes. Semantic reindexing took 556,383.4 ms, recall took 381.6
ms, and total receipt time was 557,506.6 ms. The receipt-recorded process peak
RSS was 2,802,319,360 bytes; the independent `/usr/bin/time` maximum was
2,838,400 KiB. Its validated receipt SHA-256 is:

`bee4fb5f55ace072b78199aa3721dae5dc52ae5b098d27adb50d6cb0666f9599`

The independent aggregate and blind-label checks passed, and a repeated
manifest command reused the receipt in 1.67 seconds without new computation.
The first nineteen shards now cover 95 of 500 cases (19%), 47,325 turns, and
1,297,248,059 aggregate store bytes.

`shard-019` completed five new checkpoints covering 2,498 turns and 68,472,786
aggregate store bytes. Semantic reindexing took 536,621.6 ms, recall took 355.7
ms, and total receipt time was 537,626.2 ms. The receipt-recorded process peak
RSS was 2,508,029,952 bytes; the independent `/usr/bin/time` maximum was
2,480,124 KiB. Its validated receipt SHA-256 is:

`9fb3dc3ea1852ee472332e3afd6e908018317cbd22e0d2ce8aca162379c95416`

The independent aggregate and blind-label checks passed, and a repeated
manifest command reused the receipt in 1.68 seconds without new computation.
The first twenty shards now cover 100 of 500 cases (20%), 49,823 turns, and
1,365,720,845 aggregate store bytes.

`shard-020` completed five new checkpoints covering 2,433 turns and 66,719,991
aggregate store bytes. Semantic reindexing took 531,658.4 ms, recall took 361.3
ms, and total receipt time was 532,677.9 ms. The receipt-recorded process peak
RSS was 2,954,280,960 bytes; the independent `/usr/bin/time` maximum was
2,969,740 KiB, with zero swap activity. Its validated receipt SHA-256 is:

`869fb024d4cdf463a56e527b3f9b468143f7816f590fb73eebbf45d38d7d9893`

The independent blind-label, input and policy hash, question-ID, ordinal, turn,
and store-byte aggregate checks passed. A repeated manifest command reused the
receipt in 1.63 seconds without new computation and left its SHA-256 unchanged.
The first twenty-one shards now cover 105 of 500 cases (21%), 52,256 turns, and
1,432,440,836 aggregate store bytes.

`shard-021` completed five new checkpoints covering 2,366 turns and 64,964,122
aggregate store bytes. Semantic reindexing took 549,318.8 ms, recall took 403.7
ms, and total receipt time was 550,381.1 ms. The receipt-recorded process peak
RSS was 2,510,389,248 bytes; the independent `/usr/bin/time` maximum was
2,546,744 KiB, with zero swap activity. Its validated receipt SHA-256 is:

`d20324d55019b065c87753fa8c85fd96aa0798ebfda29d2486ee8cbba20f9ce4`

The independent blind-label, input and policy hash, question-ID, ordinal, turn,
and store-byte aggregate checks passed. A repeated manifest command reused the
receipt in 1.63 seconds without new computation and left its SHA-256 unchanged.
The first twenty-two shards now cover 110 of 500 cases (22%), 54,622 turns, and
1,497,404,958 aggregate store bytes.

`shard-022` completed five new checkpoints covering 2,406 turns and 66,049,816
aggregate store bytes. Semantic reindexing took 583,444.8 ms, recall took 374.2
ms, and total receipt time was 584,478.3 ms. The receipt-recorded process peak
RSS was 2,854,154,240 bytes; the independent `/usr/bin/time` maximum was
2,829,928 KiB, with zero swap activity. Its validated receipt SHA-256 is:

`91a80a919422e531abb0b30a60d37418e76498a4bf3c3981c7ddc742568376e0`

The independent blind-label, input and policy hash, question-ID, ordinal, turn,
actual store-file byte, and aggregate checks passed. A repeated manifest command
reused the receipt in 1.60 seconds without new computation and left its SHA-256
unchanged. The first twenty-three shards now cover 115 of 500 cases (23%),
57,028 turns, and 1,563,454,774 aggregate store bytes.

`shard-023` completed five new checkpoints covering 2,422 turns and 66,484,177
aggregate store bytes. Semantic reindexing took 575,070.7 ms, recall took 365.0
ms, and total receipt time was 576,335.5 ms. The receipt-recorded process peak
RSS was 2,492,493,824 bytes; the independent `/usr/bin/time` maximum was
2,540,772 KiB, with zero swap activity. Its validated receipt SHA-256 is:

`9c3a419ddfca1dbecefa10e9c89476c36e15c62f1de28f51c2d38e5c033d3809`

The independent blind-label, input and policy hash, question-ID, ordinal, turn,
actual store-file byte, and aggregate checks passed. A repeated manifest command
reused the receipt in 1.62 seconds without new computation and left its SHA-256
unchanged. The first twenty-four shards now cover 120 of 500 cases (24%),
59,450 turns, and 1,629,938,951 aggregate store bytes.

`shard-024` completed five new checkpoints covering 2,525 turns and 69,229,472
aggregate store bytes. Semantic reindexing took 590,283.8 ms, recall took 375.9
ms, and total receipt time was 591,304.5 ms. The receipt-recorded process peak
RSS was 2,723,758,080 bytes; the independent `/usr/bin/time` maximum was
2,775,960 KiB, with zero swap activity. Its validated receipt SHA-256 is:

`5fe556c097c9757e0d915267c76f1c69ca887f5ce0e36ae817d502516bb23b00`

The independent blind-label, input and policy hash, question-ID, ordinal, turn,
actual store-file byte, and aggregate checks passed. A repeated manifest command
reused the receipt in 1.66 seconds without new computation and left its SHA-256
unchanged. The first twenty-five shards now cover 125 of 500 cases (25%),
61,975 turns, and 1,699,168,423 aggregate store bytes.

`shard-025` completed five new checkpoints covering 2,497 turns and 68,444,795
aggregate store bytes. Semantic reindexing took 545,513.8 ms, recall took 385.9
ms, and total receipt time was 546,468.8 ms. The receipt-recorded process peak
RSS was 2,490,257,408 bytes; the independent `/usr/bin/time` maximum was
2,519,796 KiB, with zero swap activity. Its validated receipt SHA-256 is:

`964a1c9090bb982b811bc17c019a3ea982f34645ef0f46b0e553bd1dc06da477`

The independent blind-label, input and policy hash, question-ID, ordinal, turn,
actual store-file byte, and aggregate checks passed. A repeated manifest command
reused the receipt in 1.64 seconds without new computation and left its SHA-256
unchanged. The first twenty-six shards now cover 130 of 500 cases (26%),
64,472 turns, and 1,767,613,218 aggregate store bytes.

`shard-026` completed five new checkpoints covering 2,459 turns and 67,444,257
aggregate store bytes. Semantic reindexing took 524,388.4 ms, recall took 408.8
ms, and total receipt time was 525,444.9 ms. The receipt-recorded process peak
RSS was 2,708,480,000 bytes; the independent `/usr/bin/time` maximum was
2,747,096 KiB, with zero swap activity. Its validated receipt SHA-256 is:

`d0c1b890be14bc0313f8de41eaca14e51e2d3530f237b3b08b7d3f3d40ba0398`

The independent blind-label, input and policy hash, question-ID, ordinal, turn,
actual store-file byte, and aggregate checks passed. A repeated manifest command
reused the receipt in 1.68 seconds without new computation and left its SHA-256
unchanged. The first twenty-seven shards now cover 135 of 500 cases (27%),
66,931 turns, and 1,835,057,475 aggregate store bytes.

`shard-027` completed five new checkpoints covering 2,535 turns and 69,458,743
aggregate store bytes. Semantic reindexing took 539,988.6 ms, recall took 369.6
ms, and total receipt time was 541,280.7 ms. The receipt-recorded process peak
RSS was 2,958,938,112 bytes; the independent `/usr/bin/time` maximum was
2,938,508 KiB, with zero swap activity. Its validated receipt SHA-256 is:

`c19a33532f73c067cd5c6ac668acf189ad9a7068eeb33d5ca0391a1515cc9064`

The independent blind-label, input and policy hash, question-ID, ordinal, turn,
actual store-file byte, and aggregate checks passed. A repeated manifest command
reused the receipt in 1.64 seconds without new computation and left its SHA-256
unchanged. The first twenty-eight shards now cover 140 of 500 cases (28%),
69,466 turns, and 1,904,516,218 aggregate store bytes.

## Claim boundary and next gate

This establishes campaign partition integrity, bounded scheduling metadata, and
deterministic fail-closed aggregation. It does not establish retrieval quality,
answer accuracy, superiority over the keyword-fallback control, or global SOTA.

The next quality gate is to execute the remaining 72 semantic shards and the
matched keyword-fallback control, then answer and judge all 500 cases under the
sealed protocol. A support claim requires higher overall judged accuracy
without lower abstention accuracy and valid receipts across the complete
campaign.
