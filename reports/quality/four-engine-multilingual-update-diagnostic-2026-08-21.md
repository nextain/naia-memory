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

- Project tests: 64 files, 684 tests passed
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

The broader public-evidence gate now canonicalizes every trusted public key to
its SPKI DER representation before enforcing role independence. This prevents
equivalent PEM encodings, such as LF and CRLF variants of the same Ed25519 key,
from bypassing key-reuse detection. It also enforces one key per trusted
identity across languages and roles, while malformed keys fail closed. Two
regressions cover equivalent encodings and one identity mapped to different
keys. Claude Code Sonnet headless adversarial review returned `VERDICT: CLEAN`,
with only a non-blocking operational suggestion to reject accidentally supplied
private-key PEM more explicitly. The full project now passes 64 files and 684
tests, typecheck, build, formatting, and diff checks. This hardens publication
evidence integrity; it does not improve or remeasure engine performance, so the
public competitiveness status remains NO-GO.

The semantic evidence tooling now separates corpus qualification from public
competitive promotion. Previously, a sufficiently large frozen contract with
trusted author and native-reviewer signatures made
`benchmark:semantic-public-gate` emit `promotable: true`, even though that
three-input command did not inspect any engine execution, comparable receipts,
repetitions, adjudication, latency, cost, or released commit. That was a
claim-boundary defect: independent corpus provenance is necessary evidence, but
not evidence that an engine is competitive. The public gate now fails closed
with `promotable: false` and an explicit missing-execution-evidence blocker.
The useful provenance check remains available under the narrower
`benchmark:semantic-corpus-gate` command, whose success and failure payloads
use only `corpusQualified` semantics.

Two Claude Code Sonnet headless adversarial passes required fixes to corpus
failure output and a positive reusable-trust-store regression; the final pass
returned `VERDICT: CLEAN`. The full project passes 64 files and 686 tests,
typecheck, build, formatting, and diff checks. This stage deliberately reports
no performance increase. It prevents a signed dataset from being presented as
a measured competitive result. Public status remains NO-GO; the next evidence
stage must define and collect semantic engine execution receipts on the frozen
corpus before this gate can ever return a promotion success.

That execution-receipt contract is now implemented. A v1 receipt is issued per
engine and signed by a trusted Ed25519 executor identity. It binds the canonical
contract hash, exact campaign-file byte hash, ordered per-engine run-set hash,
clean 40-hex implementation revision, implementation artifact and configuration
hashes, execution interval and elapsed time, cost disclosure, and the executor's
confirmation statement. The verifier rebuilds the frozen balanced plan, requires
exact one-receipt-per-engine coverage, rereads every raw artifact, verifies its
shape and declared hash, rejects symlinks and non-regular files, canonicalizes
trust keys to prevent identity aliases, and rejects forged, stale, duplicate, or
input-mismatched receipts. Unknown cost is permitted only as an explicit null and
is surfaced as `costComplete: false`; it cannot support a cost-efficiency claim.

The six-input public-gate path is covered end to end. Successfully verified
receipts produce `executionEvidenceQualified: true`, engine/run counts, and the
cost-completeness flag, but still produce `promotable: false`. This distinction
is intentional: signed execution provenance proves which immutable artifacts
were run; it does not score their quality. Public competitiveness remains NO-GO
until the already blinded packet is completed by independent adjudicators,
unsealed into reproducible per-language competitive metrics with disagreement
and uncertainty, and bound to equally auditable latency/cost evidence.

The twelve-input public-gate path now adds signed semantic-adjudication
evidence. Every adjudicator receipt binds the complete contract, exact campaign
bytes, blinded packet, seal, exact judgment bytes, declared profile, timing,
and engine-independence statement. The verifier requires exact judge coverage,
valid Ed25519 signatures, and role separation from corpus authors, native
reviewers, and engine executors by both identity and canonical public key. It
then rebuilds the blinded packet and seal from the frozen inputs and seed before
recomputing the score. Mutation, missing receipts, forged or reused keys,
profile drift, invalid timing, and corpus-author identity reuse through the
top-level gate all fail closed.

