# Naia Memory global comparison evidence — 2026-08-28

## Decision

Naia Memory has credible evidence for two capabilities: full-corpus multilingual
base retrieval and selective memory-lifecycle behavior. It does **not** yet have
enough evidence to claim global memory-engine superiority.

The residual CPU batching candidates are conservatively rejected. The retained
development note says neither candidate met the recorded vector-agreement
threshold and the warmed hybrid candidate was slower than the existing per-item
path. No raw measurement receipt or executable candidate remains, so these
numbers are not independently reproducible and authorize no performance claim,
runtime change, or product API change.

## Evidence classes

This report keeps three classes separate:

1. **Direct local evidence** — committed, hash-bound Naia runs or same-input
   comparator executions.
2. **Protocol-matched historical evidence** — public benchmark rows compared
   under a compatible protocol, but not produced in the same experiment.
3. **Vendor-published or unverified claims** — useful for designing tests, never
   transitive evidence that Naia wins or loses.

Only class 1 supports direct statements about observed behavior.

## Same-input lifecycle comparison

Naia, Mem0, and Hindsight ran the same nine Korean, English, and Japanese
diagnostic cases three times with a balanced engine-order rotation. Engine-blind
Gemini model judgments over the 27 engine-cases per engine produced:

| Engine | Top-1 current | Top-k current | Stale returned | Deleted returned |
| --- | ---: | ---: | ---: | ---: |
| Naia | 18/27 | 21/27 | 6/27 | 5/27 |
| Mem0 | 17/27 | 17/27 | 0/27 | 0/27 |
| Hindsight | 20/27 | 24/27 | 11/27 | 8/27 |

These rows expose different lifecycle signatures; they do not rank global
quality. There are only nine unique generated cases, repetitions are not new
independent samples, and the author and judge models came from the same Gemini
provider family. The Naia-side agent also influenced experiment design and
execution, so engine blinding does not make the adjudication independent. In
particular, Naia is
more selective than Hindsight in this campaign but returned more stale/deleted
items than Mem0. A single winner cannot be derived from these mixed outcomes.

Graphiti was contacted through its native runtime, but its historical graph
surface could not satisfy the benchmark's current-state identity contract.
Graphiti therefore remains a separately named historical/projection track, not
a scored row in the table. Letta's agent-managed memory surface is also a
different unit of comparison and has no completed identical-input row.

## Full-corpus retrieval evidence

| Language | Documents | Queries | nDCG@10 | Recall@100 | Scope |
| --- | ---: | ---: | ---: | ---: | --- |
| Korean | 1,486,752 | 213 | 0.6526 | 0.9233 | Direct local, exact CPU search |
| Arabic | 2,061,414 | 2,896 | 0.743225 | 0.962765 | Direct local, exact CPU search |

The Korean run exceeds the frozen MIRACL BM25+mDPR row (0.609/0.900), but that
row is protocol-matched historical evidence, not a simultaneous competitor run.
The model reports MIRACL training-split use. These results establish a strong
retrieval foundation, not a Naia-specific memory innovation, current SOTA, or
superiority over memory engines.

The English full-corpus primary run is not complete. Its residual development
batch candidates were safely rejected:

| Candidate | Throughput result | Minimum cosine | Decision |
| --- | --- | ---: | --- |
| length-bucketed array batch | 4.3490x cold-control ratio | 0.927233 | Reject; accuracy gate failed and timing is unsuitable |
| length-bucketed hybrid | 0.8371x warmed-control ratio | 0.927233 | Reject; slower and accuracy gate failed |

The existing `per-item-v1` path remains the default.

## What distinguishes Naia Memory today

The defensible distinction is architectural and behavioral, not a leaderboard
claim: Naia keeps mutation-aware state and retrieval policy inside a narrow
memory module, while the main LLM remains responsible for conversation and tool
decisions. `naia-kb-compiler` prepares durable knowledge inputs;
`naia-persona` supplies persona-owned facts and policy; Naia Memory stores and
retrieves the resulting memory records. Runtime storage is wired under
`naia-settings`, not inside the ADK source checkout.

This boundary lets the system test update, supersession, deletion, provenance,
and retrieval independently of the main model. The existing evidence shows that
the boundary works and behaves differently from comparator surfaces. It does
not show that every lifecycle decision is better.

