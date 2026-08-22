# MIRACL Korean full-corpus OpenCode adversarial review

Date: 2026-08-22 (Asia/Seoul)

State: remediation in progress; full-corpus effectiveness score unseen

## Review identity and boundary

This is a decision record, not a verbatim model transcript and not a formal
`review-pass` CLEAN receipt. Recovery mode prevents that stronger claim. The
first attempted OpenCode reviewer, `opencode/x-preview-f-free`, returned no
usable final verdict and is recorded as invalid. A separate headless execution
using `opencode/hy3-free` reviewed the frozen preregistration, comparison
contract, benchmark runner, metric implementation, and quality-report context.
Its verdict was `CONDITIONAL`.

The reviewer was not shown an effectiveness score because none existed. Model
consensus is not treated as truth; every accepted finding below was checked
against the repository source or active service receipt before remediation.

## Findings and evidence decisions

| Finding | Primary evidence checked | Decision | Remediation |
| --- | --- | --- | --- |
| Binary nDCG and mean Recall@100 math are compatible with the locked Korean qrels | 547 positive rows, all relevance 1; 2,510 explicit zero rows; metric source | accepted as sound | retain independent `trec_eval` reproduction gate |
| The preregistration says Hit Rate but the result names fields `successAt1/5/10` | runner and metric field definitions | accepted | define `successAtK` explicitly as Hit Rate@k and exclude it from historical comparison |
| Query latency includes embedding and exact search | query execution path in the runner | accepted | label it end-to-end query latency, never search-only latency |
| MIRACL training-family overlap was missing from the original preregistration claim boundary | comparison contract and multilingual-e5-large model-card disclosure | accepted | add a visibly post-launch, score-unseen correction without rewriting history |
| Qdrant service identity was not self-contained | live root receipt | accepted | bind version 1.15.5 and commit `48203e414e4e7f639a6d394fb6e4df695f808e51` |
| Embedding policy evidence appeared opaque in the review bundle | `src/memory/embeddings.ts` and result `policyReceipt` schema | accepted as a review-input gap, not an implementation defect | include embedding source and expose the final machine receipt in the next review |
| In-process metrics still need independent reproduction | pinned `trec_eval` contract | accepted | run NIST `trec_eval` and require agreement within `1e-6` after completion |

## Leakage and overfitting judgment

No development qrels are used for model selection, parameter tuning, negative
selection, corpus filtering, or index construction in this run. Nevertheless,
the base model was trained with MIRACL training-split examples, so the final
report must describe the result as development-label-free execution with
dataset-family training overlap, not as dataset-family-zero-shot evidence.
This limitation applies to the base retriever and cannot establish a
Naia-specific memory-engine advantage.

## Remediation status

The documentation corrections above were made after launch and before score
availability. They do not change the running process or frozen retrieval policy.
Independent metric reproduction remains pending until the full-corpus result is
committed. A new score-blind OpenCode review must inspect
`src/memory/embeddings.ts` and these corrections before this review condition is
considered resolved.

## Score-blind remediation review

A second headless `opencode/hy3-free` execution inspected both corrected
documents, `src/memory/embeddings.ts`, the full-corpus runner, and the metric
implementation. It independently confirmed that no result file existed, then
returned `CONDITIONAL` with three evidence-packaging findings and the still
pending evaluator run.

| Second-review finding | Evidence decision | Response |
| --- | --- | --- |
| Qdrant identity is absent from the benchmark JSON | rejected as a code defect, accepted as a final-receipt obligation | the frozen contract explicitly assigns service version/commit to the final evidence receipt; changing the running format is unnecessary and would not alter the already-loaded process |
| Runtime device is absent from `policyReceipt` | accepted as a documentation overclaim | documentation now states that embedding policy and `cpuOnly`/launch receipts jointly establish the execution identity |
| `latencyMilliseconds` is not self-describing | accepted as a reporting obligation | the final report and evidence receipt must label it end-to-end query latency; it may not be described as search-only latency |
| `trec_eval` has not reproduced the score | accepted and pending by construction | execute only after the immutable result and TREC file exist |

The second review also confirmed that metric math, Hit Rate naming, training
overlap disclosure, embedding prefix/pooling/quantization policy, and the
Naia-favoring claim restrictions are internally consistent. Its final verdict
remains `CONDITIONAL` until the completed result is independently reproduced.
This is the correct current state, not a failed effectiveness result.
