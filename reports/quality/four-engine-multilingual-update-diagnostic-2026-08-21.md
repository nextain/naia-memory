# Four-engine multilingual memory-update diagnostic — 2026-08-21

## Decision

This run is commit-worthy mechanistic evidence, but it is not yet public
competitiveness evidence. Naia reduced deletion leakage from 6/36 samples in
the immediately preceding campaign to 1/36 while preserving current-memory
retrieval at 24/36. The remaining Korean deletion miss and the generated,
small case set keep a global-superiority claim at **NO-GO**.

## What changed

- Delete authorization can ask the verifier to resolve extractor surface-form
  drift when an identity has one unambiguous value.
- Equivalent duplicate representations of the verifier-selected value are
  archived together. Distinct values under the same property remain
  fail-closed.
- Durable-cessation extraction guidance is language-independent and its
  examples no longer overlap the benchmark's target attributes.
- The semantic campaign supports a disclosed N-engine matrix and records
  engine-native surface differences.

## Reproducible diagnostic

- Engines: Naia, Mem0 OSS, Hindsight 0.9.1, Letta 0.16.8
- Languages: English, Korean, Japanese
- Cases: 3 generated cases per language
- Repetitions: 4
- Samples: 36 per engine, 144 total
- Ordering: seeded four-engine Latin rotation
- Blind adjudicator: Gemini 2.5 Flash
- Packet SHA-256:
  `ee8f2075c4dd86857b0d491936d86a078b28f3c4facd360e55f1a33d86aa05b7`
- Judgment SHA-256:
  `5dd07d3ac05a28de54397ef8d3694b49a76487ac7d91012bf4de46dc27a60f42`
- Score SHA-256:
  `13fe0a1f294e82b3b05fbafecb1f4615d123a44b7eafb092e6ae41fc9ea67ee7`

| Engine | Current@1 | Current@K | Stale exposure | Deletion leakage |
|---|---:|---:|---:|---:|
| Hindsight | 28/36 | 36/36 | 18/36 | 6/36 |
| Letta | 29/36 | 29/36 | 0/36 | 1/36 |
| Mem0 | 23/36 | 23/36 | 0/36 | 0/36 |
| Naia | 24/36 | 24/36 | 3/36 | 1/36 |

Letta exposes full non-persona core state rather than query-ranked retrieval,
so its row is diagnostic and must not be presented in one retrieval
leaderboard with the other engines.

Naia deletion leakage by language was EN 0/12, KO 1/12, JA 0/12. An isolated
pre-campaign check reached 12/12, but the complete campaign is the canonical
result because it exposed the remaining stochastic Korean miss.

## Follow-up failure localization

The Naia bridge now emits per-turn, privacy-safe delete outcome deltas. These
contain only bounded lifecycle counters (`authorized`, `denied`,
`verifier_failed`, and `oversized`), not episode content, candidate content,
expected labels, or target IDs. The current runner awaits every ingest and
aborts on an ingest exception, so process-global counter deltas are attributable
within this execution contract; they are not a concurrency-safe general tracing
mechanism.

Four fresh runs of the same frozen contract produced 12/12 successful deletion
cases: EN 4/4, KO 4/4, JA 4/4. Every deletion turn recorded exactly one
authorization, zero denials/verifier failures/oversized candidate sets, and zero
retrieved memories afterward. Combined with the canonical campaign, the direct
observations are 23/24 successful deletion repetitions. This narrows the
remaining symptom to a low-frequency model-path variation, but does not identify
whether the earlier miss was extraction omission or another pre-authorization
variation because the canonical artifact predates the counters. It is not a
confidence bound and the repetitions are not independent authored cases.

Follow-up raw artifact SHA-256 values:

- `163785f318d65226983bd0e62ee598230258aedb95db26a8e73b3c2b4a2bb34b`
- `ddf9f74f081fe25f1f9a7511c592c66236c49eb95e1558eab375b167c5188a6a`
- `94f0fb08defd18971977bffda985f1f1a9eb276a2be3f7c5d45a80e855c8bb0e`
- `285467e6ace27708440adf608e92e90779edc575510c8a9d48b3c112e850ee89`

## Comparison with the preceding campaign

The preceding run used the same 4-engine × 4-repetition shape. Naia changed
from current@1 24/36, stale exposure 5/36, deletion leakage 6/36 to 24/36,
3/36, and 1/36 respectively. This supports the narrow causal statement that
the duplicate/surface-drift change improved update cleanup on these cases. It
does not establish out-of-distribution generalization.

## Adversarial assessment

- Multi-value properties remain protected: identity fallback is disabled when
  active candidates contain distinct structured values, and the verifier can
  only select from the bounded candidate set.
- Equivalent duplicate archival is sequential, not transactional. An adapter
  failure can leave a partially archived duplicate group; no atomicity claim
  is made.
- The semantic bridge flattens benchmark turns into the current public ingest
  contract. That can create duplicate facts from assistant confirmations and
  is both a real integration stressor and a comparability limitation.
- The same model family participates in some engine configurations and blind
  adjudication. Model-judge bias has not been ruled out.
- Two fresh Claude headless review attempts timed out without a verdict. They
  are recorded as failed review attempts, not independent approval.
