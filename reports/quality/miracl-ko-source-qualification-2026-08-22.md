# MIRACL Korean source qualification

Status: **source qualification passed; retrieval competitiveness remains NO-GO**

The official MIRACL v1.0 Korean development source was downloaded and streamed
end to end on 2026-08-22. This is source-integrity evidence only; no Naia Memory
effectiveness score is claimed yet.

## Immutable source receipt

- MIRACL dataset revision: `5be20db9509754dadad47689368639fcec739c00`
- MIRACL corpus revision: `d921ec7e349ce0d28daf30b2da9da5ee698bef0d`
- Upstream repository commit: `fa3a57c89ad8f61f0a02d8c27167d8141cfd77ca`
- Native Korean dev topics: 213
- Judged dev queries: 213
- Corpus documents: 1,486,752 (500,000 + 500,000 + 486,752)

| File | Bytes | SHA-256 |
|---|---:|---|
| topics dev | 12,597 | `a365552cfc997a8915e948a3b5994883f641e7c3f12b6af87bbfaf89729e32a8` |
| qrels dev | 55,675 | `88827ccc5b64e531b25f70eef30202d33daa9bfa3ac8cceadf5cdbd5ca5034df` |
| docs-0 | 87,965,596 | `c56a31883a291504aa9c97968fb7a5fbcc9ea1099ee1810200249e1afb7fc55d` |
| docs-1 | 75,422,723 | `fecd2886124e78c3aa87c59604ac9909c23165415c70a96f4edb95677b5ed0cd` |
| docs-2 | 62,582,229 | `93e90d098d78f50a9e76dd2e64608d65e0563787954f848da9b04286f81b75d9` |

The corpus contains U+2028 line-separator characters inside JSON string values.
The verifier therefore frames records only on byte LF boundaries and uses an
incremental UTF-8 decoder; generic line readers can split valid records here.
The verifier rejects malformed IDs, empty shards, size mismatch, and digest
mismatch, and writes a non-overwriting revision-named local receipt.
Blank physical rows are rejected. Downloads are first written to a
process-specific partial path and renamed only after the stream completes, so a
terminated transfer cannot masquerade as a completed cached source.

OpenCode adversarial review returned `CONDITIONAL PASS`: it found no claim
overreach or pinning failure, and identified blank-line acceptance plus partial
download poisoning. Both were fixed before commit. Recovery mode still prevents
a formal review-pass `CLEAN` claim.

## What this proves and does not prove

This proves that the next experiment uses independently authored native Korean
queries and the complete official corpus rather than translated or synthetic
text. It does not prove retrieval quality, update quality, superiority over
global engines, or official MIRACL comparability. The next required evidence is
a receipt-bound full-corpus lexical and dense retrieval run, from which hard
negatives can be selected without using labels as the retrieval signal.
