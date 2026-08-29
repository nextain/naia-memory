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

- Full suite: 183 test files passed; 1,493 tests passed and 1 skipped.
- TypeScript production and benchmark typechecks passed.
- Formatting and diff checks passed.
- Official 500-case manifest generation passed twice with byte equality.
- Unit tests exercise deterministic 500-case partitioning, corpus order drift,
  receipt policy/question drift, complete ordered merge, and incomplete-set
  rejection.

## Claim boundary and next gate

This establishes campaign partition integrity, bounded scheduling metadata, and
deterministic fail-closed aggregation. It does not establish retrieval quality,
answer accuracy, superiority over the keyword-fallback control, or global SOTA.

The next quality gate is to execute the 100 semantic shards and the matched
keyword-fallback control, then answer and judge all 500 cases under the sealed
protocol. A support claim requires higher overall judged accuracy without lower
abstention accuracy and valid receipts across the complete campaign.