- A subsequent OpenCode headless review returned commit NO-GO and public-claim
  NO-GO. Its benchmark-overlap premise compared the prompt against unrelated
  editor update fixtures; the frozen deletion targets here are hobby, plan, and
  food, while the prompt's deletion examples are editor, music, and beverage.
  Its exception carry-over premise also does not apply to this abort-on-error,
  sequential runner. The valid warning about silently remapping
  `verifier_failed` was fixed by using the tracker key type directly. The public
  NO-GO remains accepted for the independent sample-size and comparability
  reasons above.

## Verification

- Project tests: 64 files, 682 tests passed
- Typecheck: passed
- Build: passed
- `git diff --check`: passed
- Workspace benchmark-contract suite: passed
- Entrypoint and context-translation suites: passed

## Public-report gate

The publication coverage floor is now machine-enforced separately from the base
pilot contract. It requires at least 100 held-out test cases and 100 distinct
test families, at least 30 cases in each of Korean, English, and Japanese, and
at least 10 update, delete, and no-update decisions per language. Development
and diagnostic cases cannot inflate these counts. `create` is outside this
claim scope, and each counted decision must carry coherent current/stale,
deleted, or no-update labels. Author IDs and reviewer IDs must be globally
role-disjoint. The bounded CLI reports held-out case and family counts only and
fails closed on malformed, non-regular, symlinked, or oversized input.

The identity strings are no longer sufficient evidence by themselves. Promotion
now also requires an external Ed25519 trust policy and one signed attestation
for every distinct `(role, language, identity)` assignment. Each attestation
binds the signer, author or native-reviewer role, language, statement, signing
time, and canonical SHA-256 of the complete frozen contract. Signatures issued
before the split freeze, missing or duplicate assignments, post-signing contract
mutation, forged signatures, role overlap, identity aliases sharing a key, and
one identity mapped to multiple keys all fail closed. A reusable external trust
store may contain unrelated identities, but only the exact case assignments
satisfy coverage.

The external signing handoff is now deterministic. Given the frozen contract
and an explicit post-freeze signing timestamp, the signing-packet CLI emits one
canonical payload for every unique role/language/identity assignment, together
with the complete-contract hash and a packet hash. It never reads or emits a
private key. The payload is byte-for-byte the same canonical value later
verified by the publication gate, so external custodians can sign outside this
repository without trusting an ad hoc serialization step. Contract mutation
changes both the contract and packet hashes. Assignment keys use structured
JSON tuples so control characters in externally supplied identity strings
cannot create delimiter ambiguity.

The current nine-case generated diagnostic is correctly rejected. Therefore
this change improves evidence integrity, not measured engine performance, and
the external competitiveness report remains blocked. Promotion still requires
an independently authored and native-reviewed frozen corpus satisfying the
gate with real externally held signing keys; human
near-duplicate auditing; multiple independent native-language judges with
disagreement reporting; comparable engine receipts; latency and cost; and
repetition from a clean released commit. Ranked retrieval and full-state
inspection must remain separate. The Korean stochastic miss and partial-failure
behavior should be resolved or explicitly budgeted first.

Earlier OpenCode adversarial review reproduced and drove fixes for inflated all-split
counts, one-family padding, vacuous decision labels, raw malformed-root errors,
and unbounded file reads. A new OpenCode/Azure DeepSeek hostile review of the
signature stage checked whole-contract binding, complete assignments,
role/language confusion, key aliasing and reuse, replay, mutation, malformed
input, fail-open behavior, and claim inflation and returned `VERDICT: CLEAN`.
The signature-focused suite passes 8/8; all 672 project tests, typecheck, build,
format/lint, and diff checks pass. Public status remains NO-GO because generated
fixture keys only test the mechanism: no qualifying external corpus, real
external signatures, or comparable execution receipts have been supplied.
Implementation status is commit GO.

The signing-packet stage added 5 focused tests and raised the project total to
677. Its first OpenCode/Azure DeepSeek adversarial pass reported a potential
control-character delimiter ambiguity. Although the signer occupied the final
tuple field, the implementation was hardened to structured keys and a
regression test was added. The mandatory re-review returned `VERDICT: CLEAN`.
This closes the tooling gap only; public status remains NO-GO until independent
people actually author, review, sign, and execute the qualifying corpus.

The detached-signature collector now completes the external handoff path. It
accepts the deterministic packet, a packet-hash-bound detached Ed25519
signature set, and the public trust policy; requires exact one-to-one assignment
coverage; rejects malformed base64, duplicate, missing, forged, cross-packet,
or identity/key-confused signatures; and emits the intermediate public
attestation bundle. All three CLI inputs use bounded, no-symlink regular-file
intake. An end-to-end test proves that the emitted bundle passes the separate
final contract gate. The collector deliberately does not claim to establish
live-contract or corpus coverage by itself: the final gate re-derives those
properties from the frozen contract. Claude Code Sonnet headless adversarial
review returned `VERDICT CLEAN`; its non-blocking residual was this same
intentional intermediate-artifact boundary. A preceding OpenCode/Azure DeepSeek
review inspected the implementation and reproduced the focused 10/10 result but
was rate-limited before returning a verdict, so it is not counted as approval.
The full project now passes 64 files and 682 tests, typecheck, build, formatting,
and diff checks. Public status remains NO-GO because no independent corpus,
externally held signatures, or comparable engine execution receipts exist yet.