This stage establishes signed-artifact integrity, trusted-key coverage, and
cross-role separation only. It explicitly reports
`blindnessVerified: false`, `organizationalIndependenceVerified: false`, and
`interRaterAgreementEvaluated: false`; signatures cannot prove that a judge did
not see the seal, that organizations are genuinely independent, or that
multiple raters agree. The public gate therefore remains hard-coded
`promotable: false`. No new engine run was made and no performance increase is
claimed.

Two consecutive post-fix OpenCode headless adversarial reviews returned
`CLEAN`. An earlier review found that cross-role separation needed gate-level
regression coverage; the test now proves that reusing a corpus-author identity
as an adjudicator is rejected by the complete public path. The final reviews
reproduced 17 focused tests and checked signature binding, receipt coverage,
score recomputation, false-green assertions, bounded input, and claim wording.
A Claude headless attempt failed to produce a verdict and is recorded as
`NOT_RUN`, not as approval. Deterministic review preflight remains
`REVIEW_REQUIRED` only because the cohesive public-gate integration test is 640
lines; decomposition is advisable if another attack surface is added, but is
below the 800-line mandatory-refactor threshold. The current full project
passes 66 files and 696 tests, typecheck, build, formatting, and diff checks.

The next publication-critical step is not another internal fixture. It is a
real, externally administered multi-rater campaign: independently held signing
keys, auditable blind-packet delivery, at least two native-language judges per
language, disagreement and inter-rater-agreement reporting, uncertainty bounds,
and reruns from a released commit with comparable latency and cost receipts.
Until those artifacts exist, this report supports a strong evidence-integrity
claim but not a global engine-superiority claim.

OpenCode adversarial review first found a manifest symlink escape and the lack
of full six-input gate coverage. Both were fixed and regression-tested. Two
subsequent focused reviews found no remaining blocker for this narrow execution
provenance stage and returned `VERDICT: CLEAN`. The full project passes 65 files
and 690 tests, typecheck, build, formatting, and diff checks. The workspace
benchmark-contract, entrypoint, and context-translation suites also pass. This
stage improves evidence integrity, not engine quality, so no performance uplift
is claimed.

The semantic judgment contract now supports a v3 multi-rater mode. For every
blind sample, all declared native-language human adjudicators eligible for that
language must submit an independent label for every retrieved memory. Fewer
than two eligible humans, a missing assignment, duplicate assignment, extra
assignment, incomplete memory coverage, unused declared adjudicator, or any
model adjudicator causes scoring to fail closed. The resulting score reports
exact-agreement subjects, disagreement subjects, agreeing and total rating
pairs, pairwise observed agreement, exact-agreement rate, and a pooled-category
chance-corrected multi-rater kappa overall and by language. Unique majorities
become the scoring consensus; ties become `uncertain` and remain visible as
disagreement.

This closes a specific evidence gap: signed judgments can now demonstrate what
the declared raters individually submitted and quantify their agreement. It
does not prove that they were administered independently, did not see the seal,
belong to independent organizations, or are actually native speakers. Those
last properties remain trust-policy declarations, so the evidence result now
also emits `nativeLanguageStatusVerified: false`. The overall kappa pools label
prevalence across languages and is explicitly unsuitable for language-specific
claims; such claims must use `byLanguage`. No real external judgments were
collected in this stage, no engine was rerun, and no performance uplift or
global superiority is claimed. Public status therefore remains NO-GO.

The first valid OpenCode adversarial review identified the multilingual pooled
kappa interpretation risk. The output now carries an explicit scope caveat. A
second suggested missing-assignment weakness was independently tested and not
reproduced: validation already resolves every expected sample/adjudicator pair
and fails on the first absent record, then separately rejects extra records.
After the disclosure fix, OpenCode HY-3 and MiMo post-fix reviews both returned
`CLEAN`. Claude Code headless timed out and is recorded as `NOT_RUN`, not an
approval. The project passes 67 files and 702 tests, typecheck, build, Biome,
deterministic review preflight, and the workspace benchmark-contract suite.

