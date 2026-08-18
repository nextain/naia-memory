# Public evidence semantic binding — 2026-08-18

## Decision

**NOT PUBLIC-READY.** This iteration closes several self-assertion paths, but an
independent reviewer demonstrated that aggregate receipts can still be forged
without case-level execution evidence. No global-performance claim is promoted.

## Implemented

- Bind the evidence manifest to the actual dataset path, bytes, schema, case IDs,
  case count, and language counts.
- Parse every executed-engine receipt and compare engine kind, family, revision,
  provider/model identities, frozen protocol, cost, failures, and metric fields.
- Replace the review text placeholder with a structured review receipt.
- Compute the review scope over the sealed dataset, frozen protocol, and sorted
  engine receipt hashes; verify reviewer, scope, and verdict from the artifact.
- Keep all evidence paths confined to the canonical evidence root.

## Adversarial review

Codex independently found four false-promotion classes. The fourth is fixed in
this iteration. The first three remain explicit release blockers:

1. Dataset language and identity are declared, but complete input/expected-answer
   semantics and native-language eligibility are not yet audited by the gate.
2. Engine receipts do not yet contain case-by-case input/output/score records, so
   aggregate scores and failure counts cannot be recomputed.
3. Engine family independence is still self-attested; implementation artifact and
   configuration digests are not yet verified.
4. The review artifact previously covered only dataset bytes and could be arbitrary
   text. It is now structured and bound to dataset, protocol, and all engine receipts.

An OpenCode pass also explored hash, language-count, JSON-prototype, path, and
TOCTOU attacks. Invalid-hash and undeclared-language claims were rejected because
they already fail closed. Filesystem concurrency is outside the declared static,
trusted evidence-root threat model.

## Verification

- `pnpm test`: 31 files, 455 tests passed.
- `pnpm typecheck`: passed.
- `pnpm build`: passed.
- Review preflight: `PREFLIGHT_CLEAN`.

## Next gate

Introduce a versioned case-audited evidence contract. Each dataset case must bind
auditable input and expected-answer material; each engine receipt must cover every
case and repetition with input/output hashes and score; the gate must recompute
coverage, failures, the primary score, and confidence interval. Engine arms must
also bind immutable implementation and configuration digests. Only after those
checks and independently authored/native-reviewed multilingual data exist should
the external-engine run be considered publishable.
