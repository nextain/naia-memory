# Public executable dataset contract v3

## Outcome

The public evidence contract can now describe an executable memory benchmark instead of only a query and answer labels. Dataset v3 requires every case to include an ordered, non-empty memory sequence with stable IDs, content, and optional timestamps. Expected and forbidden IDs must reference memories actually inserted for that case.

Manifest schema v8 rejects older bundles that cannot prove this executable setup. A new engine-runner boundary creates isolated state per case, replays memories in order, and requires bridges to round-trip the frozen dataset IDs through native engine metadata.

This is a reproducibility correction, not a retrieval-performance improvement. No global superiority or multilingual-quality claim is added.

## Defect closed

Dataset v2 contained only `{id, language, input, expected, forbidden}`. Real adapters require facts to be inserted before search and return native retrieval results. Consequently, two runners could construct different corpora while claiming the same dataset hash, or fabricate the expected JSON IDs without executing a memory engine.

Dataset v3 closes that gap by binding the ordered memory state into the signed dataset bytes. It also rejects empty memory sequences, duplicate IDs, NFKC-equivalent duplicate contents, invalid timestamps, and labels that do not point to a stored memory.

## Adversarial review

OpenCode's first direct review returned `Not reproducible` for dataset v2 and identified the absent operation sequence and ID-to-content mapping as the concrete failure. After remediation, a fixed-design review returned `VERDICT: CLEAN` and asked for a stricter ID-preservation rule. The runner now fails closed unless a bridge declares `dataset-id-round-trip-v1`.

The review also suggested mandating one retrieval mode such as embedding-only. That recommendation was not adopted: it would disable production capabilities in hybrid engines and turn the benchmark into a component ablation. Each engine's immutable, hash-bound configuration remains the mechanism for disclosing and reproducing its retrieval mode.

## Verification

- Full suite: 38 files, 510 tests passed.
- Strict main and benchmark type checks passed.
- Production build passed.
- Biome checks and `git diff --check` passed.
- New tests verify ordered replay, top-k truncation, isolated cleanup after failure, ID-policy fail-closed behavior, and rejection of non-executable dataset cases.

## Remaining publication gate

Public comparative claims still require an independently authored and native-reviewed Korean/English/Japanese dataset plus concrete bridges and verifier-challenged receipts for Naia Memory and at least two credible global engines. The next implementation stage is to build and validate those engine-specific ID-preserving bridges; the present stage only makes such runs contractually possible.
