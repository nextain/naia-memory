# Closed-vocabulary query identity checkpoint — 2026-08-22

## Status

Conditional benchmark-only implementation. This is not product integration evidence and does not establish a performance gain.

The query structurer can now request a complete allowlisted `subjectId`/`propertyId` pair behind the opt-in `BENCH_QUERY_IDENTITY_IDS=true`. The default path remains label-only. Partial, unknown, and invented pairs are discarded together, preserving labels as the fallback.

## What changed

- Fact extraction and query extraction share one subject/property ID vocabulary.
- Query IDs are disabled by default and enabled only by an explicit benchmark flag.
- Benchmark artifacts disclose whether IDs were requested and report complete-pair coverage.
- Artifact disclosure explicitly states that pair coverage is presence, not correctness.
- Unit tests cover accepted complete pairs, partial pairs, invented IDs, and default-off compatibility.

## Evidence and ceiling

- TypeScript typecheck passed.
- Full test suite passed: 103 files, 906 tests.
- The existing 108-case structured-supersession fixture has no `subjectId` or `propertyId` oracle. Its labels also contain generated replacement markers, so it cannot honestly establish language-neutral ID accuracy.
- A prior wrong-identity intervention collapsed hit@1 to zero. Because retrieval gives exact structured identity a hard boost, an in-vocabulary but semantically wrong ID is the dominant safety risk. Allowlisting alone cannot detect that error.

## Adversarial decision

GO only for generating benchmark predictions and measuring pair coverage. NO-GO for naia-agent/naia-shell integration, multilingual superiority, or public performance claims.

Promotion requires a separately frozen native-language oracle with Korean, English, and Japanese cases; wrong-ID containment; at least 95% exact ID accuracy; at least 100k evaluated attachment opportunities; repeated-model confidence intervals; and end-to-end mixed label/ID retrieval parity. The oracle must be independent of the implementation prompts and must include ambiguous and out-of-ontology negatives.

## Next experiment

Define and validate the independent oracle schema before collecting model outputs. Pre-register scoring so abstention, wrong in-vocabulary IDs, partial pairs, and unsupported properties are counted separately. Keep the long-running CPU-only MIRACL full-corpus run isolated as global retrieval evidence.

## Oracle contract implementation

The repository now contains a data-free oracle validator and scorer. It does not contain self-authored benchmark answers. Runtime validation requires independent native author/reviewer provenance, prevents family leakage across development and test, and gates public evidence at 100 test cases with at least 30 per language. Each language must cover identity and abstention, all three abstention reasons, and at least ten distinct ontology properties.

An OpenCode adversarial review returned FINDINGS. Accepted findings split valid-but-wrong identity errors from false positives on abstention, classify malformed output and partial pairs explicitly, validate runtime JSON rather than trusting TypeScript types, and strengthen per-language difficulty coverage. One finding claiming unsupported IDs could not be measured on identity cases was rejected after control-flow inspection: unsupported prediction IDs are classified before expectation branching. The ontology-range criticism remains valid; absent real-world categories must appear as `out-of-ontology` abstentions and block any claim of general personal-memory coverage.