The next result that would materially change the publication decision must be
external rather than synthetic: freeze a qualifying multilingual corpus,
administer the same blind packet to at least two independently recruited native
human judges per language using separately held keys, publish signed raw
judgments and per-language disagreement/kappa, and rerun all engines from a
released commit with comparable signed latency and cost receipts. Only that
campaign can show whether the current ranking survives independent human
interpretation and whether Naia Memory has a defensible global or Korean-first
advantage.

## Family-cluster uncertainty stage

The adjudication score now emits deterministic 95% percentile intervals and
paired engine differences. The resampling unit is `familyId`, not execution
repetition: all repetitions belonging to a family move together, and every
engine receives the same sampled family sequence in each of 10,000 iterations.
This follows the clustered-data bootstrap principle described by
[Field and Welsh (2007)](https://rss.onlinelibrary.wiley.com/doi/abs/10.1111/j.1467-9868.2007.00593.x)
and the paired bootstrap comparison pattern used for system evaluation by
[Koehn (2004)](https://aclanthology.org/W04-3250/).

The implementation fails closed if an engine is missing a family, if engines
have different repetition counts for a family, or if family sizes differ
within a language. This balanced-design requirement avoids silently centering
sample-level intervals on a different family-weighted estimand. Fewer than ten
independent families raises an explicit sparse-cluster warning. Pairwise
intervals declare `multiplicityAdjustment: none`; they are exploratory and are
not simultaneous family-wise evidence.

The first valid OpenCode adversarial review returned `DIRTY` after finding that
unequal family sizes could bias the bootstrap distribution while the reported
estimate remained sample-weighted. Primary inspection confirmed the defect.
Balanced family sizes are now enforced and regression-tested. Two subsequent
independent MiMo executions returned `CLEAN` with the same current complexity
digest. HY-3 attempts that ended without a verdict and a tool-blocked Muse run
are recorded as `NOT_RUN`, not approval.

The project now passes 68 files and 705 tests, build, typecheck, Biome, diff
checks, deterministic complexity preflight, and all workspace benchmark
contract, entrypoint, and context-translation gates. This stage improves the
honesty and reproducibility of uncertainty claims; it does not alter an engine
score. The existing three-family-per-language diagnostic would correctly raise
the sparse-cluster warning, so the public competitiveness decision remains
**NO-GO** pending the external native-human campaign described above.

## Preregistered analysis-plan stage

The 100-family public coverage floor is not a statistical power calculation.
It prevents a very small or development-contaminated corpus from entering the
public path, but by itself cannot establish that a campaign can detect a
practically meaningful difference. The gate now keeps those two claims
separate by accepting an optional signed v2 analysis plan only on the complete
14-input evidence path.

The plan freezes the exact engine order, Naia's primary metric, every primary
competitor comparison, family-wise alpha, Holm multiplicity adjustment, target
power, minimum detectable difference, language-specific independent-family
targets, a hash of the sample-size assumptions, the named sample-size method,
and a no-outcome-peeking stopping rule. Its declared signed timestamp must
predate the first declared engine-execution timestamp. The administrator's identity and
canonical public key must be distinct from corpus authors, native reviewers,
engine executors, and adjudicators. The test corpus must meet every declared
language-specific family target, and the plan must cover every campaign engine
exactly once as either Naia or a primary comparator.

A qualified plan proves signature and content-binding integrity, not statistical
correctness or trusted wall-clock chronology. The public output therefore names
this state `analysisPlanIntegrityQualified` and explicitly returns
`sampleSizeAdequacyVerified: false` and `trustedTimestampVerified: false`.
The assumptions hash may bind a flawed power analysis; independent statistical
review and publication of the assumptions artifact are still required. The
gate also does not yet apply Holm-adjusted competitive thresholds to the paired
family intervals, evaluate simultaneous uncertainty, or verify released-commit
latency and cost comparability. It therefore continues to return
`promotable: false`. No engine was rerun and no performance uplift is claimed.

The focused analysis-plan and public-gate suites pass 16 tests, including
pre-execution chronology, signature mutation, unmet family targets, exact
language coverage, and administrator role/key reuse. The first OpenCode MiMo
adversarial pass returned `CLEAN` at complexity digest
`sha256:5af0049897633a17ff0c74de28f641510ee04717ba22b250172610b1ebc67004`.
Final whole-tree validation and the required consecutive post-documentation
reviews are recorded with the commit evidence below.

## Shifted-null competitive inference stage

The previous preregistration schema incorrectly left room to treat the minimum
detectable difference (MDE), which is a power-design quantity, as if it were a
minimum practically important difference. An adversarial Claude headless
review identified that as a critical statistical error. Schema v2 now freezes
a separate MPID and the complete decision rule. Existing v1 plans intentionally
fail schema validation rather than being silently reinterpreted.

On the 14-input public path, the gate now reconstructs paired binary outcomes
from the signed blind adjudication score and the contract's `familyId` mapping.
For every preregistered competitor × language cell it averages repetitions
inside each family, normalizes metric direction, shifts each paired difference
by the MPID, and computes an exact one-sided family sign test. Families exactly
on the MPID boundary count as failures under the stated all-family null rather
than being removed from the denominator. Exact case-ID composition and counts
must match between engines within every family. Holm adjustment
is then recomputed across the complete comparison family with deterministic
hypothesis ordering. Missing engines, languages, families, paired repetitions,
non-binary adjudicated outcomes, and family counts outside the exact
calculator's supported numerical range fail closed. A test also reports
`resolution-floor` when the number
of non-tied families cannot possibly reach its realized Holm-rank threshold.

This estimand is deliberately narrow: it tests whether a majority of paired
families exceed the MPID, not whether the mean engine score is superior. The
output therefore remains `internalIntegrityGateOnly: true`,
`claimEligible: false`, `publicQuotable: false`,
`methodAdequacyVerified: false`, and `sampleSizeAdequacyVerified: false` even
when synthetic fixtures pass every numerical threshold. Requiring every
language cell to pass prevents a pooled average from hiding a weak language,
but combining that all-cells rule with Holm is conservative; the preregistered
power simulation must model the complete rule before publication.

No production engine score changed in this stage and no new human campaign was
run. This is a stronger anti-overclaim gate, not evidence that Naia Memory is
globally superior. Public status remains **NO-GO** until the native-human,
released-commit campaign supplies enough independent families and its full
decision rule receives independent statistical validation.

## Complete-rule sample-size simulation stage

The repository now has a fail-closed schema and deterministic simulator for the
sample-size assumptions referenced by the signed analysis plan. The artifact
must enumerate every language and competitor cell, an alternative probability
that an independent family exceeds the MPID, candidate language-specific family
counts, a fixed seed and iteration count, and explicit dependency scenarios.
Its canonical SHA-256 must equal the hash frozen in the signed plan.

For each candidate, the simulator generates both global-null and planned-effect
family outcomes, runs the same exact binomial upper-tail implementation used by
the campaign inference, applies Holm step-down across all competitor × language
hypotheses, and evaluates the actual all-cells decision. It reports Wilson 95%
intervals for any-null rejection, all-null rejection, and complete-rule power.
A signed plan target passes only when that exact language-specific count vector
is present in the frozen simulations, the null-any upper bound is at most the
family-wise alpha, and the complete-power lower bound reaches target power.
This prevents choosing a favorable candidate after simulation. The command is
`pnpm benchmark:semantic-sample-size <assumptions.json> <analysis-plan.json>`.

The v2 assumptions contract also requires at least two predeclared dependency
scenarios: an independent baseline and one or more positive within-cell family
shock mixtures. Each family outcome keeps the declared marginal exceedance
probability; with the configured probability, every family in the same language
× competitor cell shares one Bernoulli outcome, otherwise all are independent.
The resulting pairwise covariance is `q × p × (1 - p)`, so it is nonnegative
for every permitted shock probability `q`. This deliberately violates the nominal
independent-family assumption and exposes residual clustering: the signed plan
passes only if the null-any upper interval remains within family-wise alpha and
the complete-power lower interval reaches target power in **every** scenario.
The deterministic fixture demonstrates the intended failure mode: its
independent scenario is null-calibrated, while a 0.35 shared-cell shock makes
the null-any upper interval exceed 0.05, so the overall target fails. This is a
simulator diagnostic, not an estimate of real campaign dependence.

This closes a reproducibility gap but does not yet establish adequate sample
size. In particular, the repository does not currently contain a defensible,
pre-campaign estimate for each cell's probability of exceeding the MPID, and
the sensitivity grid does not estimate how much residual family dependence the
real corpus contains. Choosing those values or probabilities after seeing the
held-out campaign would be outcome-peeking; choosing optimistic values now
would merely manufacture a small target. Therefore every simulation output remains
`sampleSizeAdequacyVerified: false` and `claimEligible: false`, even if a frozen
synthetic fixture reaches target power. Before the public campaign, the cell
probabilities and dependency-grid limits need external statistical justification
from disjoint pilot data or published domain evidence. Public status remains
**NO-GO**.

The final changed tree passes 72 test files and 719 tests, TypeScript build and
typecheck, Biome, and staged-diff checks. The synthetic positive case only
proves that the decision calculator can reach its internal threshold; it is not
an engine result and cannot be quoted as competitive evidence.

## Author-cluster inference stage

The dependency sensitivity stage found a structural problem rather than a
larger-family-count problem. The signed corpus contract records who authored
each case, but v2 inference counted every `familyId` as independent. A single
author could therefore contribute many stylistically or procedurally related
families and make an exact family sign test appear to have far more independent
evidence than the corpus construction supports. No resampling method can
recover an independent unit that the frozen design did not identify.

Analysis-plan schema v3 now preregisters language-specific **independent author
cluster** targets. Public inference obtains that cluster only from the case's
signed `provenance.authorId`; it cannot be supplied by an engine result or
post-hoc score file. All paired family differences from one author and language
are averaged into one equally weighted author-cluster difference before the
MPID shift, exact one-sided sign test, and Holm correction. Engine pairing must
agree on the author cluster, and missing IDs or an unmet author-cluster target
fail closed. A regression test verifies that twenty winning families written by
one author still count as one cluster and cannot satisfy a two-cluster plan.

The corresponding sample-size assumptions schema is v3 as well. Candidate
counts, null and alternative exceedance probabilities, dependency shocks, and
reported plan targets now refer to independent author clusters rather than
families. This is a change in the estimand: the null is now that at most half of
independent author clusters have a family-mean advantage above MPID. It does not
claim mean superiority, and it gives authors equal weight even when they
contribute different numbers of families. Independence across authors remains
a design assumption; shared prompts, translators, templates, or editorial
coordination across authors would require a still higher preregistered cluster.
Equal author weighting does not inherently favor an engine, but it can disagree
with a family-weighted result when an engine's gains concentrate in prolific
authors. A public report must therefore name the author-level majority estimand
and disclose a preregistered family-weighted sensitivity analysis; disagreement
between them is heterogeneity evidence, not permission to select the favorable
result.

This design follows the general clustered-inference requirement that the unit
treated as independent must match the dependence structure, and it deliberately
avoids relying on asymptotic cluster-robust corrections with very few clusters.
Relevant primary literature includes Cameron, Gelbach, and Miller's
[multi-way clustering framework](https://www.nber.org/papers/t0327), MacKinnon
and Webb's [few-cluster warning and wild-bootstrap
analysis](https://doi.org/10.1080/07350015.2017.1292783), and Watson, Akinyemi,
and Hemming's [permutation-based multiple-testing analysis for clustered
trials](https://arxiv.org/abs/2107.10017). These sources motivate the failure
condition; they do not validate Naia's chosen power assumptions.

This materially strengthens resistance to benchmark overfitting and
pseudoreplication, but it makes the present evidence weaker, not stronger: the
current fixture has one author identity per language and therefore cannot
support a competitive claim at useful exact-test resolution. Public status
remains **NO-GO**. The next campaign-design task is to freeze a genuinely
independent multi-author corpus, declare any higher-level shared construction
clusters, and obtain external statistical review of the author-cluster estimand
and v3 power assumptions before collection begins. No engine score or claimed
performance changed in this stage.

The author-cluster implementation passes 72 test files and 721 tests, build,
typecheck, Biome, and diff checks. The workspace benchmark-contract package,
context-translation suite, and session-contract gate also pass. The combined
entry-point command is not claimed as passing: its agents-context mirror test
produced no result and was interrupted after hanging, while its entry-point sync
subtest had passed. An initial adversarial review found and prompted a fix for a
missing-`authorId` value being counted as one `undefined` cluster; the final
validator rejects missing or blank author clusters and has a regression test.

## Construction-cluster inference stage

The author-cluster review exposed one remaining pseudoreplication path: several
nominally different authors can still share a translator, prompt template,
source-generation process, or coordinating editor. Analysis-plan schema v4 now
requires a preregistered `construction-cluster` independence unit and a
language-specific minimum number of those clusters. Each independently reviewed
case carries the cluster in signed provenance. Missing IDs, engine-side cluster
disagreement, or a campaign that meets its author target but not its
construction-cluster target fails closed.

Inference now averages families equally within each author, authors equally
within each construction cluster, and runs the shifted exact sign test and Holm
correction only across construction clusters. This prevents six authors using
one shared construction pipeline from being treated as six independent units;
a regression test exercises that exact failure. The output also reports
author-equal and family-equal descriptive means and whether their directions
agree. A second regression fixture deliberately makes five lightly sampled
authors favor Naia while one prolific author favors the competitor: the two
descriptive estimands point in opposite directions and the disagreement is
surfaced rather than allowing a favorable weighting to be selected silently.

This is stricter evidence accounting, not a score improvement. A signed cluster
label is an auditable declaration, not proof of real independence; corpus
operators must define clusters from shared construction causes before outcomes
are observed, and an external reviewer must audit those definitions. The
existing fixture has only one author per language and no qualifying independent
construction campaign, so the competitive report remains **NO-GO** and no
global superiority statement is public-quotable. The next empirical step is a
multi-author, multi-construction-cluster pilot that is disjoint from the frozen
public test corpus, followed by externally reviewed v4 power assumptions.

The first construction-cluster review pass also exposed a contract drift in
the power layer: inference had moved to construction clusters while the signed
sample-size assumptions and simulator still named and counted author clusters.
Assumptions and simulation schema v4 now use construction-cluster candidate
counts, exceedance probabilities, dependency shocks, signed-plan targets, and
output labels throughout. Coverage is checked against the plan's required
construction clusters, and a plan target absent from the simulated candidate
grid fails closed. The shock sensitivity remains deliberately pessimistic and
conditional; it neither proves that declared construction clusters are truly
independent nor makes the current corpus adequate.

The implementation passes 72 test files and 723 tests, production build, both
main and benchmark TypeScript checks, changed-file Biome, and diff checks.
Before this review note was appended, an OpenCode/Nemotron adversarial review
independently matched staged-diff digest
`a243009f80d7bfd56875d3e37776ef08f6618c593ea765aab1235a574fb30bbf` and
returned `HASH MATCH; CLEAN`, including the corrected construction-cluster
power unit, fail-closed paths, and Naia-favoring risks. A later review of the
note itself rejected circular wording that implied the note was part of that
earlier digest; this paragraph records the corrected chronology.
Repository-wide Biome is not claimed as passing because existing generated,
recovery, and unrelated workspace files remain outside this change.

## Independent pilot power-review gate

The v4 plan previously required a disjoint pilot and external review only in
prose. The public gate now accepts a signed power-review artifact that binds the
pilot contract, public contract, sample-size assumptions, reviewer identity,
review chronology, and every declared construction cluster. It rejects reused
family or case IDs, normalized content duplicates, construction-cluster and
corpus-role overlap, reviewer key or identity reuse, non-development pilot
cases, and non-test public cases. The review must precede preregistration.

This gate intentionally reports
`constructionCauseIndependenceVerified: false`. Cause IDs and a reviewer
signature make the construction claim auditable, but they cannot empirically
prove that two authors, translators, templates, or editors were independent.
The artifact is approved only for estimating preregistration assumptions; it
cannot promote a benchmark result. The public gate therefore remains
`promotable: false`, and the 14-input path explicitly reports that independent
pilot review was not evaluated.

The first OpenCode adversarial pass returned **NOT_CLEAN**. It found that the
power reviewer could overlap pilot staff, punctuation/case changes could evade
duplicate detection, direct library callers did not validate the public
contract, and cause-independence wording could overclaim. After those fixes, a
second pass found malformed-date, public-split, and public-participant bypasses.
All were fixed and covered by regressions. The final OpenCode pass returned
**CLEAN** after independently running 24 focused tests and TypeScript checking.

This stage improves evidence integrity and resistance to benchmark overfitting;
it does **not** increase any measured Naia score. Public status remains
**NO-GO** until a genuinely independent multilingual pilot is collected and
reviewed, the preregistered public corpus reaches its required construction
cluster and case counts, all competitor executions have external receipts, and
the frozen competitive and latency gates pass on a released commit.

## Pilot result-to-assignment binding

The public gate now requires the independent pilot collection plan in addition
to the completed pilot contract and signed power review. Every completed case
must use its assignment ID as the case ID and exactly match the predeclared
language, update/delete/no-update decision, author, native reviewer, and unique
construction cluster. The reviewed construction-cause IDs must also match the
plan. The power review signature covers `collectionPlanSha256`, so replacing
the plan after review invalidates the signature-bound evidence chain.

This closes a concrete provenance bypass: a valid pilot contract can no longer
qualify merely because its clusters happen to match a review; it must match all
nine Korean, English, and Japanese assignment cells issued by the collection
plan. The gate reports `pilotCollectionBindingQualified: true` only after the
one-to-one check. It separately reports
`constructionCauseIndependenceVerified: false` and
`priorAssignmentTimingVerified: false`: a signed hash authenticates the
reviewer's attestation, but does not provide an external trusted timestamp or
empirical proof that construction causes are organizationally independent.

An initial Claude headless adversarial review returned **BLOCKED** for malformed
timestamp defense, duplicate-ID defense in depth, an optional plan-hash field,
and language that could overstate what was verified. All were corrected and
covered by regressions. A second focused headless review returned **CLEAN**.
The integrated change passes 75 test files and 753 tests, production build,
both TypeScript checks, changed-file Biome, and `git diff --check`.

No benchmark score changes in this step. Public status remains **NO-GO**. The
next empirical requirement is still independently collected native-reviewed
pilot data, followed by an externally timestamped/frozen plan if prior timing
is to become verified rather than attested.

## Independent pilot collection packet

The next implementation step turns the pilot requirement into deterministic,
role-separated collection instructions. A collection plan must cover every
Korean, English, and Japanese update/delete/no-update cell, use globally
separate author, reviewer, and power-reviewer identities, and assign unique
construction clusters with explicit cause IDs. Author and reviewer packets do
not reveal either role's identity, and both the plan and delivered packet are
content-addressed. The CLI additionally verifies that the declared public
contract hash is the hash of an actually valid frozen public contract.

The packet labels itself `PILOT_COLLECTION_INSTRUCTIONS_ONLY` and
`NOT_EVIDENCE_UNTIL_COMPLETED_REVIEWED_AND_SIGNED`. It therefore closes an
operational provenance gap but does not create human observations, improve a
score, or change the public **NO-GO** decision. An OpenCode adversarial pass
found a packet/type mismatch, whitespace-normalization identity collisions,
and ambiguous CLI errors; those defects were corrected. The resulting change
passes 74 test files and 741 tests, production build, both TypeScript checks,
and changed-file Biome. The remaining empirical work is to recruit independent
native participants, execute this packet, bind completed cases back to their
assignments and construction causes, and obtain the independent signed power
review before preregistration.
