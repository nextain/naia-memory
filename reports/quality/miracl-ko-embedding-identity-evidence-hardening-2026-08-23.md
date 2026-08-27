# MIRACL Korean embedding-identity evidence hardening

Date: 2026-08-23 (Asia/Seoul)

## Finding

The full-corpus evidence verifier bound the corpus, result and TREC hashes,
Qdrant configuration, evaluator binary, and reproduced metrics. However, the
baseline `per-item-v1` path did not require the result to retain the frozen
embedding model identity, passage composition, inference mode, execution-policy
hash, or derived collection name. Removing or substituting those fields could
still produce `LOCAL_PASS`. That gap could make an otherwise valid score
ambiguous or falsely comparable to the frozen historical rows.

## Correction

Both baseline and true-batch evidence now require the exact
`Xenova/multilingual-e5-large` revision, q8 policy, 1024 dimensions, E5
query/passage prefixes, pooling and normalization settings, tokenizer policy,
title-composition contract, explicit inference mode, derived execution-policy
hash, and derived Qdrant collection name. Regression tests reject omitted and
substituted baseline identities.

## Verification

- focused verifier tests: 5 passed;
- full suite: 125 files and 1,022 tests passed;
- TypeScript `--noEmit`: passed;
- Biome check for both changed source files: passed;
- `git diff --check`: passed.

OpenCode `opencode/big-pickle` read the exact two-file diff and supporting
policy/model sources but did not return a final verdict before the 120-second
limit. Its status is therefore **PARTIAL / NOT A PASS**. No independent runner
attestation exists yet, so generated evidence remains `LOCAL_PASS` and
`publicClaimEligible: false`.

## Claim boundary

This change strengthens provenance; it does not improve retrieval quality and
does not turn MIRACL into evidence for Naia lifecycle or update correctness.
The full-corpus score is still pending, and public competitiveness still needs
independent execution attestation plus separately powered human lifecycle
evidence against memory-engine peers.
