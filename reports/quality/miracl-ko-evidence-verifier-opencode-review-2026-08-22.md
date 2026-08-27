# MIRACL Korean evidence verifier adversarial review

Date: 2026-08-22
Reviewer: OpenCode `opencode/hy3-free` (score-blind; no benchmark result existed)

## Outcome

Two hostile passes returned `CONDITIONAL`. The first correctly found that the
NIST evaluator identity was asserted without enforcing its binary hash, and
that CPU/exact policy depended too heavily on the result JSON. The second
confirmed that independent score reproduction is real, while requesting
stronger Qdrant configuration and evaluator-source provenance.

Accepted remediations:

- require both pinned `trec_eval` source commit and executable SHA-256;
- reject qrels, TREC, result-policy, evaluator, metric, or Qdrant drift;
- verify live Qdrant version/commit, point count, vector size, cosine distance,
  `hnsw.m=0`, and `indexing_threshold=0`;
- bind a live `/proc` launch observation containing the benchmark command,
  empty `CUDA_VISIBLE_DEVICES`, evaluation-source hash, Qdrant URL, and fixed
  result path;
- label latency as query embedding plus exact Qdrant search, never search-only.

## Residual claim boundary

This is reproducible same-host evidence, not third-party remote attestation.
The independent evaluator is independent from Naia's metric implementation,
but the operator controls the host. Exact query behavior is bound through the
hash-pinned evaluation source and disabled HNSW collection configuration; a
fully hostile-host threat model would still require third-party rerun or a
hardware-backed trust root. Therefore a future public report may claim
reproducible full-corpus retrieval results, but must not claim independent lab
certification.

The review remains `CONDITIONAL` until the running benchmark finishes and the
pinned evaluator reproduces both metrics within `1e-6`.