## Improvements accepted in this loop

- Re-ran the complete repository validation: 170 test files, 1,419 passing tests,
  one intentional skip; TypeScript typecheck and build both passed.
- Preserved the rejected batching decision, preventing a faster-looking but
  vector-incompatible candidate from entering the product path.
- Corrected the residual batch record's evidence label from preregistration to
  retrospective development evidence.
- Consolidated source hashes and claim boundaries into the adjacent
  machine-readable manifest.

## Validation and review status

- Deterministic review preflight over `119ce9c..1164723`: `PREFLIGHT_CLEAN`,
  complexity identity
  `sha256:54407f6f7fe31cf543bb791997b8df87c48bb86cff49ca3eafd62b44aedc918d`.
  The adjacent verification receipt records the exact base, head, tree, command,
  and fresh repository validation. It validates that checkpoint range; it is not
  a circular claim about later documentation commits.
- Evidence manifest: all seven declared SHA-256 source identities reproduced.
- Repository: 170 test files passed (1,419 tests passed, one skipped), typecheck
  passed, build passed, and `git diff --check` passed.
- Earlier independent structured-review attempts through OpenCode, Codex, and
  Claude were unavailable or failed the required output contract. Those attempts
  are `NOT_RUN`, not approvals. After the Codex structured-output path was
  recovered, four schema-valid role reviews over the original checkpoint were
  `NOT_CLEAN` and identified evidence-label, reviewer-independence, reproducible-
  measurement, and receipt-binding defects. Four fresh role reviews over the
  corrected head were also `NOT_CLEAN`: they found inconsistent review-state
  wording and delivery receipts that still identified the superseded artifacts.
  The accepted findings were corrected; qualification remains false and the
  corrected frozen artifacts still require two consecutive four-role CLEAN
  rounds. The subsequent role artifacts, rather than a mutable status assertion
  in this report, are the qualification record.

Accordingly this document is a verified engineering checkpoint, but it does not
claim the two consecutive independent CLEAN rounds required for public
qualification. Failed and unavailable reviews are explicit open gates rather
than evidence in Naia's favor.

## Claim ledger

| Claim | Status | Reason |
| --- | --- | --- |
| Strong Korean and Arabic full-corpus base retrieval | Supported | Hash-bound full-corpus exact-search runs |
| Reproducible Naia/Mem0/Hindsight lifecycle differences | Supported, diagnostic only | Same inputs and balanced order; small generated set |
| Naia globally beats Mem0 or Hindsight | Not supported | Mixed outcomes, insufficient independent cases |
| Naia beats Graphiti or Letta | Not tested | Comparison surfaces are not yet identity-equivalent |
| Residual batching improves production | Rejected | Accuracy threshold failed; warmed hybrid slower |
| Global SOTA | Not supported | No identical-protocol, independently adjudicated global campaign |

## Remaining qualification gates

1. Freeze an independently authored lifecycle test family with enough unique
   cases for confidence intervals and per-language/update-type cells.
2. Run Naia, Mem0, Hindsight, a correctly scoped Graphiti track, Letta's
   agent-managed track, and a plain-vector baseline on identical inputs.
3. Use independent native-language adjudicators; seal outputs before unblinding.
4. Complete English and at least one additional language under the full-corpus
   retrieval contract, with repeated latency/cost observations.
5. Publish failures and uncertainty alongside aggregate scores. Promotion
   requires two consecutive clean adversarial-review rounds over the frozen
   artifacts.

Until those gates pass, the concise public statement is:

> Naia Memory has reproducible multilingual retrieval and lifecycle evidence,
> including million-document Korean and Arabic runs and a same-input three-engine
> diagnostic. Global memory-engine superiority has not yet been established.

## Evidence sources

The adjacent JSON manifest binds the principal local sources by SHA-256. Public
design references are the official [Mem0 repository](https://github.com/mem0ai/mem0),
[Hindsight repository](https://github.com/vectorize-io/hindsight),
[Graphiti repository](https://github.com/getzep/graphiti), and
[Letta repository](https://github.com/letta-ai/letta). Their published claims
are context only and are not scored as local observations.
