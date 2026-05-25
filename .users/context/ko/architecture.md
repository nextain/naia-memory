# Naia Memory — Architecture

> Mirror of `.agents/context/architecture.yaml` (human-readable)

## 4-Store Memory Model

인지과학(Tulving taxonomy + CLS theory)에서 영감을 받은 4-저장소 구조.

| Store | Brain Analog | Contents | File |
|-------|-------------|----------|------|
| Episodic | Hippocampus | Timestamped events + encoding context | `src/memory/index.ts` |
| Semantic | Neocortex | Facts, entities, relations | `src/memory/index.ts` |
| Procedural | Basal Ganglia | Skills, strategies | `src/memory/index.ts` |
| Working | Prefrontal Cortex | Active context (external) | — |

## Importance Scoring (Amygdala)

CraniMem (2025) 3축 중요도 점수. 파일: `src/memory/importance.ts`

- **Importance** — goal-relevance
- **Surprise** — deviation from expectations (prediction error)
- **Emotion** — user sentiment/arousal
- **Utility** = f(importance, surprise, emotion) — 임계값 이상이면 저장

## Ebbinghaus Decay

`src/memory/decay.ts` — `strength = e^(-k * elapsed / stability)`

재호출 시 stability 증가 (spaced repetition 효과).

## Reconsolidation

`src/memory/reconsolidation.ts` — 검색 시 새 입력과 기존 메모리 간 모순 감지.

## Knowledge Graph

`src/memory/knowledge-graph.ts` — 엔티티·관계 추출 → 시맨틱 메모리.

## Embedding Backends

| Backend | Model | Dims |
|---------|-------|------|
| `gemini` | gemini-embedding-001 | 3072 |
| `solar` | embedding-query/passage | 4096 |
| `qwen3` | qwen3-embedding (Ollama) | 2048 |
| `bge-m3` | bge-m3 (Ollama) | 1024 |
| Gateway | vertexai:text-embedding-004 | 768 |
