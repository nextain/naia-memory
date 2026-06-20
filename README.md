# Naia Memory (formerly Alpha Memory)

**Cognitive memory architecture for AI agents** — importance-gated encoding, vector retrieval, knowledge graph, Ebbinghaus decay, and a multi-language benchmark suite.

[English](README.md) | [한국어](README.ko.md)

> **Status (2026-05-08)** — Ship-ready for `naia-agent` integration.
> Phase A Korean R2.3 measurement complete: **76.8% recall@20 (cosine semantic)** on AI Hub 141 multi-session conversations. Mid-tier baseline level (≈ mem0 67% / Letta 74% on LoCoMo English J-score). 12× faster than mem0 for the same workload.
> See [`docs/integration.md`](docs/integration.md) for naia-agent / naia-os wire-in. See [issue #23](https://github.com/nextain/naia-memory/issues/23) for measurement details.

---

## Place in the Naia ecosystem

Naia Memory is one of four repos in the Naia open-source AI platform:

| Repo | Role |
|------|------|
| [naia-os](https://github.com/nextain/naia-os) | Desktop shell + OS image (host) |
| [naia-agent](https://github.com/nextain/naia-agent) | Runtime engine (loop · tools · compaction) |
| [naia-adk](https://github.com/nextain/naia-adk) | Workspace format + skills library |
| **naia-memory** (this) | Memory implementation |

### Interfaces, not dependencies

Naia Memory is **one implementation of the `MemoryProvider` contract** specified in `@nextain/agent-types`:

- **Transparent** — the contract is public. Any memory system that implements it can replace Naia Memory without touching runtime code.
- **Non-binding** — naia-memory does not depend on naia-agent's runtime. naia-agent treats this package as a black box behind the interface.
- **Abstracted** — swap Naia Memory for another implementation (mem0, Letta, custom) and nothing else in the Naia ecosystem changes.

Part of the broader Naia principle: repos couple through **published interfaces**, not runtime dependencies. See [naia-agent README](https://github.com/nextain/naia-agent) for the full picture.

---

## Overview

Naia Memory implements a 4-store memory architecture inspired by cognitive science:

| Store | Brain Analog | What it holds |
|-------|-------------|---------------|
| **Episodic** | Hippocampus | Timestamped events with full context |
| **Semantic** | Neocortex | Facts, entities, relationships |
| **Procedural** | Basal Ganglia | Skills, strategies, learned patterns |
| **Working** | Prefrontal Cortex | Active context (managed externally) |

### Key Features

- **Importance gating** — 3-axis scoring (importance × surprise × emotion) filters what gets stored
- **Knowledge graph** — entity/relation extraction + spreading activation for semantic recall
- **Ebbinghaus decay** — memory strength fades over time, strengthened by recall
- **Reconsolidation (R2.5)** — contradiction filter on consolidation; supersedes outdated facts
- **Bi-temporal recall (R2.3)** — recall at a past timestamp; multi-session continuity
- **Pluggable adapters** — swap the vector backend (LocalAdapter / Mem0 / Qdrant)
- **Multi-language benchmark** — Korean (AI Hub 141 multi-session) + English (LoCoMo planned)

---

## How it works (plain language)

Most memory systems are "search engines" (vector store) — store everything, retrieve by cosine.

Naia is **closer to a human brain**: store the important parts only, forget what isn't used, periodically organize during sleep cycles, update when contradictions appear.

| Mechanism | Brain analogy | Effect |
|---|---|---|
| Importance gating | Selective attention | Filters trivial turns ("hello") |
| Sleep cycle (consolidation) | Memory consolidation during sleep | Batched fact extraction (raw conversation → atomic facts) |
| Ebbinghaus decay | Forgetting curve | Old unused facts fade |
| Reconsolidation | Update on contradiction | "I switched jobs" supersedes prior occupation fact |
| Knowledge graph + spreading | Associative recall | "ramen" activates "friend" + "Friday" |

**Trade-offs**:
- ✅ Fast (lazy batch consolidate, ~2 min per 60-turn conversation)
- ✅ Cheap ($0.005 / 100-turn conversation in cloud mode)
- ✅ Cognitive mechanisms (not just vector search)
- ❌ Not the absolute top tier (MemU 92% / MemMachine 85% English)
- ❌ Some mechanisms (decay curve, R2.5 natural triggers) hard to verify in unit benchmarks; require integration-level testing

---

## Architecture

```
src/
├── memory/
│   ├── index.ts                # MemorySystem — main orchestrator
│   ├── types.ts                # MemoryProvider type contract
│   ├── importance.ts           # 3-axis importance scoring
│   ├── decay.ts                # Ebbinghaus forgetting curve
│   ├── reconsolidation.ts      # Contradiction detection on consolidation
│   ├── contradiction-filter.ts # R2.5 — heuristic / Gemini / vLLM filter providers
│   ├── knowledge-graph.ts      # Entity/relation extraction + spreading activation
│   ├── embeddings.ts           # 4 providers (OpenAI-compat, offline, HF, gateway)
│   ├── llm-fact-extractor.ts   # LLM-based atomic fact extraction
│   ├── usage-tracker.ts        # Per-run token + cost tracking
│   └── adapters/
│       ├── local.ts            # JSON + cosine + BM25 + KG (default, recommended)
│       ├── mem0.ts             # mem0 OSS backend (stack-on-top hybrid)
│       └── qdrant.ts           # Qdrant vector DB
└── benchmark/
    ├── aihub141/               # Korean R2.3 multi-session bench (Phase A)
    │   ├── loader.ts           # AI Hub 141 zip → conversations
    │   ├── scorer.ts           # recall@k, polarity-aware, hard match
    │   ├── run.ts              # Entry — naia-local / no-memory / mem0 / naia-on-mem0
    │   ├── analyze.ts          # report → markdown breakdown
    │   ├── reanalyze.ts        # report → multi-metric reanalysis (cost 0)
    │   └── embedding-reanalyze.ts  # report → cosine semantic recall
    └── comparison/             # Legacy fact-bank.json (R5–R14, archived)
```

---

## Installation

```bash
npm install @nextain/naia-memory
# or
pnpm add @nextain/naia-memory
```

---

## Usage

```typescript
import {
  MemorySystem,
  LocalAdapter,
  OpenAICompatEmbeddingProvider,
  buildLLMFactExtractor,
} from "@nextain/naia-memory";

// 3 explicit injections — no env-var magic
const embedder = new OpenAICompatEmbeddingProvider(
  baseURL, apiKey, "gemini-embedding-001", 3072,
);
const adapter = new LocalAdapter({
  storePath: "/path/to/store.json",
  embeddingProvider: embedder,
});
const factExtractor = buildLLMFactExtractor({
  apiKey, baseURL, model: "gemini-2.5-flash-lite",
});

const memory = new MemorySystem({ adapter, factExtractor });

// Encode
await memory.encode(
  { content: "Switched jobs to a design firm", role: "user" },
  { project: "personal" },
);

// Recall
const result = await memory.recall("What is the user's job?", {
  project: "personal", topK: 10,
});
// result.facts: Fact[], result.episodes: Episode[]

// Sleep cycle (manual or automatic every 30 min)
await memory.consolidateNow();
```

For naia-agent / naia-os integration, see [`docs/integration.md`](docs/integration.md) — the SoT for wire-in patterns, settable parameters, and 2 prefab profiles (cloud / local privacy).

---

## Latest Benchmark — Phase A (2026-05-07)

**AI Hub 141 — 한국어 멀티세션 대화** (Korean multi-session natural conversations).
100 conversations × 4 sessions, persona-grounded annotation as ground truth.

### Recall metrics (naia-local)

| Metric | Score | Note |
|---|:-:|---|
| recall@5 (keyword loose) | 38.4% | Top-5 ranking — daily LLM context budget |
| recall@10 (keyword loose) | 60.0% | Mid-bound |
| **recall@20 (keyword loose)** | **69.1%** | Original report (inflated by topK ceiling) |
| recall@20 (polarity-aware keyword) | 62.8% | Negation-flipped false positives excluded |
| **recall@20 (cosine 0.7 semantic)** | **76.8%** | **Honest signal — semantic preservation** |
| recall@20 (hard substring) | 0.0% | Naia paraphrases — substring miss is *correct behavior* |

### Floor + comparison

| Adapter | recall@20 | Per-conv elapsed | Per-conv cost |
|---|:-:|:-:|:-:|
| naia-local | 69.1% (kw) / **76.8%** (cosine) | **~2 min** | ~$0.005 |
| no-memory (floor) | 0.0% | 0 | 0 |
| mem0 (1-conv smoke) | 70.6% (kw) | ~24 min (12× slower) | ~$0.05+ |

### External LoCoMo English baseline (different metric — disclaim)

| System | LoCoMo J-score | Comment |
|---|:-:|---|
| MemU | 92.1% | Top tier |
| MemMachine | 84.9% | Top tier |
| Letta | 74.0% | Mid tier |
| **naia (Korean cosine)** | **76.8%** | **Numerically comparable** |
| Mem0 | 67.0% | Mid tier |
| OpenAI ChatGPT memory | 52.9% | Lower tier |

**Caveat**: LoCoMo metric is LLM-as-judge J-score on QA; naia metric is recall@k on extracted facts. **Direct comparison disclaimed**, but mid-tier ordering is consistent.

Full report: [`reports/aihub141-r2-3-reanalysis-100conv.md`](reports/aihub141-r2-3-reanalysis-100conv.md), [issue #23](https://github.com/nextain/naia-memory/issues/23).

### Legacy benchmarks (archived)

R5-R14 `fact-bank.json` results (R5 EN 84%, R6 KO 24.7%, …) → see [`docs/archive/benchmark-history-r5-r14.md`](docs/archive/). Replaced by Phase A natural-conversation measurement; legacy fact-bank had synthetic-contradiction over-fit (#22 retro).

---

## Run the benchmark

```bash
pnpm install

# Phase A — Korean R2.3 multi-session (AI Hub 141 dataset, user must download separately)
GEMINI_API_KEY=xxx \
GATEWAY_URL=https://your-gateway GATEWAY_MASTER_KEY=xxx \
AIHUB_141_PATH=/path/to/aihub/141.한국어멀티세션대화/...
  pnpm exec tsx src/benchmark/aihub141/run.ts \
    --adapter=naia-local \
    --limit=100 --level=4 --topK=20

# Adapters: naia-local | no-memory | mem0 | naia-on-mem0
# Levels:   2 / 3 / 4 (multi-session count)

# Multi-metric reanalysis (cost 0 — uses existing report)
pnpm exec tsx src/benchmark/aihub141/reanalyze.ts \
  reports/aihub141-r2-3-naia-local-*.json

# Embedding cosine semantic reanalysis (~$0.005 per report)
pnpm exec tsx src/benchmark/aihub141/embedding-reanalyze.ts \
  reports/aihub141-r2-3-naia-local-*.json
```

**Dataset**: [AI Hub 한국어 멀티세션 대화](https://www.aihub.or.kr/aihubdata/data/view.do?dataSetSn=71630) (NIA license — research/educational, redistribution prohibited; loader-only commit pattern, raw data via `AIHUB_141_PATH` env).

---

## Configuration — what naia-agent must inject

Naia Memory takes 3 explicit injections (no env-var magic in production paths):

| Injection | What you provide | Default fallback |
|---|---|---|
| **Embedding provider** | `OpenAICompatEmbeddingProvider(baseURL, apiKey, model, dims)` or `OfflineEmbeddingProvider`, `HuggingFaceEmbeddingProvider`, `NaiaGatewayEmbeddingProvider` | none |
| **LLM fact extractor** | `buildLLMFactExtractor({ apiKey, baseURL, model })` | none |
| **Contradiction filter (optional)** | `selectFilter({ provider: 'heuristic'\|'gemini'\|'vllm', ... })` | heuristic (no LLM) |

### Recommended profiles

**Profile A — Quick start (cloud)**:
- LLM: Gemini 2.5 Flash Lite (Vertex AI gateway recommended for production rate limits)
- Embedding: gemini-embedding-001 (3072d) or vertex text-embedding-004 (768d)
- Filter: heuristic (off)
- Cost: ~$0.005 per 100 turns; ~$1–3/month for daily use

**Profile B — Local privacy (user GPU)**:
- LLM: vLLM Gemma 4 E4B (port 8000, OpenAI-compatible)
- Embedding: vLLM `bge-m3` or offline `multilingual-e5-large`
- Filter: vLLM Gemma 4 E4B
- Cost: GPU electricity only

See [`docs/integration.md`](docs/integration.md) for full details and `buildMemory(setting)` reference code.

---

## Roadmap

### Done

- ✅ R1 stabilization (7 slices) · R2 capability (4 slices) · R3 Korean tuning
- ✅ Phase A — Korean R2.3 multi-session bench (AI Hub 141, 100 conv, **76.8% cosine**)
- ✅ MemoryProvider 8-capability interface alignment with `@nextain/agent-types`
- ✅ Cost tracking — per-run usage + estimated USD in report
- ✅ Multi-metric scorer (keyword / polarity-aware / hard / embedding cosine)
- ✅ naia-agent integration ready — `pnpm smoke:naia-memory` verified

### Next — bench framework

| Phase | What | Cost |
|---|---|---|
| **B-α** R2.5 contradiction filter framework | Synthetic ledger + 3-axis scorer (recall / supersede precision / false positive) | ~400 LOC + ~$0.5 |
| ~~B-β R2.3 forgetting curve~~ | **Skipped** — coupled to context-compression work; deferred until small-context-model real-time compaction is in scope |
| **B-γ** A/B mechanism comparison | Importance gating / KG spreading / naia-on-mem0 hybrid on/off | ~300 LOC + ~$1.5 |
| **B-δ** Generalizability — other Korean datasets | KLUE / KorQuAD subset | ~200 LOC + ~$1 |

### Future — integration-level

Mechanisms that **only verify under naia-memory + naia-agent integration** (not unit-level):
- R2.3 natural-language temporal recall ("yesterday" → timestamp)
- R2.5 natural update detection in free-form conversation
- Importance gating with full emotion/surprise context
- Procedural memory (skills) inside agent loop
- Daily-use ground (multi-month history) — only measurable post-naia-os integration

These are tracked separately in `naia-agent` / `naia-os` benchmark issues.

---

## Development

```bash
pnpm install
pnpm exec tsc --noEmit  # type-check
pnpm exec vitest run    # unit tests
```

---

## AI-Native Open Source

This project is built with an AI-native development philosophy:

- **AI context is a first-class artifact** — `.agents/` context files are versioned alongside code
- **Privacy by architecture** — memory is stored locally; the service provider cannot access it
- **AI sovereignty** — users own their AI memories
- **Transparent AI assistance** — AI contributions are credited via `Assisted-by:` git trailers

AI context in `.agents/` and `.users/` is licensed under [CC-BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

---

## License

Apache 2.0 — see [LICENSE](LICENSE).

Part of [Naia OS](https://github.com/nextain/naia-os) by [Nextain](https://nextain.io).
