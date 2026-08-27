# Public evidence semantic replay gate

Date: 2026-08-18
Status: implementation verified; public comparison still blocked

## Outcome

The public-evidence verifier now recomputes every signed retrieval case from the
recorded raw output under one frozen policy, `exact-current-hit-at-k-v1`.
Changing a score, judgment, top-k label, stale-ID rule, or scorer description no
longer remains valid merely because the altered bundle was signed again.

The metric is `current-hit@K`: a case passes only when an expected opaque ID is
inside the first K returned IDs and no forbidden ID is inside that window.
Forbidden IDs model superseded or otherwise unsafe memories. The scorer has no
engine- or language-specific branches, so Korean, English, Japanese, Naia, and
external engines receive identical scoring semantics.

## Evidence

- Full suite: 32 files, 474 tests passed.
- Typecheck and production build passed.
- Focused scorer/evidence tests cover invalid and non-integer top-k, metric and
  policy substitution, malformed and overlapping forbidden IDs, stale retrieval,
  score/judgment forgery after re-signing, and failed-record bypass attempts.
- Two consecutive unchanged-code adversarial rounds were CLEAN from OpenCode and
  Claude headless before mechanical formatting; the formatted candidate preserves
  the reviewed behavior and is revalidated before commit.
- Complexity preflight identifier:
  `sha256:dc5ffebde27286216a35ed64aead7e7267b28b8e9af89d287e6127a6973ce0b5`.
  The shared cryptographic fixture was 572 lines at preflight and is 1,010 lines
  after repository formatting. This exceeds the normal refactor threshold; both
  reviewers accepted a named deferral because the expansion is mechanical and the
  fixture centralizes keys, signed receipts, and evidence setup without a concrete
  maintainability defect. It should be split before the next feature expansion.

## What this proves—and does not prove

This is a meaningful integrity improvement: published case scores can be
deterministically replayed from the signed outputs, and stale-memory penalties
cannot be relabeled away. It does **not** prove that an output was produced by the
claimed engine invocation. An approved engine signer could still fabricate an
internally consistent output bundle. Dataset author and native-reviewer IDs are
also declarations rather than independently signed attestations.

Therefore this stage is not evidence for a global leaderboard claim, nor proof
that Naia Memory outperforms Mem0, Hindsight, Letta, Zep/Graphiti, or another
engine under a public held-out corpus.

## Next gate

Public-ready evidence requires independently reproducible execution receipts:

1. Freeze an independently authored multilingual held-out corpus and collect
   signed author and language-native reviewer attestations.
2. Bind each engine receipt to an adapter revision, immutable configuration,
   executable or container digest, provider request/response evidence, and run
   nonce issued by the verifier.
3. Have an independent runner reproduce Naia and at least two global engines on
   the same sealed inputs, then publish raw receipts and confidence intervals.
4. Run adversarial review for benchmark favoritism, objective mismatch, language
   leakage, and corpus overfitting before making a comparative claim.
