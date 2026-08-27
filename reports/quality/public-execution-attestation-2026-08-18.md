# Public execution evidence gate — 2026-08-18

## Verdict

**EVIDENCE-INTEGRITY GATE PASS; PERFORMANCE PUBLICATION STILL BLOCKED.**

This stage does not raise a benchmark score. It makes a narrower statement
code-enforceable: **“Artifacts are tamper-evident under the frozen public
evidence protocol.”** Any broader performance, multilingual-quality,
generalization, organizational-independence, or semantic-execution claim is
rejected by the manifest gate.

## Improvements

- Ed25519 signatures are canonical, strict, and bound to verifier-owned trust
  roots; one key or identity cannot occupy multiple trusted roles.
- Verifier-issued challenges bind the sealed dataset, frozen protocol, engine
  receipt, implementation artifact, configuration, and execution evidence to a
  runner-signed time-bounded attestation.
- Every referenced file is read once; the same bytes are hashed and parsed.
  Absolute paths, traversal, and symlink escapes are rejected.
- Untrusted manifest JSON is structurally narrowed before semantic validation.
  Numeric strings, malformed reviewer maps, and invalid engine kinds fail closed.
- File processing is staged: all bytes are loaded and checked, the dataset is
  established, then receipts are replayed. Dataset failure no longer creates a
  misleading cascade of per-case failures.
- Missing or duplicate hashes are checked against the complete executed-engine
  set. Unexecuted engines may not carry non-zero score, confidence, latency,
  cost, or failure claims.

## Adversarial review

Two consecutive reviews on the unchanged final tree returned:

- security: `CLEAN` / `CLEAN`
- claim scope: `CLEAN` / `CLEAN`
- architecture: `ACCEPTED` / `ACCEPTED`

Earlier rounds found and caused fixes for role identity overlap, weak runtime
narrowing, message-string control flow, dataset/receipt order dependence,
unexecuted-engine score injection, and incomplete receipt-hash set checking.

Three proposed security findings were rejected after direct code inspection:
challenge expiry constrains execution time rather than later historical
verification; replay uniqueness is scoped to one immutable signed bundle; and
the loader already hashes and parses the same in-memory bytes.

## Verification

- Biome: 17 public-evidence files/configs passed.
- Vitest: 36 files, 490 tests passed.
- Main and benchmark strict TypeScript checks passed.
- Production build passed.
- `git diff --check` passed.

## Remaining public-readiness blockers

1. A genuinely independent held-out corpus of at least 100 cases, with at least
   30 Korean, 30 English, and 30 Japanese cases and signed native review.
2. Real same-input executions for Naia plus at least two global engines (for
   example Mem0, Zep/Graphiti, Letta/OpenMemory, or Hindsight), using externally
   owned challenge/runner keys and immutable adapters/configurations.
3. Published signed receipts, raw outputs, costs, failures, confidence intervals,
   and reproducible environment/container digests.
4. A final review for benchmark favoritism, objective mismatch, language leakage,
   and corpus overfitting over the complete external evidence bundle.

Until these exist, the gate supports tamper-evidence only. It is not evidence
that Naia is globally superior or that its multilingual quality is public-ready.
