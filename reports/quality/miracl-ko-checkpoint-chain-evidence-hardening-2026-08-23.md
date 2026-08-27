# MIRACL-ko checkpoint-chain evidence hardening — 2026-08-23

## Outcome

The full-corpus evidence path now fails closed unless every persisted embedding
checkpoint forms one canonical, contiguous hash chain from ordinal 0 through all
1,486,752 MIRACL-ko passages. The verifier rehashes every doc-ID file and vector
file, recomputes the corpus-wide ordered doc-ID digest, and requires the terminal
receipt hash to equal the evaluation result's ingestion terminal.

This is evidence-integrity hardening, not a retrieval-quality improvement. It
does not change or pre-announce nDCG@10 or Recall@100.

## Closed bypass

Previously, final evidence checked the Qdrant point count and configuration but
did not consume the checkpoint receipt chain. A same-cardinality collection and
an otherwise internally consistent result could therefore receive `LOCAL_PASS`
without the final receipt proving that the persisted checkpoint set was
complete, ordered, byte-intact, and bound to the result's terminal receipt.

The new gate requires:

- exactly 2,904 receipts for 512-document chunks and the 416-document tail;
- contiguous start ordinals and exact per-chunk cardinalities;
- canonical receipt bytes and a valid `previousReceiptSha256` chain;
- locked source, embedding policy, and 1,024-dimensional identity on every chunk;
- rehashed doc-ID and float-vector bytes for every chunk;
- a corpus-wide ordered doc-ID hash equal to the source scan result; and
- a terminal receipt hash equal to `result.ingestion.lastChunkReceiptSha256`.

The verified chain summary is included in the final evidence artifact.

## Verification

- Focused: 2 files / 12 tests passed.
- Full suite: 125 files / 1,025 tests passed.
- TypeScript `--noEmit`: passed.
- Biome on all five changed source/test files: passed.
- OpenCode `opencode/big-pickle` read the exact scoped diff and source files, but
  the 55-second headless window ended before a verdict. Review status is
  `PARTIAL / NOT PASS`; no independent-clean claim is made.

## Residual boundary

This remains self-observed local evidence and is deliberately
`publicClaimEligible: false`. The chain proves checkpoint integrity and binds it
to the locally produced result; it does not provide an independent signed runner
attestation, nor does it prove Naia lifecycle-memory quality or superiority over
other engines. The active full-corpus run must finish before metrics can be
evaluated, and an outside trust boundary must reproduce or attest the run before
public competitive claims.
