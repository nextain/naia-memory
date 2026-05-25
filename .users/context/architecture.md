# Naia Memory — Architecture

> Mirror of `.agents/context/architecture.yaml` (human-readable, English)
> Korean: [`.users/context/ko/architecture.md`](ko/architecture.md)

## 4-Store Memory Model

Inspired by Tulving's memory taxonomy + Complementary Learning Systems (CLS) theory.

| Store | Brain Analog | Contents | File |
|-------|-------------|----------|------|
| Episodic | Hippocampus | Timestamped events + encoding context | `src/memory/index.ts` |
| Semantic | Neocortex | Facts, entities, relations | `src/memory/index.ts` |
| Procedural | Basal Ganglia | Skills, strategies | `src/memory/index.ts` |
| Working | Prefrontal Cortex | Active context (managed externally) | — |

## Importance Scoring (Amygdala analog)

3-axis utility scoring based on CraniMem (2025). File: `src/memory/importance.ts`

- **Importance** — goal-relevance
- **Surprise** — deviation from expectations (prediction error)
- **Emotion** — user sentiment/arousal
- **Utility** = f(importance, surprise, emotion) — stored only if above threshold

## Ebbinghaus Decay

`src/memory/decay.ts` — `strength = e^(-k * elapsed / stability)`

Recall increases stability (spaced repetition effect).

## Reconsolidation

`src/memory/reconsolidation.ts` — Contradiction detection between new input and existing memories on retrieval.

## Knowledge Graph

`src/memory/knowledge-graph.ts` — Entity and relation extraction into semantic memory.

## Embedding Backends

| Backend | Model | Dims | Notes |
|---------|-------|------|-------|
| `gemini` | gemini-embedding-001 | 3072 | Requires `GEMINI_API_KEY` |
| `solar` | embedding-query/passage | 4096 | Requires `UPSTAGE_API_KEY` |
| `qwen3` | qwen3-embedding (Ollama) | 2048 | Local |
| `bge-m3` | bge-m3 (Ollama) | 1024 | Local, multilingual |
| Gateway | vertexai:text-embedding-004 | 768 | Requires `GATEWAY_URL` + `GATEWAY_MASTER_KEY` |
