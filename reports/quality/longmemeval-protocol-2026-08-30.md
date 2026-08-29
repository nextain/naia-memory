# LongMemEval protocol-conformance observation — 2026-08-30

Status: **H2 partial; no retrieval-quality or competitive claim**

## Pinned source

- Dataset: `longmemeval_s_cleaned.json`
- Upstream revision: `98d7416c24c778c2fee6e6f3006e7a073259d48f`
- Source SHA-256: `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`
- Source bytes: `277383467`

The dataset was downloaded from the official LongMemEval Hugging Face release.
The 277 MB source file is intentionally excluded from version control.

## Observation

Two independent executions accepted all 500 cases and produced the same
normalized protocol SHA-256:

`34246761e78ebaeb1cb84db2619f5cf2d8e3a9402e2d1b101b048a7bdcea4b67`

| Field | Observed |
|---|---:|
| cases | 500 |
| sessions | 23,867 |
| turns | 246,750 |
| abstention cases | 30 |
| duplicate-session-ID cases | 13 |
| empty-content turns | 12 |
| first pass | 1,552.89 ms; 722,530,304-byte RSS observation |
| second pass | 1,526.85 ms; 1,253,470,208-byte RSS observation |

Question-type counts were 70 single-session-user, 56
single-session-assistant, 30 single-session-preference, 133 temporal-reasoning,
78 knowledge-update, and 133 multi-session.

## Upstream schema observations

The current cleaned data is broader than a literal reading of the upstream
README:

- `has_answer` occurs as `false` 10,064 times and `true` 896 times. The Naia
  boundary preserves `true`, `false`, and field absence as distinct states.
- `answer` is numeric in 32 cases and a string in 468 cases. It is not coerced.
- 13 cases repeat a source session ID. Naia preserves the ID and adds a stable
  zero-based occurrence plus source ordinal; it does not overwrite a session.
- 12 turns have empty content. They remain present and ordered.

Answer/evidence labels are represented in protocol evidence but are explicitly
excluded from retrieval inputs. This prevents label leakage into later quality
experiments.

## Verification

- Targeted contract tests: 3 passed.
- Benchmark TypeScript project: passed.
- Two-run source and protocol sections: byte-identical after canonical `jq -S`.
- Canonical comparison SHA-256:
  `111c6ea5446177217d23bd20e3ee5eb78b5e0026c4d069a32ca7e13f5378c00e`.

## Remaining H2 gate

This observation proves parsing, semantic-field preservation, and deterministic
protocol normalization only. H2 remains open until the real Naia memory path
indexes all histories, emits deterministic retrieval artifacts, and records the
fixed embedder/model, top-k, per-stage latency, disk growth, and retrieval
results. No LongMemEval accuracy or global-superiority conclusion follows from
this report.
